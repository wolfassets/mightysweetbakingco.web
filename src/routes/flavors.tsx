/**
 * Hono router for the `/flavors` UI page.
 *
 * Mounted by agent #12 at the app root (no prefix). All handlers either return
 * a full page (`<FlavorsView />`) for browser navigations or an htmx fragment
 * for in-place swaps. Mutations talk to the upstream Hono api at :3000 via the
 * shared `api` client from src/lib/api.ts.
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import { api } from '../lib/api.js'

// Hono's JSX function components return `HtmlEscapedString | Promise<HtmlEscapedString>`
// depending on whether any child is async. We don't have any async components,
// but the type system still infers the union, so accept it explicitly.
type HtmlOrPromise = string | { toString(): string } | Promise<string | { toString(): string }>
import {
  AddTierRow,
  FlavorBlock,
  FlavorNameCell,
  FlavorNameEdit,
  FlavorsCard,
  FlavorsView,
  PriceTierCostCell,
  PriceTierCostEdit,
  PriceTierNameCell,
  PriceTierNameEdit,
  PriceTierPriceCell,
  PriceTierPriceEdit,
  pricesFor,
  sortFlavors,
  type Flavor,
  type FlavorPrice,
} from '../views/Flavors.js'

// ─────────────────────────────────────────────────────────────────────────────

async function loadAll(): Promise<{ flavors: Flavor[]; prices: FlavorPrice[] }> {
  const [flavors, prices] = await Promise.all([
    api.get<Flavor[]>('/flavors'),
    api.get<FlavorPrice[]>('/flavor-prices'),
  ])
  return { flavors, prices }
}

function parseDollars(raw: unknown): number | null {
  if (raw == null) return null
  const s = String(raw).trim().replace(/\$/g, '').replace(/—/g, '').trim()
  if (s === '') return null
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : null
}

// ─────────────────────────────────────────────────────────────────────────────

export const flavorsRoutes = new Hono()

// Always prepend doctype so the browser doesn't fall into quirks mode.
async function htmlPage(c: Context, jsx: HtmlOrPromise): Promise<Response> {
  const resolved = await jsx
  return c.html('<!DOCTYPE html>' + String(resolved))
}

// ───── Whole page ─────
flavorsRoutes.get('/flavors', async (c) => {
  const showArchived = c.req.query('archived') === '1'
  const { flavors, prices } = await loadAll()
  const visible = showArchived ? flavors : flavors.filter((f) => f.isActive)
  return htmlPage(c, <FlavorsView flavors={visible} prices={prices} showArchived={showArchived} />)
})

// ───── Flavor mutations ─────
flavorsRoutes.post('/flavors', async (c) => {
  const created = await api.post<Flavor>('/flavors', { name: 'New Flavor', unitPrice: 5, unitCost: null })
  const { flavors, prices } = await loadAll()
  return c.html(
    <FlavorsCard
      flavors={flavors.filter((f) => f.isActive)}
      prices={prices}
      newFlavorId={created?.id}
    />,
  )
})

flavorsRoutes.delete('/flavors/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await api.del(`/flavors/${id}`)
  const { flavors, prices } = await loadAll()
  return c.html(<FlavorsCard flavors={flavors.filter((f) => f.isActive)} prices={prices} />)
})

// ───── Flavor cell (name) ─────
flavorsRoutes.get('/flavors/:id/cell/name', async (c) => {
  const id = Number(c.req.param('id'))
  const flavors = await api.get<Flavor[]>('/flavors')
  const f = flavors.find((x) => x.id === id)
  if (!f) return c.notFound()
  return c.html(<FlavorNameEdit f={f} />)
})

flavorsRoutes.get('/flavors/:id/cell/name/cancel', async (c) => {
  const id = Number(c.req.param('id'))
  const flavors = await api.get<Flavor[]>('/flavors')
  const f = flavors.find((x) => x.id === id)
  if (!f) return c.notFound()
  return c.html(<FlavorNameCell f={f} />)
})

flavorsRoutes.patch('/flavors/:id/cell/name', async (c) => {
  const id = Number(c.req.param('id'))
  const form = await c.req.parseBody()
  const name = String(form.name ?? '').trim()
  if (name) {
    await api.patch<Flavor>(`/flavors/${id}`, { name })
  }
  const flavors = await api.get<Flavor[]>('/flavors')
  const f = flavors.find((x) => x.id === id)
  if (!f) return c.notFound()
  return c.html(<FlavorNameCell f={f} />)
})

// ───── Add-tier toggle (open + cancel) ─────
flavorsRoutes.get('/flavors/:id/add-tier', async (c) => {
  const id = Number(c.req.param('id'))
  const { flavors, prices } = await loadAll()
  const f = flavors.find((x) => x.id === id)
  if (!f) return c.notFound()
  const ordered = sortFlavors(flavors.filter((x) => x.isActive))
  const idx = ordered.findIndex((x) => x.id === id)
  return c.html(
    <FlavorBlock
      flavor={f}
      prices={prices}
      index={idx >= 0 ? idx : 0}
      total={ordered.length}
      addingTier
    />,
  )
})

flavorsRoutes.get('/flavors/:id/cancel-add-tier', async (c) => {
  const id = Number(c.req.param('id'))
  const { flavors, prices } = await loadAll()
  const f = flavors.find((x) => x.id === id)
  if (!f) return c.notFound()
  const ordered = sortFlavors(flavors.filter((x) => x.isActive))
  const idx = ordered.findIndex((x) => x.id === id)
  return c.html(
    <FlavorBlock
      flavor={f}
      prices={prices}
      index={idx >= 0 ? idx : 0}
      total={ordered.length}
    />,
  )
})

// ───── Flavor-price mutations ─────
flavorsRoutes.post('/flavor-prices', async (c) => {
  const form = await c.req.parseBody()
  const flavorId = Number(form.flavorId ?? c.req.query('flavorId') ?? 0)
  const tierName = String(form.tierName ?? '').trim() || 'New Rate'
  const price = parseDollars(form.price) ?? 0
  const cost = parseDollars(form.cost)
  if (flavorId > 0) {
    await api.post<FlavorPrice>('/flavor-prices', { flavorId, tierName, price, cost })
  }
  const { flavors, prices } = await loadAll()
  const f = flavors.find((x) => x.id === flavorId)
  if (!f) {
    return c.html(<FlavorsCard flavors={flavors.filter((x) => x.isActive)} prices={prices} />)
  }
  const ordered = sortFlavors(flavors.filter((x) => x.isActive))
  const idx = ordered.findIndex((x) => x.id === flavorId)
  return c.html(
    <FlavorBlock flavor={f} prices={prices} index={idx >= 0 ? idx : 0} total={ordered.length} />,
  )
})

flavorsRoutes.delete('/flavor-prices/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await api.del(`/flavor-prices/${id}`)
  // Removing the row by swapping it with an empty fragment so the table reflow
  // doesn't reload the whole card.
  return c.body('', 200)
})

// ───── Price-cell handlers (tierName / price / cost) ─────
async function findPrice(id: number): Promise<FlavorPrice | null> {
  const prices = await api.get<FlavorPrice[]>('/flavor-prices')
  return prices.find((p) => p.id === id) ?? null
}

flavorsRoutes.get('/flavor-prices/:id/cell/tierName', async (c) => {
  const p = await findPrice(Number(c.req.param('id')))
  if (!p) return c.notFound()
  return c.html(<PriceTierNameEdit p={p} />)
})

flavorsRoutes.get('/flavor-prices/:id/cell/tierName/cancel', async (c) => {
  const p = await findPrice(Number(c.req.param('id')))
  if (!p) return c.notFound()
  return c.html(<PriceTierNameCell p={p} />)
})

flavorsRoutes.patch('/flavor-prices/:id/cell/tierName', async (c) => {
  const id = Number(c.req.param('id'))
  const form = await c.req.parseBody()
  const tierName = String(form.tierName ?? '').trim()
  if (tierName) {
    await api.patch<FlavorPrice>(`/flavor-prices/${id}`, { tierName })
  }
  const p = await findPrice(id)
  if (!p) return c.notFound()
  return c.html(<PriceTierNameCell p={p} />)
})

flavorsRoutes.get('/flavor-prices/:id/cell/price', async (c) => {
  const p = await findPrice(Number(c.req.param('id')))
  if (!p) return c.notFound()
  return c.html(<PriceTierPriceEdit p={p} />)
})

flavorsRoutes.get('/flavor-prices/:id/cell/price/cancel', async (c) => {
  const p = await findPrice(Number(c.req.param('id')))
  if (!p) return c.notFound()
  return c.html(<PriceTierPriceCell p={p} />)
})

flavorsRoutes.patch('/flavor-prices/:id/cell/price', async (c) => {
  const id = Number(c.req.param('id'))
  const form = await c.req.parseBody()
  const price = parseDollars(form.price)
  if (price != null) {
    await api.patch<FlavorPrice>(`/flavor-prices/${id}`, { price })
  }
  const p = await findPrice(id)
  if (!p) return c.notFound()
  return c.html(<PriceTierPriceCell p={p} />)
})

flavorsRoutes.get('/flavor-prices/:id/cell/cost', async (c) => {
  const p = await findPrice(Number(c.req.param('id')))
  if (!p) return c.notFound()
  return c.html(<PriceTierCostEdit p={p} />)
})

flavorsRoutes.get('/flavor-prices/:id/cell/cost/cancel', async (c) => {
  const p = await findPrice(Number(c.req.param('id')))
  if (!p) return c.notFound()
  return c.html(<PriceTierCostCell p={p} />)
})

flavorsRoutes.patch('/flavor-prices/:id/cell/cost', async (c) => {
  const id = Number(c.req.param('id'))
  const form = await c.req.parseBody()
  const cost = parseDollars(form.cost)
  await api.patch<FlavorPrice>(`/flavor-prices/${id}`, { cost })
  const p = await findPrice(id)
  if (!p) return c.notFound()
  return c.html(<PriceTierCostCell p={p} />)
})

// Silence unused-import warnings (the symbols are part of the public surface).
export { pricesFor, AddTierRow }

export default flavorsRoutes
