import { Hono } from 'hono'
import type { JSX } from 'hono/jsx'

import { api } from '../lib/api.js'
import { EventDetailPage, EventItemRow } from '../views/EventDetail.js'
import type { Event, EventItem } from '../views/Events.js'
import type { Flavor, FlavorPrice } from '../views/Flavors.js'

const eventDetail = new Hono()

const page = (c: { html: (s: string) => Response }, jsx: JSX.Element) =>
  c.html('<!DOCTYPE html>' + jsx.toString())

// ────────────────────────────────────────────────────────────
// Parse an htmx-submitted body. The view uses hx-vals js:{...}
// which sends JSON. The add-flavor form is parseBody (form-data).
// ────────────────────────────────────────────────────────────

async function readBody(c: Parameters<Parameters<typeof eventDetail.patch>[1]>[0]): Promise<Record<string, unknown>> {
  const ct = c.req.header('content-type') ?? ''
  if (ct.includes('application/json')) {
    return (await c.req.json()) as Record<string, unknown>
  }
  return (await c.req.parseBody()) as Record<string, unknown>
}

// Coerce known numeric / nullable fields to the right shape for the api validator
function coerceEventPatch(body: Record<string, unknown>): Record<string, unknown> {
  const numeric = ['eventCost', 'cashCollected', 'venmoCollected', 'otherCollected']
  const nullableString = ['location', 'notes']
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(body)) {
    const v = body[k]
    if (numeric.includes(k)) {
      out[k] = typeof v === 'number' ? v : Number(v ?? 0)
    } else if (nullableString.includes(k)) {
      out[k] = v === '' || v == null ? null : String(v)
    } else if (k === 'eventDate' || k === 'name') {
      out[k] = String(v ?? '')
    } else {
      out[k] = v
    }
  }
  return out
}

// ────────────────────────────────────────────────────────────
// GET /events/:id — full detail page
// ────────────────────────────────────────────────────────────

eventDetail.get('/events/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [eventResp, items, flavors, prices, allEvents] = await Promise.all([
    api.get<Event & { items?: EventItem[] }>(`/events/${id}`),
    api.get<EventItem[]>(`/event-items?eventId=${id}`),
    api.get<Flavor[]>(`/flavors?includeArchived=true`),
    api.get<FlavorPrice[]>(`/flavor-prices?includeArchived=true`),
    api.get<Event[]>('/events'),
  ])
  // eventResp may have items already merged; we already fetched separately
  const event = eventResp as Event
  if (!event || !event.id) return c.notFound()
  return page(
    c,
    EventDetailPage({
      event,
      items: items ?? [],
      flavors: flavors ?? [],
      prices: prices ?? [],
      allEvents: allEvents ?? [],
    }) as JSX.Element,
  )
})

// ────────────────────────────────────────────────────────────
// PATCH /events/:id — inline edit field
// Returns 204 (hx-swap=none on every input)
// ────────────────────────────────────────────────────────────

eventDetail.patch('/events/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const raw = await readBody(c)
  const body = coerceEventPatch(raw)
  try {
    await api.patch(`/events/${id}`, body)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
  return c.body(null, 204)
})

// ────────────────────────────────────────────────────────────
// DELETE /events/:id — soft archive, then HX-Redirect to /events
// ────────────────────────────────────────────────────────────

