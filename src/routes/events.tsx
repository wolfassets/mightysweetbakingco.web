import { Hono } from 'hono'
import { api } from '../lib/api.js'
import {
  EventsPage,
  EventsTableBody,
  EventRow,
  sortEvents,
  type Event,
  type SortColumn,
  type SortDir,
} from '../views/Events.js'

const VALID_SORT: ReadonlySet<SortColumn> = new Set([
  'id',
  'name',
  'eventDate',
  'totalPrepared',
  'totalSold',
  'totalGiveaway',
  'totalRevenue',
  'totalCost',
  'netProfit',
  'eventCost',
])

function parseSortParams(c: { req: { query: (k: string) => string | undefined } }): {
  sort: SortColumn
  dir: SortDir
  archived: boolean
} {
  const rawSort = c.req.query('sort')
  const sort: SortColumn = rawSort && VALID_SORT.has(rawSort as SortColumn) ? (rawSort as SortColumn) : 'id'
  const rawDir = c.req.query('dir')
  const dir: SortDir = rawDir === 'asc' ? 'asc' : 'desc'
  const archived = c.req.query('archived') === '1' || c.req.query('archived') === 'true'
  return { sort, dir, archived }
}

// Wrap every JSX literal in a small html() shim so the returned response
// always has the right content-type even when we hand back a partial.
const eventsRoutes = new Hono()

// ───── GET /events — full page OR table-body partial (htmx sort/filter) ─────
eventsRoutes.get('/events', async (c) => {
  const { sort, dir, archived } = parseSortParams(c)
  const path = archived ? '/events?archived=true' : '/events'
  const events = await api.get<Event[]>(path)

  // htmx requests that target the table body get just the <tbody> back.
  if (c.req.header('hx-target') === 'events-table-body') {
    const sorted = sortEvents(events, sort, dir)
    return c.html(
      <EventsTableBody events={sorted} sortColumn={sort} sortDirection={dir} showArchived={archived} />,
    )
  }

  // Full page render. The route handler in index.tsx wraps with the page()
  // helper that prepends <!DOCTYPE html> — we do the same here.
  const html = '<!DOCTYPE html>' + (
    <EventsPage events={events} sortColumn={sort} sortDirection={dir} showArchived={archived} />
  ).toString()
  return c.html(html)
})

// ───── POST /events — add new event (form submit) ─────
eventsRoutes.post('/events', async (c) => {
  const form = await c.req.parseBody()
  const name = String(form.name ?? '').trim() || 'New Event'
  const eventDate = String(form.eventDate ?? new Date().toISOString().slice(0, 10))
  const location = form.location ? String(form.location) : null
  await api.post<Event>('/events', { name, eventDate, location })

  // Refresh table body (preserve sort/filter from referer if present).
  const { sort, dir, archived } = parseSortParams(c)
  const path = archived ? '/events?archived=true' : '/events'
  const events = await api.get<Event[]>(path)
  const sorted = sortEvents(events, sort, dir)
  return c.html(
    <EventsTableBody events={sorted} sortColumn={sort} sortDirection={dir} showArchived={archived} />,
  )
})

// ───── POST /events/quick-add — mimic web-b's "Add Event" button ─────
// Creates a placeholder event with today's date, then redirects to detail.
eventsRoutes.post('/events/quick-add', async (c) => {
  const created = await api.post<Event>('/events', {
    name: 'New Event',
    eventDate: new Date().toISOString().slice(0, 10),
  })
  c.header('HX-Redirect', `/events/${created.id}`)
  return c.body(null, 200)
})

// ───── PATCH /events/:id — partial update, returns updated row ─────
eventsRoutes.patch('/events/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const form = await c.req.parseBody()
  const body: Record<string, unknown> = {}
  for (const k of Object.keys(form)) {
    const v = form[k]
    if (k === 'eventCost' || k === 'cashCollected' || k === 'venmoCollected' || k === 'otherCollected') {
      body[k] = Number(v ?? 0)
    } else if (k === 'location' || k === 'notes') {
      body[k] = v === '' ? null : String(v)
    } else {
      body[k] = String(v)
    }
  }
  await api.patch(`/events/${id}`, body)

  const { archived } = parseSortParams(c)
  const path = archived ? '/events?archived=true' : '/events'
  const events = await api.get<Event[]>(path)
  const updated = events.find((e) => e.id === id)
  if (!updated) return c.body(null, 204)
  return c.html(<EventRow e={updated} showArchived={archived} />)
})

// ───── DELETE /events/:id — soft archive (or hard delete if ?hard=true) ─────
eventsRoutes.delete('/events/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const hard = c.req.query('hard') === 'true'
  const suffix = hard ? '?hard=true' : ''
  await api.del(`/events/${id}${suffix}`)

  // If the request targeted a single row (HoldArchiveButton), swap with
  // either an empty fragment (hard) or the archived row (soft).
  const target = c.req.header('hx-target')
  if (target && target.startsWith('event-')) {
    if (hard) return c.body('', 200)
    // Refetch the archived event so we can render it as a "restorable" row.
    const archivedList = await api.get<Event[]>('/events?archived=true')
    const restored = archivedList.find((e) => e.id === id)
    if (restored) return c.html(<EventRow e={restored} showArchived={true} />)
    return c.body('', 200)
  }

  c.header('HX-Redirect', '/events')
  return c.body(null, 200)
})

// ───── POST /events/:id/restore — un-archive ─────
eventsRoutes.post('/events/:id/restore', async (c) => {
  const id = Number(c.req.param('id'))
  await api.patch(`/events/${id}`, { deletedAt: null })
  const events = await api.get<Event[]>('/events')
  const restored = events.find((e) => e.id === id)
  if (!restored) return c.body('', 200)
  return c.html(<EventRow e={restored} showArchived={false} />)
})

export default eventsRoutes
export { eventsRoutes }
