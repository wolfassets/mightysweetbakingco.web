/**
 * Hono router for the `/deliveries/:id` detail page (web-c).
 *
 * Provides the full-page render + htmx fragment endpoints + JSON data feeds
 * used by the client-side jsPDF invoice generator. Mounted by agent #12.
 *
 * Endpoints:
 *   GET  /deliveries/:id              — full page (Layout + DeliveryDetailPage)
 *   PATCH /deliveries/:id             — inline-edit field changes
 *   DELETE /deliveries/:id            — soft archive (returns HX-Redirect)
 *   GET  /deliveries/:id/json         — raw delivery JSON for client PDF
 *   POST /delivery-items              — add item to delivery, returns refreshed table body
 *   PATCH /delivery-items/:id         — update prepared/unsold; returns recomputed row
 *   PATCH /delivery-items/:id/rate    — change rate (price+cost+rateId); returns recomputed row
 *   DELETE /delivery-items/:id        — remove item (returns empty body for row removal)
 *   GET  /delivery-items/by-delivery/:id.json — items JSON for client PDF
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import { api } from '../lib/api.js'
import {
  DeliveryDetailPage,
  DeliveryItemRow,
  type DeliveryItem,
} from '../views/DeliveryDetail.js'
import type { Delivery } from '../views/Deliveries.js'
import type { Flavor, FlavorPrice } from '../views/Flavors.js'

// ─────────────────────────────────────────────────────────────────────────────

function htmlPage(c: Context, jsx: unknown): Response | Promise<Response> {
  return c.html('<!DOCTYPE html>' + String(jsx))
}

async function loadContext(deliveryId: number): Promise<{
  delivery: Delivery
  items: DeliveryItem[]
  flavors: Flavor[]
  prices: FlavorPrice[]
  allDeliveries: Delivery[]
  allItems: DeliveryItem[]
} | null> {
  const [allDeliveries, allItems, flavors, prices] = await Promise.all([
    api.get<Delivery[]>('/deliveries'),
    api.get<DeliveryItem[]>('/delivery-items'),
    api.get<Flavor[]>('/flavors?includeArchived=true'),
    api.get<FlavorPrice[]>('/flavor-prices?includeArchived=true'),
  ])
  const delivery = allDeliveries.find((d) => d.id === deliveryId)
  if (!delivery) return null
  const items = allItems.filter((i) => i.deliveryId === deliveryId)
  return { delivery, items, flavors, prices, allDeliveries, allItems }
}

// ─────────────────────────────────────────────────────────────────────────────

export const deliveryDetailRoutes = new Hono()

// ───── Full page ─────
deliveryDetailRoutes.get('/deliveries/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const ctx = await loadContext(id)
  if (!ctx) return c.notFound()
  return htmlPage(
    c,
    <DeliveryDetailPage
      delivery={ctx.delivery}
      items={ctx.items}
      flavors={ctx.flavors}
      prices={ctx.prices}
      allDeliveries={ctx.allDeliveries}
      allItems={ctx.allItems}
    />,
  )
})

// ───── JSON data for client-side jsPDF ─────
deliveryDetailRoutes.get('/deliveries/:id/json', async (c) => {
  const id = Number(c.req.param('id'))
  const all = await api.get<Delivery[]>('/deliveries')
  const d = all.find((x) => x.id === id)
  if (!d) return c.notFound()
  return c.json(d)
})

deliveryDetailRoutes.get('/delivery-items/by-delivery/:id.json', async (c) => {
  const id = Number(c.req.param('id'))
  const items = await api.get<DeliveryItem[]>(`/delivery-items?deliveryId=${id}`)
  return c.json(items)
})

// ───── Inline-edit field updates (form-encoded) ─────
deliveryDetailRoutes.patch('/deliveries/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const form = await c.req.parseBody()
  const numericKeys = new Set([
    'additionalFees',
    'discount',
    'prepaidAmount',
    'cashCollected',
    'venmoCollected',
    'otherCollected',
  ])
  const nullableStringKeys = new Set([
    'location',
    'notes',
    'invoiceNotes',
    'dropoffDate',
    'expirationDate',
  ])
  const body: Record<string, unknown> = {}
  for (const k of Object.keys(form)) {
    const v = form[k]
    if (numericKeys.has(k)) body[k] = Number(v ?? 0)
    else if (nullableStringKeys.has(k)) body[k] = v === '' ? null : String(v)
    else body[k] = String(v)
  }
  await api.patch(`/deliveries/${id}`, body)
  return c.body(null, 204)
})

// ───── Archive (soft delete) ─────
deliveryDetailRoutes.delete('/deliveries/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await api.del(`/deliveries/${id}`)
  c.header('HX-Redirect', '/deliveries')
  return c.body(null, 200)
})

// ─────────────────────────────────────────────────────────────────────────────
// Delivery items
// ─────────────────────────────────────────────────────────────────────────────

// Refresh the entire #delivery-items container with the current table body.
// Used by POST /delivery-items so we don't have to compute & insert just the
// new row (which would require knowing matchingRate etc client-side).
async function renderItemsContainer(deliveryId: number, c: Context): Promise<Response> {
  const ctx = await loadContext(deliveryId)
  if (!ctx) return c.body('', 200)
  const { delivery, items, flavors, prices } = ctx
  // Recreate the markup that lives inside #delivery-items (table + totals row).
  // Cheapest path: re-import the ItemsTable indirectly via DeliveryDetailPage…
  // but we don't need the whole page. Instead, render a minimal wrapper.
  const totalPrepared = items.reduce((s, i) => s + i.prepared, 0)
  const totalUnsold = items.reduce((s, i) => s + (i.unsold ?? 0), 0)
  const totalRevenue = items.reduce((s, i) => s + i.revenue, 0)
  const totalCogs = items.reduce((s, i) => s + i.cogs, 0)
  const totalProfit = items.reduce((s, i) => s + i.profit, 0)
  const usd = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

  return c.html(
    <div id="delivery-items" class="px-5 pb-4 w-full">
      {items.length === 0 ? (
        <div class="text-center py-12 text-gray-400 dark:text-zinc-500">
          <div>No flavors added to this delivery yet.</div>
        </div>
      ) : (
        <table class="data-table w-full">
          <colgroup>
            <col style="width: 24px;" />
            <col style="width: 260px;" />
            <col />
            <col style="width: 260px;" />
            <col style="width: 80px;" />
            <col style="width: 96px;" />
            <col style="width: 96px;" />
            <col style="width: 96px;" />
            <col style="width: 96px;" />
            <col style="width: 100px;" />
          </colgroup>
          <thead>
            <tr class="bg-gray-50 dark:bg-[#171717]">
              <th class="w-6 text-center" style="padding-left: 0; padding-right: 0;">#</th>
              <th style="width: 260px;">Flavor</th>
              <th style="width: 100%;"></th>
              <th class="text-center" style="width: 260px;">Rate</th>
              <th class="text-center" style="width: 80px;">Prepared</th>
              <th class="text-center" style="width: 96px;">Unsold</th>
              <th class="text-right" style="width: 96px;">Revenue</th>
              <th class="text-right" style="width: 96px;">COGS</th>
              <th class="text-right" style="width: 96px;">Profit</th>
              <th class="text-center" style="width: 100px;">Actions</th>
            </tr>
          </thead>
          <tbody id="delivery-items-tbody">
            {items.map((it) => (
              <DeliveryItemRow it={it} delivery={delivery} flavors={flavors} prices={prices} />
            ))}
            <tr class="totals-row border-t-2 border-gray-200 dark:border-[#262626] bg-gray-50 dark:bg-[#171717]">
              <td colspan={2}>
                <span class="py-3 min-h-[44px] flex items-center text-headline text-gray-900 dark:text-zinc-100">Total</span>
              </td>
              <td></td>
              <td></td>
              <td>
                <span class="px-4 py-3 min-h-[44px] flex items-center justify-center text-gray-900 dark:text-zinc-100 text-callout text-center">
                  {totalPrepared}
                </span>
              </td>
              <td>
                <span class="px-4 py-3 min-h-[44px] flex items-center justify-center text-gray-900 dark:text-zinc-100 text-callout text-center">
                  {totalUnsold}
                </span>
              </td>
              <td>
                <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-callout text-right text-gray-900 dark:text-zinc-100">
                  {usd(totalRevenue)}
                </span>
              </td>
              <td>
                <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-callout text-right text-gray-900 dark:text-zinc-100">
                  {usd(totalCogs)}
                </span>
              </td>
              <td>
                <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-right">
                  {totalProfit >= 0 ? (
                    <span class="text-green-600 dark:text-green-400 text-callout">{usd(totalProfit)}</span>
                  ) : (
                    <span class="text-red-500 dark:text-red-400 text-callout">{usd(totalProfit)}</span>
                  )}
                </span>
              </td>
              <td>
                <div class="px-4 py-3 min-h-[44px] flex items-center justify-center">
                  <button
                    type="button"
                    onclick="document.getElementById('add-flavor-modal').classList.remove('hidden')"
                    class="relative overflow-hidden rounded-full w-24 py-1 text-button transition-all select-none text-center whitespace-nowrap bg-green-50 text-green-600 border border-green-200 hover:bg-green-100 hover:text-green-700 dark:bg-green-950/40 dark:text-green-400 dark:border-green-900/50 dark:hover:bg-green-950/60 dark:hover:text-green-300"
                  >
                    Add Flavor
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>,
  )
}

// POST /delivery-items/suggested-set — copy all rows from a previous delivery.
deliveryDetailRoutes.post('/delivery-items/suggested-set', async (c) => {
  const form = await c.req.parseBody()
  const deliveryId = Number(form.deliveryId)
  const sourceDeliveryId = Number(form.sourceDeliveryId)
  if (!deliveryId || !sourceDeliveryId || deliveryId === sourceDeliveryId) {
    return renderItemsContainer(deliveryId, c)
  }

  const allItems = await api.get<DeliveryItem[]>('/delivery-items')
  const currentItems = allItems.filter((item) => item.deliveryId === deliveryId)
  const sourceItems = allItems.filter((item) => item.deliveryId === sourceDeliveryId)
  if (currentItems.length > 0 || sourceItems.length === 0) {
    return renderItemsContainer(deliveryId, c)
  }

  for (const item of sourceItems) {
    const prepared = item.prepared ?? 0
    const unitPrice = item.unitPrice ?? null
    const unitCost = item.unitCost ?? null
    const revenue = unitPrice == null ? item.revenue : prepared * unitPrice
    const cogs = unitCost == null ? item.cogs : prepared * unitCost
    await api.post<DeliveryItem>('/delivery-items', {
      deliveryId,
      flavorName: item.flavorName,
      prepared,
      unsold: 0,
      unitPrice,
      unitCost,
      revenue,
      cogs,
      profit: revenue - cogs,
      rateId: item.rateId ?? null,
    })
  }

  return renderItemsContainer(deliveryId, c)
})

// POST /delivery-items — create from modal form
deliveryDetailRoutes.post('/delivery-items', async (c) => {
  const form = await c.req.parseBody()
  const deliveryId = Number(form.deliveryId)
  const flavorId = Number(form.flavorId)
  const rateId = form.rateId ? Number(form.rateId) : null
  const prepared = Number(form.prepared ?? 0)

  // Look up flavor + rate to compute revenue/cogs/profit on the server
  const [flavors, prices] = await Promise.all([
    api.get<Flavor[]>('/flavors?includeArchived=true'),
    api.get<FlavorPrice[]>('/flavor-prices?includeArchived=true'),
  ])
  const flavor = flavors.find((f) => f.id === flavorId)
  const rate = rateId ? prices.find((p) => p.id === rateId) : null
  if (!flavor) return c.json({ error: 'flavor not found' }, 400)

  const unitPrice = rate?.price ?? flavor.unitPrice
  const unitCost = rate?.cost ?? flavor.unitCost ?? 0
  const revenue = prepared * unitPrice
  const cogs = prepared * unitCost
  const profit = revenue - cogs

  await api.post<DeliveryItem>('/delivery-items', {
    deliveryId,
    flavorName: flavor.name,
    prepared,
    unitPrice,
    unitCost,
    revenue,
    cogs,
    profit,
    rateId: rate?.id ?? null,
  })

  return renderItemsContainer(deliveryId, c)
})

// PATCH /delivery-items/:id — prepared/unsold changes (JSON or form body).
// Recomputes revenue/cogs/profit + returns the swapped row.
deliveryDetailRoutes.patch('/delivery-items/:id', async (c) => {
  const id = Number(c.req.param('id'))
  // Detect JSON vs form-encoded
  const ctype = c.req.header('content-type') ?? ''
  let body: Record<string, unknown>
  if (ctype.includes('application/json')) {
    body = (await c.req.json()) as Record<string, unknown>
  } else {
    const form = await c.req.parseBody()
    body = {}
    for (const k of Object.keys(form)) body[k] = form[k]
  }

  // Look up the current item to recompute revenue/cogs/profit
  const all = await api.get<DeliveryItem[]>('/delivery-items')
  const current = all.find((x) => x.id === id)
  if (!current) return c.body('', 200)

  const prepared = body.prepared != null ? Number(body.prepared) : current.prepared
  const rawUnsold = body.unsold != null ? Number(body.unsold) : (current.unsold ?? 0)
  const unsold = Math.max(0, Math.min(rawUnsold || 0, prepared))
  const unitPrice = current.unitPrice ?? 0
  const unitCost = current.unitCost ?? 0
  const effectiveSold = prepared - unsold
  const revenue = effectiveSold * unitPrice
  const cogs = prepared * unitCost
  const profit = revenue - cogs

  const patchBody = {
    prepared,
    unsold,
    revenue,
    cogs,
    profit,
  }
  await api.patch(`/delivery-items/${id}`, patchBody)

  // Re-fetch the item and surrounding context to render the new row
  const refreshed = await api.get<DeliveryItem[]>('/delivery-items')
  const item = refreshed.find((x) => x.id === id)
  if (!item) return c.body('', 200)
  const allDeliveries = await api.get<Delivery[]>('/deliveries')
  const delivery = allDeliveries.find((d) => d.id === item.deliveryId)
  if (!delivery) return c.body('', 200)
  const [flavors, prices] = await Promise.all([
    api.get<Flavor[]>('/flavors?includeArchived=true'),
    api.get<FlavorPrice[]>('/flavor-prices?includeArchived=true'),
  ])
  return c.html(<DeliveryItemRow it={item} delivery={delivery} flavors={flavors} prices={prices} />)
})

// PATCH /delivery-items/:id/rate — change which FlavorPrice tier drives the row
deliveryDetailRoutes.patch('/delivery-items/:id/rate', async (c) => {
  const id = Number(c.req.param('id'))
  const form = await c.req.parseBody()
  const rateId = Number(form.rateId)

  const [prices, allItems] = await Promise.all([
    api.get<FlavorPrice[]>('/flavor-prices?includeArchived=true'),
    api.get<DeliveryItem[]>('/delivery-items'),
  ])
  const item = allItems.find((x) => x.id === id)
  const rate = prices.find((p) => p.id === rateId)
  if (!item || !rate) return c.body('', 200)

  const unitPrice = rate.price
  const unitCost = rate.cost ?? 0
  const prepared = item.prepared
  const unsold = item.unsold ?? 0
  const effectiveSold = prepared - unsold
  const revenue = effectiveSold * unitPrice
  const cogs = prepared * unitCost
  const profit = revenue - cogs

  await api.patch(`/delivery-items/${id}`, {
    unitPrice,
    unitCost,
    rateId,
    revenue,
    cogs,
    profit,
  })

  const refreshed = await api.get<DeliveryItem[]>('/delivery-items')
  const updated = refreshed.find((x) => x.id === id)
  if (!updated) return c.body('', 200)
  const allDeliveries = await api.get<Delivery[]>('/deliveries')
  const delivery = allDeliveries.find((d) => d.id === updated.deliveryId)
  if (!delivery) return c.body('', 200)
  const flavors = await api.get<Flavor[]>('/flavors?includeArchived=true')
  return c.html(<DeliveryItemRow it={updated} delivery={delivery} flavors={flavors} prices={prices} />)
})

// DELETE /delivery-items/:id — remove and return empty body
deliveryDetailRoutes.delete('/delivery-items/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await api.del(`/delivery-items/${id}`)
  return c.body('', 200)
})

export default deliveryDetailRoutes