eventDetail.delete('/events/:id', async (c) => {
  const id = Number(c.req.param('id'))
  try {
    await api.del(`/events/${id}`)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
  c.header('HX-Redirect', '/events')
  return c.body(null, 200)
})

// ────────────────────────────────────────────────────────────
// POST /event-items — add flavor to event
// Body: form-encoded { eventId, flavorId, rateId, prepared }
// Returns: <tr/> for the new item (appended to tbody)
// ────────────────────────────────────────────────────────────

eventDetail.post('/event-items', async (c) => {
  const form = await c.req.parseBody()
  const eventId = Number(form.eventId)
  const flavorId = Number(form.flavorId)
  const rateId = form.rateId ? Number(form.rateId) : null
  const prepared = Number(form.prepared ?? 0)

  const [flavors, prices] = await Promise.all([
    api.get<Flavor[]>('/flavors?includeArchived=true'),
    api.get<FlavorPrice[]>('/flavor-prices?includeArchived=true'),
  ])
  const flavor = flavors.find((f) => f.id === flavorId)
  if (!flavor) return c.json({ error: 'Flavor not found' }, 400)
  const rate = rateId ? prices.find((p) => p.id === rateId) : null
  const unitCost = rate?.cost ?? flavor.unitCost ?? null

  try {
    await api.post<EventItem>('/event-items', {
      eventId,
      flavorName: flavor.name,
      prepared,
      remaining: prepared,
      giveaway: 0,
      sold: 0,
      unitCost,
      rateId: rate?.id ?? null,
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }

  // Return the freshly added row(s) for the tbody append.
  // Easier: fetch all items for this event, return only the new one.
  const items = await api.get<EventItem[]>(`/event-items?eventId=${eventId}`)
  const latest = items[items.length - 1]
  if (!latest) return c.body('', 200)
  return c.html(EventItemRow({ it: latest as any, flavors, prices }) as JSX.Element)
})

// ────────────────────────────────────────────────────────────
// PATCH /event-items/:id — edit one numeric field (prepared/sold/etc)
// Body: JSON {field: value}
// Returns: <tr/> outerHTML for the refreshed row.
// ────────────────────────────────────────────────────────────

eventDetail.patch('/event-items/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const raw = await readBody(c)
  // Sanitize
  const body: Record<string, unknown> = {}
  for (const k of Object.keys(raw)) {
    const v = raw[k]
    if (['prepared', 'remaining', 'giveaway', 'sold'].includes(k)) {
      body[k] = typeof v === 'number' ? v : Number(v ?? 0)
    } else if (k === 'unitCost') {
      body[k] = v === '' || v == null ? null : Number(v)
    } else if (k === 'rateId') {
      body[k] = v == null || v === '' ? null : Number(v)
    } else {
      body[k] = v
    }
  }

  try {
    await api.patch(`/event-items/${id}`, body)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }

  // Re-fetch the row + return as updated tr
  const all = await api.get<EventItem[]>('/event-items')
  const it = all.find((x) => x.id === id)
  if (!it) return c.body(null, 204)
  const [flavors, prices] = await Promise.all([
    api.get<Flavor[]>('/flavors?includeArchived=true'),
    api.get<FlavorPrice[]>('/flavor-prices?includeArchived=true'),
  ])
  return c.html(EventItemRow({ it: it as any, flavors, prices }) as JSX.Element)
})

// ────────────────────────────────────────────────────────────
// PATCH /event-items/:id/rate — change rate (tier) dropdown
// Body: JSON {tierName: string}
// Looks up the matching rate and updates unitCost + rateId server-side.
// ────────────────────────────────────────────────────────────

eventDetail.patch('/event-items/:id/rate', async (c) => {
  const id = Number(c.req.param('id'))
  const raw = await readBody(c)
  const tierName = String(raw.tierName ?? '')
  if (!tierName) return c.body(null, 204)

  // Find the item's flavor → find the matching rate
  const [all, flavors, prices] = await Promise.all([
    api.get<EventItem[]>('/event-items'),
    api.get<Flavor[]>('/flavors?includeArchived=true'),
    api.get<FlavorPrice[]>('/flavor-prices?includeArchived=true'),
  ])
  const it = all.find((x) => x.id === id)
  if (!it) return c.body(null, 204)
  const flavor = flavors.find((f) => f.name === it.flavorName)
  if (!flavor) return c.body(null, 204)
  const rate = prices.find((p) => p.flavorId === flavor.id && p.tierName === tierName)
  if (!rate) return c.body(null, 204)

  try {
    await api.patch(`/event-items/${id}`, {
      unitCost: rate.cost ?? null,
      rateId: rate.id,
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }

  const refreshed = await api.get<EventItem[]>('/event-items')
  const newIt = refreshed.find((x) => x.id === id)
  if (!newIt) return c.body(null, 204)
  return c.html(EventItemRow({ it: newIt as any, flavors, prices }) as JSX.Element)
})

// ────────────────────────────────────────────────────────────
// DELETE /event-items/:id — remove an item
// Returns empty string (hx-swap=outerHTML removes the row)
// ────────────────────────────────────────────────────────────

eventDetail.delete('/event-items/:id', async (c) => {
  const id = Number(c.req.param('id'))
  try {
    await api.del(`/event-items/${id}`)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
  return c.body('', 200)
})

export default eventDetail
