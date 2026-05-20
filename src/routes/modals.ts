/**
 * Modal fragments router.
 *
 * All endpoints below return HTML fragments meant to be swapped into either
 * the global `#modal-root` slot (which lives in Layout.tsx — see report)
 * or, in the case of the deliveries-map detail card, the
 * `#deliveries-map-detail` slot inside the open map modal.
 *
 * Filename note: the spec mandates `routes/modals.ts` (no .tsx). We honor
 * that by invoking the JSX FCs as plain functions — same pattern as
 * `routes/activity.ts` / `routes/event-detail.ts`. JSX lives entirely in
 * the corresponding view file (`views/Modals.tsx`).
 *
 * Mount in index.tsx via:
 *   import modalsRoutes from './routes/modals.js'
 *   app.route('/', modalsRoutes)
 * (every route already includes its `/modals/...` prefix.)
 */

import { Hono } from 'hono'
import type { JSX } from 'hono/jsx'
import { api } from '../lib/api.js'
import {
  AddStoreChoice,
  AddStoreExisting,
  AddStoreNew,
  DeliveriesMapModalView,
  DeliveryDetailCard,
} from '../views/Modals.js'
import { DeliveriesTableView, type Delivery } from '../views/Deliveries.js'

const modalsRoutes = new Hono()

// ───── Helpers ─────
function normalizeStore(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function uniqueStoreNames(deliveries: Delivery[]): string[] {
  const seen = new Map<string, string>()
  for (const d of deliveries) {
    if (d.deletedAt) continue
    const key = normalizeStore(d.storeName)
    if (!seen.has(key)) seen.set(key, d.storeName.trim())
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

// ───── Generic "close" target ─────
// Anything that wants to clear a modal slot can hx-get this and swap into
// the target. The body is intentionally empty.
modalsRoutes.get('/modals/empty', (c) => c.html(''))

// ───── AddStoreModal ─────
modalsRoutes.get('/modals/add-store', async (c) => {
  const deliveries = await api.get<Delivery[]>('/deliveries')
  const stores = uniqueStoreNames(deliveries)
  return c.html(AddStoreChoice({ storeCount: stores.length }) as JSX.Element)
})

modalsRoutes.get('/modals/add-store/existing', async (c) => {
  const deliveries = await api.get<Delivery[]>('/deliveries')
  const stores = uniqueStoreNames(deliveries)
  return c.html(AddStoreExisting({ stores }) as JSX.Element)
})

modalsRoutes.get('/modals/add-store/new', (c) =>
  c.html(AddStoreNew({}) as JSX.Element),
)

// POST /modals/add-store — create a delivery + close modal + refresh list.
//
// The hx-on--after-request handler on the form clears #modal-root on
// success. The response body is the refreshed #delivery-list fragment so
// the list updates without a full reload. We also set HX-Trigger so
// anything subscribed to `delivery-created` (e.g. an audit pulse) can react.
modalsRoutes.post('/modals/add-store', async (c) => {
  const form = await c.req.parseBody()
  const storeName = String(form.storeName ?? '').trim()
  if (!storeName) {
    return c.html(
      '<div class="text-callout text-red-500 px-4 py-2">Store name is required.</div>',
      400,
    )
  }
  const datePrepared = String(
    form.datePrepared ?? new Date().toISOString().slice(0, 10),
  )
  await api.post<Delivery>('/deliveries', { storeName, datePrepared })
  const deliveries = await api.get<Delivery[]>('/deliveries')
  c.header('HX-Trigger', 'delivery-created')
  const table = DeliveriesTableView({
    deliveries: deliveries.filter((d) => !d.deletedAt),
    view: 'by-date',
  }) as JSX.Element
  // Wrap so the existing #delivery-list outerHTML swap target matches.
  const html = `<div id="delivery-list">${table.toString()}</div>`
  return c.html(html)
})

// ───── DeliveriesMapModal ─────
modalsRoutes.get('/modals/deliveries-map', async (c) => {
  const deliveries = await api.get<Delivery[]>('/deliveries')
  return c.html(DeliveriesMapModalView({ deliveries }) as JSX.Element)
})

// Detail card lookup — the side list rows + map marker selects both target
// this. Returns just the card fragment to inject into
// #deliveries-map-detail.
modalsRoutes.get('/modals/deliveries-map/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const deliveries = await api.get<Delivery[]>('/deliveries')
  const d = deliveries.find((x) => x.id === id)
  if (!d) return c.html('', 404)
  return c.html(DeliveryDetailCard({ d }) as JSX.Element)
})

export default modalsRoutes
export { modalsRoutes }
