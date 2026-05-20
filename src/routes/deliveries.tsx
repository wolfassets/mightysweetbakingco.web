import { Hono } from 'hono'
import { api } from '../lib/api.js'
import { DeliveriesPage, DeliveriesCard, DeliveryRow, type Delivery, type SortColumn, type ViewMode } from '../views/Deliveries.js'

export const deliveriesRoutes = new Hono()

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const VALID_SORT: ReadonlySet<SortColumn> = new Set<SortColumn>([
  'id',
  'storeName',
  'datePrepared',
  'dropoffDate',
  'totalPrepared',
  'totalRevenue',
  'totalCogs',
  'grossProfit',
])

const parseSort = (raw: string | undefined): SortColumn => (raw && VALID_SORT.has(raw as SortColumn) ? (raw as SortColumn) : 'id')
const parseDir = (raw: string | undefined): 'asc' | 'desc' => (raw === 'asc' ? 'asc' : 'desc')
const parseView = (raw: string | undefined): ViewMode => (raw === 'by-store' || raw === 'byStore' ? 'byStore' : 'list')

/** Accept either repeated `?stores=A&stores=B` or comma-joined `?stores=A,B`. */
function parseStores(c: { req: { queries: (k: string) => string[] | undefined; query: (k: string) => string | undefined } }): string[] {
  const multi = c.req.queries('stores')
  if (multi && multi.length > 0) {
    const flat = multi.flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean)
    return Array.from(new Set(flat))
  }
  const single = c.req.query('stores')
  if (!single) return []
  return Array.from(new Set(single.split(',').map((s) => s.trim()).filter(Boolean)))
}

interface QueryState {
  view: ViewMode
  sortColumn: SortColumn
  sortDirection: 'asc' | 'desc'
  showArchived: boolean
  selectedStores: string[]
  dateFrom: string | null
  dateTo: string | null
  revenueMin: string
  revenueMax: string
  profitMin: string
  profitMax: string
  preparedMin: string
  preparedMax: string
  openFilter: 'store' | 'date' | 'advanced' | 'add' | null
}

function readQuery(c: { req: { queries: (k: string) => string[] | undefined; query: (k: string) => string | undefined } }): QueryState {
  const q = (k: string) => c.req.query(k)
  const of = q('openFilter')
  const openFilter = of === 'store' || of === 'date' || of === 'advanced' || of === 'add' ? of : null
  return {
    view: parseView(q('view')),
    sortColumn: parseSort(q('sort')),
    sortDirection: parseDir(q('dir')),
    showArchived: q('archived') === '1',
    selectedStores: parseStores(c),
    dateFrom: q('dateFrom') || null,
    dateTo: q('dateTo') || null,
    revenueMin: q('revenueMin') ?? '',
    revenueMax: q('revenueMax') ?? '',
    profitMin: q('profitMin') ?? '',
    profitMax: q('profitMax') ?? '',
    preparedMin: q('preparedMin') ?? '',
    preparedMax: q('preparedMax') ?? '',
    openFilter,
  }
}

const html = (jsx: { toString(): string }) => '<!DOCTYPE html>' + jsx.toString()

// ─────────────────────────────────────────────────────────────────────────────
// GET /deliveries
// ─────────────────────────────────────────────────────────────────────────────

deliveriesRoutes.get('/deliveries', async (c) => {
  const state = readQuery(c)
  const url = state.showArchived ? '/deliveries?archived=true' : '/deliveries'
  const deliveries = await api.get<Delivery[]>(url)
  return c.html(html(<DeliveriesPage deliveries={deliveries} {...state} />))
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /deliveries — create + return refreshed card
// ─────────────────────────────────────────────────────────────────────────────

deliveriesRoutes.post('/deliveries', async (c) => {
  const form = await c.req.parseBody()
  await api.post<Delivery>('/deliveries', {
    storeName: String(form.storeName ?? '').trim(),
    location: form.location ? String(form.location) : null,
    datePrepared: String(form.datePrepared ?? new Date().toISOString().slice(0, 10)),
    dropoffDate: form.dropoffDate ? String(form.dropoffDate) : null,
  })
  const state = readQuery(c)
  const deliveries = await api.get<Delivery[]>(state.showArchived ? '/deliveries?archived=true' : '/deliveries')
  return c.html(<DeliveriesCard deliveries={deliveries} allDeliveries={deliveries} {...state} openFilter={null} view={state.view} />)
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /deliveries/:id — partial update, return updated row
// ─────────────────────────────────────────────────────────────────────────────

deliveriesRoutes.patch('/deliveries/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const form = await c.req.parseBody()
  const numericKeys = ['additionalFees', 'discount', 'prepaidAmount', 'cashCollected', 'venmoCollected', 'otherCollected']
  const nullableStringKeys = ['location', 'notes', 'invoiceNotes', 'dropoffDate', 'expirationDate']
  const body: Record<string, unknown> = {}
  for (const k of Object.keys(form)) {
    const v = form[k]
    if (numericKeys.includes(k)) body[k] = Number(v ?? 0)
    else if (nullableStringKeys.includes(k)) body[k] = v === '' ? null : String(v)
    else body[k] = String(v)
  }
  await api.patch(`/deliveries/${id}`, body)
  // Return refreshed row from the current filtered list
  const state = readQuery(c)
  const deliveries = await api.get<Delivery[]>(state.showArchived ? '/deliveries?archived=true' : '/deliveries')
  const updated = deliveries.find((d) => d.id === id)
  if (!updated) return c.body(null, 204)
  return c.html(<DeliveryRow d={updated} showArchived={state.showArchived} />)
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /deliveries/:id — soft archive, return refreshed card so the row vanishes
// ─────────────────────────────────────────────────────────────────────────────

deliveriesRoutes.delete('/deliveries/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const hard = c.req.query('hard') === 'true'
  await api.del(`/deliveries/${id}${hard ? '?hard=true' : ''}`)
  const state = readQuery(c)
  const deliveries = await api.get<Delivery[]>(state.showArchived ? '/deliveries?archived=true' : '/deliveries')
  return c.html(<DeliveriesCard deliveries={deliveries} allDeliveries={deliveries} {...state} openFilter={null} view={state.view} />)
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /deliveries/:id/restore — restore a soft-deleted delivery
// ─────────────────────────────────────────────────────────────────────────────

deliveriesRoutes.post('/deliveries/:id/restore', async (c) => {
  const id = Number(c.req.param('id'))
  await api.patch(`/deliveries/${id}`, { deletedAt: null })
  const state = readQuery(c)
  const deliveries = await api.get<Delivery[]>(state.showArchived ? '/deliveries?archived=true' : '/deliveries')
  return c.html(<DeliveriesCard deliveries={deliveries} allDeliveries={deliveries} {...state} openFilter={null} view={state.view} />)
})

export default deliveriesRoutes
