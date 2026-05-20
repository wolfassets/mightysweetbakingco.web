import type { FC, PropsWithChildren } from 'hono/jsx'
import { Fragment } from 'hono/jsx'
import { Layout } from './Layout.js'
import { HoldArchiveButton } from './components.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types (kept verbatim from web-b)
// ─────────────────────────────────────────────────────────────────────────────

export interface Delivery {
  id: number
  storeName: string
  location: string | null
  datePrepared: string
  dropoffDate: string | null
  expirationDate: string | null
  totalPrepared: number
  totalCogs: number
  totalRevenue: number
  grossProfit: number
  profitMargin: number
  notes: string | null
  invoiceNotes?: string | null
  additionalFees?: number
  discount?: number
  prepaidAmount?: number
  cashCollected?: number
  venmoCollected?: number
  otherCollected?: number
  deletedAt: string | null
  createdAt?: string
}

export type SortColumn =
  | 'id'
  | 'storeName'
  | 'datePrepared'
  | 'dropoffDate'
  | 'totalPrepared'
  | 'totalRevenue'
  | 'totalCogs'
  | 'grossProfit'

export type ViewMode = 'list' | 'byStore'
// Public view-prop accepts both naming conventions
export type ViewProp = ViewMode | 'by-date' | 'by-store'

export interface DeliveriesPageProps {
  deliveries: Delivery[]
  view: ViewProp
  sortColumn?: SortColumn
  sortDirection?: 'asc' | 'desc'
  showArchived?: boolean
  selectedStores?: string[]
  dateFrom?: string | null
  dateTo?: string | null
  revenueMin?: string
  revenueMax?: string
  profitMin?: string
  profitMax?: string
  preparedMin?: string
  preparedMax?: string
  openFilter?: 'store' | 'date' | 'advanced' | 'add' | null
}

const normalizeView = (v: ViewProp): ViewMode => (v === 'by-store' || v === 'byStore' ? 'byStore' : 'list')

// ─────────────────────────────────────────────────────────────────────────────
// Local helpers — mirror web-b's component-private formatting
// ─────────────────────────────────────────────────────────────────────────────

const normalizeStore = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

const formatCurrency = (amount: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

const formatDateFull = (dateString: string) => {
  const date = new Date(dateString + 'T00:00:00')
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
  const rest = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  return (
    <>
      <span class="text-callout text-gray-400 dark:text-zinc-500 mr-3">{weekday}</span>
      <span>{rest}</span>
    </>
  )
}

const formatDateShort = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const formatDateMD = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const buildQuery = (overrides: Record<string, string | null | undefined>, base: Record<string, string | null | undefined>): string => {
  const merged: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) {
    if (v != null && v !== '') merged[k] = v as string
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v == null || v === '') delete merged[k]
    else merged[k] = v
  }
  const qs = new URLSearchParams(merged).toString()
  return qs ? `?${qs}` : ''
}

// ─────────────────────────────────────────────────────────────────────────────
// Sortable Header — replaces web-b's <SortableHeader /> w/ link nav
// ─────────────────────────────────────────────────────────────────────────────

const SortableHeader: FC<{
  label: string
  column: SortColumn
  currentColumn: SortColumn
  direction: 'asc' | 'desc'
  baseQuery: Record<string, string | null | undefined>
  class?: string
}> = ({ label, column, currentColumn, direction, baseQuery, class: cls = '' }) => {
  const isActive = currentColumn === column
  const nextDir = isActive ? (direction === 'asc' ? 'desc' : 'asc') : 'desc'
  const href = `/deliveries${buildQuery({ sort: column, dir: nextDir }, baseQuery)}`
  const isRight = cls.includes('text-right')
  const isCenter = cls.includes('text-center')
  return (
    <th class={`cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-[#171717] transition-colors ${cls}`}>
      <a href={href} class="block">
        <div class={`flex items-center gap-1 ${isRight ? 'justify-end' : isCenter ? 'justify-center' : ''}`}>
          <span>{label}</span>
          {isActive && (
            <svg
              class={`w-3 h-3 text-pink-500 dark:text-pink-400 transition-transform ${direction === 'desc' ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
            </svg>
          )}
        </div>
      </a>
    </th>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat Card — same layout, no animated number (server-rendered, static value)
// ─────────────────────────────────────────────────────────────────────────────

const StatCard: FC<{ label: string; value: string; sublabel?: string; highlight?: boolean }> = ({
  label,
  value,
  sublabel,
  highlight,
}) => (
  <div class="p-4 bg-[#fafafa] dark:bg-[#171717] rounded-2xl">
    <p class="text-headline text-gray-700 dark:text-zinc-300">{label}</p>
    <p class={`text-title-2 mt-1 ${highlight ? 'text-pink-600 dark:text-pink-400' : 'text-gray-900 dark:text-zinc-100'}`}>{value}</p>
    {sublabel && <p class="text-headline text-gray-500 dark:text-zinc-400 mt-1">{sublabel}</p>}
  </div>
)

// ─────────────────────────────────────────────────────────────────────────────
// Filter Pill — link-based toggle (no JS state). `isOpen` is driven by ?openFilter=
// ─────────────────────────────────────────────────────────────────────────────

const FilterPill: FC<
  PropsWithChildren<{
    label: string
    active: boolean
    activeText: string | null
    isOpen: boolean
    openHref: string
    closeHref: string
    clearHref: string
    popoverWidth?: string
  }>
> = ({ label, active, activeText, isOpen, openHref, closeHref, clearHref, popoverWidth = 'w-72', children }) => {
  // Use the openHref to derive a stable popover key (e.g. "store", "date", "advanced").
  const key = (openHref.match(/openFilter=([^&]+)/) || [])[1] || label.toLowerCase()
  return (
    <div class="relative" data-pill={key}>
      <button
        type="button"
        data-pill-trigger={key}
        class={`px-4 py-1.5 rounded-full text-button transition-all flex items-center gap-2 border ${
          active
            ? 'bg-pink-50 dark:bg-pink-950/40 border-pink-200 dark:border-pink-900/60 text-pink-700 dark:text-pink-300'
            : isOpen
            ? 'bg-gray-100 dark:bg-[#1f1f1f] border-gray-300 dark:border-[#3f3f3f] text-gray-900 dark:text-zinc-100'
            : 'bg-white dark:bg-[#0a0a0a] border-gray-200 dark:border-[#262626] text-gray-700 dark:text-zinc-300 hover:bg-[#fafafa] dark:hover:bg-[#171717]'
        }`}
      >
        <span>{label}</span>
        {active && activeText && <span data-pill-active-text class="text-caption opacity-80 max-w-[160px] truncate">: {activeText}</span>}
        {active ? (
          <span
            data-pill-clear={key}
            onclick="event.stopPropagation();"
            role="button"
            tabindex={0}
            class="ml-0.5 opacity-60 hover:opacity-100 inline-flex cursor-pointer"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </span>
        ) : (
          <svg
            data-pill-chevron
            class={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      <div
        data-pill-popover={key}
        class={`absolute right-0 top-full mt-2 z-50 ${popoverWidth} bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-[#262626] rounded-2xl shadow-xl fade-in ${isOpen ? '' : 'hidden'}`}
      >
        {children}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Range row — pair of min/max inputs, GET form
// ─────────────────────────────────────────────────────────────────────────────

const RangeRow: FC<{
  label: string
  prefix: string
  minName: string
  maxName: string
  minValue: string
  maxValue: string
}> = ({ label, prefix, minName, maxName, minValue, maxValue }) => (
  <div>
    <label class="block text-caption uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-400 mb-1.5">{label}</label>
    <div class="flex items-center gap-2">
      <div class="relative flex-1">
        {prefix && <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500 text-callout">{prefix}</span>}
        <input
          type="number"
          name={minName}
          placeholder="Min"
          value={minValue}
          class={`w-full ${prefix ? 'pl-7' : 'pl-3'} pr-3 py-2 text-callout bg-gray-50 dark:bg-[#171717] border border-gray-200 dark:border-[#262626] rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-600`}
        />
      </div>
      <span class="text-gray-400 dark:text-zinc-500 text-callout">to</span>
      <div class="relative flex-1">
        {prefix && <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500 text-callout">{prefix}</span>}
        <input
          type="number"
          name={maxName}
          placeholder="Max"
          value={maxValue}
          class={`w-full ${prefix ? 'pl-7' : 'pl-3'} pr-3 py-2 text-callout bg-gray-50 dark:bg-[#171717] border border-gray-200 dark:border-[#262626] rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-600`}
        />
      </div>
    </div>
  </div>
)

// ─────────────────────────────────────────────────────────────────────────────
// Add-store form (replaces AddStoreModal: dropdown for existing + free-text)
// ─────────────────────────────────────────────────────────────────────────────

const AddStoreForm: FC<{ uniqueStores: string[]; isOpen: boolean }> = ({ uniqueStores, isOpen }) => {
  const today = new Date().toISOString().slice(0, 10)
  if (!isOpen) return null
  return (
    <div class="px-8 pb-4">
      <div class="bg-white dark:bg-[#0a0a0a] dark:border dark:border-[#262626] rounded-2xl shadow-sm p-5 fade-in">
        <form
          hx-post="/deliveries"
          hx-target="#deliveries-card"
          hx-swap="outerHTML"
          hx-on--after-request="if(event.detail.successful)this.reset()"
          class="grid grid-cols-12 gap-2 items-end"
        >
          <div class="col-span-5">
            <label class="block text-caption uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-400 mb-1.5">Store name</label>
            <input
              name="storeName"
              required
              list="existing-stores"
              placeholder="Type or pick a store"
              class="w-full px-3 py-2 text-callout bg-gray-50 dark:bg-[#171717] border border-gray-200 dark:border-[#262626] rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 text-gray-900 dark:text-zinc-100"
            />
            <datalist id="existing-stores">
              {uniqueStores.map((s) => (
                <option value={s} />
              ))}
            </datalist>
          </div>
          <div class="col-span-3">
            <label class="block text-caption uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-400 mb-1.5">Date prepared</label>
            <input
              name="datePrepared"
              type="date"
              required
              value={today}
              class="w-full px-3 py-2 text-callout bg-gray-50 dark:bg-[#171717] border border-gray-200 dark:border-[#262626] rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 text-gray-900 dark:text-zinc-100"
            />
          </div>
          <div class="col-span-3">
            <label class="block text-caption uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-400 mb-1.5">Location (optional)</label>
            <input
              name="location"
              placeholder="Address"
              class="w-full px-3 py-2 text-callout bg-gray-50 dark:bg-[#171717] border border-gray-200 dark:border-[#262626] rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 text-gray-900 dark:text-zinc-100"
            />
          </div>
          <button
            type="submit"
            class="col-span-1 px-4 py-2 text-button bg-pink-500 text-white rounded-lg hover:bg-pink-600 transition-colors"
          >
            Create
          </button>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Delivery rows (list view + by-store view)
// ─────────────────────────────────────────────────────────────────────────────

export const DeliveryRow: FC<{ d: Delivery; showArchived: boolean; hideStore?: boolean }> = ({ d, showArchived, hideStore }) => (
  <tr
    id={`delivery-${d.id}`}
    class="delivery-row group cursor-pointer hover:bg-[#fafafa] dark:hover:bg-[#171717] transition-colors fade-in"
    onclick={`window.location='/deliveries/${d.id}'`}
    data-store={d.storeName.trim().toLowerCase()}
    data-date={d.dropoffDate || d.datePrepared}
    data-rev={d.totalRevenue.toString()}
    data-prof={d.grossProfit.toString()}
    data-prep={d.totalPrepared.toString()}
  >
    <td>
      <span class="px-2 py-3 min-h-[44px] flex items-center justify-center text-pink-600 dark:text-pink-400 text-callout">{d.id}</span>
    </td>
    {!hideStore && (
      <td>
        <span class="px-4 py-3 min-h-[44px] flex items-center text-gray-900 dark:text-zinc-100 text-headline">{d.storeName}</span>
      </td>
    )}
    <td>
      <span class="px-4 py-3 min-h-[44px] flex items-center text-gray-600 dark:text-zinc-400 text-callout whitespace-nowrap">
        {d.dropoffDate ? formatDateFull(d.dropoffDate) : <span class="text-gray-300 dark:text-zinc-700">--</span>}
      </span>
    </td>
    <td>
      <span class="px-4 py-3 min-h-[44px] flex items-center text-gray-600 dark:text-zinc-400 text-callout whitespace-nowrap">
        {formatDateFull(d.datePrepared)}
      </span>
    </td>
    <td>
      <span class="px-4 py-3 min-h-[44px] flex items-center justify-center text-gray-600 dark:text-zinc-400 text-callout">
        {d.totalPrepared}
      </span>
    </td>
    <td>
      <span class="px-4 py-3 min-h-[44px] flex items-center justify-end whitespace-nowrap">
        {d.totalRevenue > 0 ? (
          <span class="text-gray-900 dark:text-zinc-100 text-callout">{formatCurrency(d.totalRevenue)}</span>
        ) : (
          <span class="text-gray-300 dark:text-zinc-700 text-callout">--</span>
        )}
      </span>
    </td>
    <td>
      <span class="px-4 py-3 min-h-[44px] flex items-center justify-end whitespace-nowrap">
        {d.totalCogs > 0 ? (
          <span class="text-gray-600 dark:text-zinc-400 text-callout">{formatCurrency(d.totalCogs)}</span>
        ) : (
          <span class="text-gray-300 dark:text-zinc-700 text-callout">--</span>
        )}
      </span>
    </td>
    <td>
      <span class="px-4 py-3 min-h-[44px] flex items-center justify-end whitespace-nowrap">
        {d.grossProfit > 0 ? (
          <span class="text-green-600 dark:text-green-400 text-callout">{formatCurrency(d.grossProfit)}</span>
        ) : d.grossProfit < 0 ? (
          <span class="text-red-500 dark:text-red-400 text-callout">{formatCurrency(d.grossProfit)}</span>
        ) : (
          <span class="text-gray-300 dark:text-zinc-700 text-callout">--</span>
        )}
      </span>
    </td>
    {showArchived && (
      <td>
        <span class="px-4 py-3 min-h-[44px] flex items-center justify-center">
          <button
            type="button"
            onclick="event.stopPropagation();"
            hx-post={`/deliveries/${d.id}/restore`}
            hx-target="#deliveries-card"
            hx-swap="outerHTML"
            class="text-button-sm text-pink-500 dark:text-pink-400 hover:text-pink-600 dark:hover:text-pink-300"
          >
            Restore
          </button>
        </span>
      </td>
    )}
    {!showArchived && (
      <td>
        <span class="px-4 py-3 min-h-[44px] flex items-center justify-center" onclick="event.stopPropagation();">
          <HoldArchiveButton url={`/deliveries/${d.id}`} target="#deliveries-card" />
        </span>
      </td>
    )}
  </tr>
)

// ─────────────────────────────────────────────────────────────────────────────
// Table body — pure pixel-parity port of web-b's list / byStore tbody content
// ─────────────────────────────────────────────────────────────────────────────

export const DeliveriesTableBody: FC<{
  deliveries: Delivery[]
  view: ViewMode
  sortColumn: SortColumn
  sortDirection: 'asc' | 'desc'
  showArchived: boolean
}> = ({ deliveries, view, sortColumn, sortDirection, showArchived }) => {
  const compareDeliveries = (a: Delivery, b: Delivery): number => {
    let cmp = 0
    if (sortColumn === 'id') cmp = a.id - b.id
    else if (sortColumn === 'storeName') cmp = a.storeName.localeCompare(b.storeName)
    else if (sortColumn === 'datePrepared') cmp = new Date(a.datePrepared).getTime() - new Date(b.datePrepared).getTime()
    else if (sortColumn === 'dropoffDate') {
      const aDate = a.dropoffDate ? new Date(a.dropoffDate).getTime() : 0
      const bDate = b.dropoffDate ? new Date(b.dropoffDate).getTime() : 0
      cmp = aDate - bDate
    } else cmp = ((a as unknown as Record<string, number>)[sortColumn] ?? 0) - ((b as unknown as Record<string, number>)[sortColumn] ?? 0)
    return sortDirection === 'asc' ? cmp : -cmp
  }

  if (view === 'list') {
    const sorted = [...deliveries].sort(compareDeliveries)
    return (
      <tbody>
        {sorted.map((d) => (
          <DeliveryRow d={d} showArchived={showArchived} />
        ))}
      </tbody>
    )
  }

  // by-store grouping
  const groups = new Map<
    string,
    { storeName: string; deliveries: Delivery[]; totalPrepared: number; totalRevenue: number; totalCogs: number; totalProfit: number }
  >()
  for (const d of deliveries) {
    const key = normalizeStore(d.storeName)
    if (!groups.has(key)) {
      groups.set(key, {
        storeName: d.storeName.trim(),
        deliveries: [],
        totalPrepared: 0,
        totalRevenue: 0,
        totalCogs: 0,
        totalProfit: 0,
      })
    }
    const g = groups.get(key)!
    g.deliveries.push(d)
    g.totalPrepared += d.totalPrepared
    g.totalRevenue += d.totalRevenue
    g.totalCogs += d.totalCogs
    g.totalProfit += d.grossProfit
  }
  for (const g of groups.values()) g.deliveries.sort(compareDeliveries)
  const groupList = [...groups.values()]
  const dir = sortDirection === 'asc' ? 1 : -1
  if (sortColumn === 'storeName') {
    groupList.sort((a, b) => a.storeName.localeCompare(b.storeName) * dir)
  } else if (sortColumn === 'totalPrepared') {
    groupList.sort((a, b) => (a.totalPrepared - b.totalPrepared) * dir)
  } else if (sortColumn === 'totalRevenue') {
    groupList.sort((a, b) => (a.totalRevenue - b.totalRevenue) * dir)
  } else if (sortColumn === 'totalCogs') {
    groupList.sort((a, b) => (a.totalCogs - b.totalCogs) * dir)
  } else if (sortColumn === 'grossProfit') {
    groupList.sort((a, b) => (a.totalProfit - b.totalProfit) * dir)
  } else {
    // datePrepared / dropoffDate / id → sort by first delivery in the group per active sort
    groupList.sort((a, b) => compareDeliveries(a.deliveries[0], b.deliveries[0]))
  }
  // Spec note: default sort for By Store should be by total revenue desc.
  // If user hasn't explicitly sorted (id desc is the default), surface revenue.
  if (sortColumn === 'id') {
    groupList.sort((a, b) => b.totalRevenue - a.totalRevenue)
  }

  return (
    <tbody>
      {groupList.map((group) => (
        <Fragment>
          {/* Store parent row */}
          <tr class="bg-gray-50/70 dark:bg-[#141414] border-t border-gray-200 dark:border-[#1f1f1f] fade-in">
            <td colspan={3}>
              <span class="px-4 py-3 min-h-[44px] flex items-center text-gray-900 dark:text-zinc-100 text-headline">
                {group.storeName} with <span class="text-pink-600 dark:text-pink-400 mx-1">{group.deliveries.length}</span>{' '}
                deliver{group.deliveries.length === 1 ? 'y' : 'ies'}
              </span>
            </td>
            <td>
              <span class="px-4 py-3 min-h-[44px] flex items-center justify-center text-gray-900 dark:text-zinc-100 text-callout">
                {group.totalPrepared.toLocaleString()}
              </span>
            </td>
            <td>
              <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-callout text-gray-900 dark:text-zinc-100 whitespace-nowrap">
                {group.totalRevenue > 0 ? formatCurrency(group.totalRevenue) : <span class="text-gray-300 dark:text-zinc-700">--</span>}
              </span>
            </td>
            <td>
              <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-callout text-gray-900 dark:text-zinc-100 whitespace-nowrap">
                {group.totalCogs > 0 ? formatCurrency(group.totalCogs) : <span class="text-gray-300 dark:text-zinc-700">--</span>}
              </span>
            </td>
            <td>
              <span class="px-4 py-3 min-h-[44px] flex items-center justify-end whitespace-nowrap">
                {group.totalProfit > 0 ? (
                  <span class="text-green-600 dark:text-green-400 text-callout">{formatCurrency(group.totalProfit)}</span>
                ) : group.totalProfit < 0 ? (
                  <span class="text-red-500 dark:text-red-400 text-callout">{formatCurrency(group.totalProfit)}</span>
                ) : (
                  <span class="text-gray-300 dark:text-zinc-700 text-callout">--</span>
                )}
              </span>
            </td>
            <td></td>
          </tr>

          {/* Delivery sub-rows */}
          {group.deliveries.map((d) => (
            <DeliveryRow d={d} showArchived={showArchived} hideStore />
          ))}
        </Fragment>
      ))}
    </tbody>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Card body — everything below the layout shell (filterable + sortable)
// ─────────────────────────────────────────────────────────────────────────────

export const DeliveriesCard: FC<DeliveriesPageProps & { allDeliveries: Delivery[] }> = (props) => {
  const deliveries = props.deliveries
  const view: ViewMode = normalizeView(props.view)
  const sortColumn: SortColumn = props.sortColumn ?? 'id'
  const sortDirection: 'asc' | 'desc' = props.sortDirection ?? 'desc'
  const showArchived = !!props.showArchived
  const selectedStores = props.selectedStores ?? []
  const dateFrom = props.dateFrom ?? null
  const dateTo = props.dateTo ?? null
  const revenueMin = props.revenueMin ?? ''
  const revenueMax = props.revenueMax ?? ''
  const profitMin = props.profitMin ?? ''
  const profitMax = props.profitMax ?? ''
  const preparedMin = props.preparedMin ?? ''
  const preparedMax = props.preparedMax ?? ''
  const openFilter = props.openFilter ?? null
  const allDeliveries = props.allDeliveries

  // ─── Filtering ───
  const selectedStoreKeys = new Set(selectedStores.map(normalizeStore))
  const fromDate = dateFrom ? new Date(dateFrom + 'T00:00:00') : null
  const toDate = dateTo ? new Date(dateTo + 'T23:59:59') : null
  const rMin = revenueMin ? parseFloat(revenueMin) : null
  const rMax = revenueMax ? parseFloat(revenueMax) : null
  const pMin = profitMin ? parseFloat(profitMin) : null
  const pMax = profitMax ? parseFloat(profitMax) : null
  const prMin = preparedMin ? parseFloat(preparedMin) : null
  const prMax = preparedMax ? parseFloat(preparedMax) : null

  const filtered = deliveries.filter((d) => {
    if (selectedStoreKeys.size > 0 && !selectedStoreKeys.has(normalizeStore(d.storeName))) return false
    if (fromDate || toDate) {
      const dStr = d.dropoffDate || d.datePrepared
      const dDate = new Date(dStr + 'T00:00:00')
      if (fromDate && dDate < fromDate) return false
      if (toDate && dDate > toDate) return false
    }
    if (rMin != null && !isNaN(rMin) && d.totalRevenue < rMin) return false
    if (rMax != null && !isNaN(rMax) && d.totalRevenue > rMax) return false
    if (pMin != null && !isNaN(pMin) && d.grossProfit < pMin) return false
    if (pMax != null && !isNaN(pMax) && d.grossProfit > pMax) return false
    if (prMin != null && !isNaN(prMin) && d.totalPrepared < prMin) return false
    if (prMax != null && !isNaN(prMax) && d.totalPrepared > prMax) return false
    return true
  })

  const totals = {
    prepared: filtered.reduce((s, d) => s + d.totalPrepared, 0),
    revenue: filtered.reduce((s, d) => s + d.totalRevenue, 0),
    cogs: filtered.reduce((s, d) => s + d.totalCogs, 0),
    profit: filtered.reduce((s, d) => s + d.grossProfit, 0),
  }
  const deliveriesWithRevenue = filtered.filter((d) => d.totalRevenue > 0).length
  const profitMargin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0
  const avgRevenuePerDelivery = deliveriesWithRevenue > 0 ? totals.revenue / deliveriesWithRevenue : 0
  const avgProfitPerDelivery = deliveriesWithRevenue > 0 ? totals.profit / deliveriesWithRevenue : 0

  const numActiveFilters =
    (selectedStores.length > 0 ? 1 : 0) +
    (dateFrom || dateTo ? 1 : 0) +
    (revenueMin || revenueMax ? 1 : 0) +
    (profitMin || profitMax ? 1 : 0) +
    (preparedMin || preparedMax ? 1 : 0)

  const uniqueStores = (() => {
    const seen = new Map<string, string>()
    for (const d of allDeliveries) {
      const key = normalizeStore(d.storeName)
      if (!key) continue
      if (!seen.has(key)) seen.set(key, d.storeName.trim())
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  })()

  const deliveriesWithLocations = allDeliveries.filter((d) => d.location && d.location.trim() !== '')

  // Base query — what to preserve when generating sort / filter / view links
  const baseQuery: Record<string, string | null | undefined> = {
    view: view === 'byStore' ? 'by-store' : null,
    sort: sortColumn !== 'id' || sortDirection !== 'desc' ? sortColumn : null,
    dir: sortColumn !== 'id' || sortDirection !== 'desc' ? sortDirection : null,
    archived: showArchived ? '1' : null,
    stores: selectedStores.length ? selectedStores.join(',') : null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    revenueMin: revenueMin || null,
    revenueMax: revenueMax || null,
    profitMin: profitMin || null,
    profitMax: profitMax || null,
    preparedMin: preparedMin || null,
    preparedMax: preparedMax || null,
    openFilter: openFilter || null,
  }

  const dateRangeLabel = (() => {
    if (fromDate && toDate) return `${formatDateMD(fromDate)} – ${formatDateShort(toDate)}`
    if (fromDate) return `From ${formatDateShort(fromDate)}`
    if (toDate) return `Until ${formatDateShort(toDate)}`
    return null
  })()

  return (
    <div id="deliveries-card">
      {/* Floating Card Container */}
      <div class="w-full bg-white dark:bg-[#0a0a0a] rounded-3xl overflow-hidden fade-in">
        {/* Header inside card */}
        <div class="flex items-start justify-between gap-4 flex-wrap px-8 pt-8 pb-4">
          <div>
            <h2 class="text-title-2 text-gray-900 dark:text-zinc-100">View Your Deliveries</h2>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <a
              href={`/deliveries${buildQuery({ archived: showArchived ? null : '1' }, baseQuery)}`}
              class={`px-5 py-2.5 border rounded-full text-button transition-all flex items-center gap-2 ${
                showArchived
                  ? 'bg-gray-900 border-gray-900 text-white hover:bg-gray-800 dark:bg-zinc-100 dark:border-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-[#fafafa] dark:bg-[#0a0a0a] dark:border-[#262626] dark:text-zinc-300 dark:hover:bg-[#171717]'
              }`}
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              Archived
            </a>
            <a
              href={`/deliveries${buildQuery({ openFilter: openFilter === 'add' ? null : 'add' }, baseQuery)}`}
              class="animated-border px-5 py-2.5 text-white rounded-full text-button transition-all flex items-center gap-2"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Add Store
            </a>
          </div>
        </div>

        <AddStoreForm uniqueStores={uniqueStores} isOpen={openFilter === 'add'} />

        {/* Stats Grid */}
        {allDeliveries.length > 0 && (
          <div class="px-8 pb-6">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="Total Cookies"
                value={Math.round(totals.prepared).toLocaleString()}
                sublabel={
                  numActiveFilters > 0
                    ? `across ${filtered.length} of ${allDeliveries.length} deliveries`
                    : `across ${filtered.length} deliveries`
                }
              />
              <StatCard label="Profit Margin" value={`${profitMargin.toFixed(1)}%`} sublabel={`${formatCurrency(totals.cogs)} total COGS`} />
              <StatCard
                label="Average Revenue per Delivery"
                value={formatCurrency(avgRevenuePerDelivery)}
                sublabel={`${formatCurrency(totals.revenue)} total revenue`}
              />
              <StatCard
                label="Average Profit per Delivery"
                value={formatCurrency(avgProfitPerDelivery)}
                sublabel={`${formatCurrency(totals.profit)} total profit`}
              />
            </div>
          </div>
        )}

        {/* Helper text + filter controls */}
        <div class="flex items-start justify-between gap-4 flex-wrap px-8 pb-4">
          <p class="text-body text-gray-700 dark:text-zinc-300">
            {numActiveFilters > 0
              ? `Showing ${filtered.length} of ${allDeliveries.length} deliveries.`
              : 'Select a store below to view details, or add a new store to get started.'}
          </p>

          {allDeliveries.length > 0 && (
            <div class="flex items-center gap-2 flex-wrap">
              {/* View toggle: By Date / By Store */}
              <div class="flex bg-[#fafafa] dark:bg-[#1f1f1f] rounded-full p-0.5 border border-gray-200 dark:border-[#262626]">
                <a
                  href={`/deliveries${buildQuery({ view: null }, baseQuery)}`}
                  class={`relative px-3 py-1 text-button rounded-full transition-colors flex items-center gap-1.5 ${
                    view === 'list'
                      ? 'bg-white dark:bg-[#0a0a0a] shadow-sm text-gray-900 dark:text-zinc-100'
                      : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
                  }`}
                >
                  <svg class="relative w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span class="relative">By Date</span>
                </a>
                <a
                  href={`/deliveries${buildQuery({ view: 'by-store' }, baseQuery)}`}
                  class={`relative px-3 py-1 text-button rounded-full transition-colors flex items-center gap-1.5 ${
                    view === 'byStore'
                      ? 'bg-white dark:bg-[#0a0a0a] shadow-sm text-gray-900 dark:text-zinc-100'
                      : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
                  }`}
                >
                  <svg class="relative w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9l2-5h14l2 5M3 9v10a1 1 0 001 1h16a1 1 0 001-1V9M3 9h18M9 14h6" />
                  </svg>
                  <span class="relative">By Store</span>
                </a>
              </div>

              <span class="w-px h-6 bg-gray-200 dark:bg-[#262626] mx-1" />

              {/* Store filter */}
              <FilterPill
                label="Store"
                active={selectedStores.length > 0}
                activeText={
                  selectedStores.length === 1 ? selectedStores[0] : selectedStores.length > 1 ? `${selectedStores.length} stores` : null
                }
                isOpen={openFilter === 'store'}
                openHref={`/deliveries${buildQuery({ openFilter: 'store' }, baseQuery)}`}
                closeHref={`/deliveries${buildQuery({ openFilter: null }, baseQuery)}`}
                clearHref={`/deliveries${buildQuery({ stores: null }, baseQuery)}`}
                popoverWidth="w-72"
              >
                <form method="get" action="/deliveries" data-filter-form class="p-3">
                  {/* Preserve current state via hidden inputs */}
                  <HiddenState baseQuery={baseQuery} omit={['stores', 'openFilter']} />
                  <div class="max-h-64 overflow-y-auto">
                    {uniqueStores.length === 0 ? (
                      <p class="text-callout text-gray-400 dark:text-zinc-500 text-center py-4">No stores yet</p>
                    ) : (
                      uniqueStores.map((store) => (
                        <label class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-[#171717] cursor-pointer">
                          <input
                            type="checkbox"
                            name="stores"
                            value={store}
                            checked={selectedStores.includes(store)}
                            class="w-4 h-4 accent-pink-500"
                          />
                          <span class="text-callout text-gray-700 dark:text-zinc-300 truncate">{store}</span>
                        </label>
                      ))
                    )}
                  </div>
                  <div class="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-[#1f1f1f]">
                    <a
                      href={`/deliveries${buildQuery({ stores: null, openFilter: null }, baseQuery)}`}
                      class="text-button-sm text-gray-500 dark:text-zinc-400 hover:underline"
                    >
                      Clear
                    </a>
                    <button
                      type="submit"
                      class="px-3 py-1.5 text-button-sm bg-pink-500 text-white rounded-lg hover:bg-pink-600 transition-colors"
                    >
                      Apply
                    </button>
                  </div>
                </form>
              </FilterPill>

              {/* Date filter */}
              <FilterPill
                label="Date"
                active={!!(dateFrom || dateTo)}
                activeText={dateRangeLabel}
                isOpen={openFilter === 'date'}
                openHref={`/deliveries${buildQuery({ openFilter: 'date' }, baseQuery)}`}
                closeHref={`/deliveries${buildQuery({ openFilter: null }, baseQuery)}`}
                clearHref={`/deliveries${buildQuery({ dateFrom: null, dateTo: null }, baseQuery)}`}
                popoverWidth="w-80"
              >
                <form method="get" action="/deliveries" data-filter-form class="p-4">
                  <HiddenState baseQuery={baseQuery} omit={['dateFrom', 'dateTo', 'openFilter']} />
                  <div class="flex flex-wrap gap-1.5 mb-3">
                    {(
                      [
                        ['last7', 'Last 7 days'],
                        ['last30', 'Last 30 days'],
                        ['thisMonth', 'This month'],
                        ['lastMonth', 'Last month'],
                        ['thisYear', 'This year'],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        type="button"
                        data-date-preset={key}
                        class="px-3 py-1 text-button-sm rounded-full border bg-gray-50 dark:bg-[#171717] text-gray-700 dark:text-zinc-300 border-gray-200 dark:border-[#262626] hover:bg-pink-50 dark:hover:bg-pink-950/30 hover:text-pink-600 dark:hover:text-pink-400 transition-colors"
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      data-date-preset="all"
                      class="px-3 py-1 text-button-sm rounded-full border bg-gray-50 dark:bg-[#171717] text-gray-700 dark:text-zinc-300 border-gray-200 dark:border-[#262626] hover:bg-pink-50 dark:hover:bg-pink-950/30 transition-colors"
                    >
                      All time
                    </button>
                  </div>
                  <div class="grid grid-cols-2 gap-2">
                    <div>
                      <label class="block text-caption uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-400 mb-1.5">From</label>
                      <input
                        type="date"
                        name="dateFrom"
                        value={dateFrom || ''}
                        class="w-full px-3 py-2 text-callout bg-gray-50 dark:bg-[#171717] border border-gray-200 dark:border-[#262626] rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 text-gray-900 dark:text-zinc-100"
                      />
                    </div>
                    <div>
                      <label class="block text-caption uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-400 mb-1.5">To</label>
                      <input
                        type="date"
                        name="dateTo"
                        value={dateTo || ''}
                        class="w-full px-3 py-2 text-callout bg-gray-50 dark:bg-[#171717] border border-gray-200 dark:border-[#262626] rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 text-gray-900 dark:text-zinc-100"
                      />
                    </div>
                  </div>
                  <div class="flex justify-end mt-3 pt-3 border-t border-gray-100 dark:border-[#1f1f1f]">
                    <button
                      type="submit"
                      class="px-3 py-1.5 text-button-sm bg-pink-500 text-white rounded-lg hover:bg-pink-600 transition-colors"
                    >
                      Apply
                    </button>
                  </div>
                </form>
              </FilterPill>

              {/* Numeric ranges filter */}
              <FilterPill
                label="Amounts"
                active={!!(revenueMin || revenueMax || profitMin || profitMax || preparedMin || preparedMax)}
                activeText={
                  [
                    (revenueMin || revenueMax) && 'Revenue',
                    (profitMin || profitMax) && 'Profit',
                    (preparedMin || preparedMax) && 'Prepared',
                  ]
                    .filter(Boolean)
                    .join(', ') || null
                }
                isOpen={openFilter === 'advanced'}
                openHref={`/deliveries${buildQuery({ openFilter: 'advanced' }, baseQuery)}`}
                closeHref={`/deliveries${buildQuery({ openFilter: null }, baseQuery)}`}
                clearHref={`/deliveries${buildQuery({ revenueMin: null, revenueMax: null, profitMin: null, profitMax: null, preparedMin: null, preparedMax: null }, baseQuery)}`}
                popoverWidth="w-96"
              >
                <form method="get" action="/deliveries" data-filter-form class="p-5 space-y-4">
                  <HiddenState
                    baseQuery={baseQuery}
                    omit={['revenueMin', 'revenueMax', 'profitMin', 'profitMax', 'preparedMin', 'preparedMax', 'openFilter']}
                  />
                  <RangeRow label="Revenue" prefix="$" minName="revenueMin" maxName="revenueMax" minValue={revenueMin} maxValue={revenueMax} />
                  <RangeRow label="Profit" prefix="$" minName="profitMin" maxName="profitMax" minValue={profitMin} maxValue={profitMax} />
                  <RangeRow label="Prepared" prefix="" minName="preparedMin" maxName="preparedMax" minValue={preparedMin} maxValue={preparedMax} />
                  <div class="flex justify-end pt-3 border-t border-gray-100 dark:border-[#1f1f1f]">
                    <button
                      type="submit"
                      class="px-3 py-1.5 text-button-sm bg-pink-500 text-white rounded-lg hover:bg-pink-600 transition-colors"
                    >
                      Apply
                    </button>
                  </div>
                </form>
              </FilterPill>

              {numActiveFilters > 0 && (
                <button
                  type="button"
                  data-clear-all
                  class="text-button-sm text-gray-500 dark:text-zinc-400 hover:text-pink-600 dark:hover:text-pink-400 transition-colors px-2"
                >
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>

        {/* Table */}
        <div class="px-4 pb-4">
          <table class="data-table">
            <thead>
              <tr>
                <SortableHeader label="#" column="id" currentColumn={sortColumn} direction={sortDirection} baseQuery={baseQuery} class="w-6 text-center" />
                {view !== 'byStore' && (
                  <SortableHeader label="Store" column="storeName" currentColumn={sortColumn} direction={sortDirection} baseQuery={baseQuery} class="w-52" />
                )}
                <SortableHeader label="Dropoff Date" column="dropoffDate" currentColumn={sortColumn} direction={sortDirection} baseQuery={baseQuery} class="w-28" />
                <SortableHeader label="Date Prepared" column="datePrepared" currentColumn={sortColumn} direction={sortDirection} baseQuery={baseQuery} class="w-28" />
                <SortableHeader label="Prepared" column="totalPrepared" currentColumn={sortColumn} direction={sortDirection} baseQuery={baseQuery} class="w-20 text-center" />
                <SortableHeader label="Revenue" column="totalRevenue" currentColumn={sortColumn} direction={sortDirection} baseQuery={baseQuery} class="w-12 text-right" />
                <SortableHeader label="COGS" column="totalCogs" currentColumn={sortColumn} direction={sortDirection} baseQuery={baseQuery} class="w-10 text-right" />
                <SortableHeader label="Profit" column="grossProfit" currentColumn={sortColumn} direction={sortDirection} baseQuery={baseQuery} class="w-12 text-right" />
                <th class="w-20"><span class="px-2 py-3 text-caption uppercase tracking-[0.08em] text-gray-400 dark:text-zinc-500"></span></th>
              </tr>
            </thead>
            <DeliveriesTableBody
              deliveries={filtered}
              view={view}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              showArchived={showArchived}
            />
          </table>

          {allDeliveries.length === 0 && (
            <div class="text-center py-12 text-gray-400 dark:text-zinc-500">
              No deliveries yet. Click "Add Store" to get started.
            </div>
          )}

          {allDeliveries.length > 0 && filtered.length === 0 && (
            <div class="text-center py-12 text-gray-400 dark:text-zinc-500">
              No deliveries match your filters.{' '}
              <button
                type="button"
                data-clear-all
                class="text-pink-600 dark:text-pink-400 hover:underline text-button"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Compute preset date overrides for the date filter
function presetDates(preset: 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'thisYear'): Record<string, string> {
  const now = new Date()
  let from: Date
  let to: Date = now
  if (preset === 'last7') {
    from = new Date(now)
    from.setDate(from.getDate() - 7)
  } else if (preset === 'last30') {
    from = new Date(now)
    from.setDate(from.getDate() - 30)
  } else if (preset === 'thisMonth') {
    from = new Date(now.getFullYear(), now.getMonth(), 1)
  } else if (preset === 'lastMonth') {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    to = new Date(now.getFullYear(), now.getMonth(), 0)
  } else {
    from = new Date(now.getFullYear(), 0, 1)
  }
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { dateFrom: iso(from), dateTo: iso(to) }
}

// Hidden inputs that propagate non-form params through a GET form submit
const HiddenState: FC<{ baseQuery: Record<string, string | null | undefined>; omit: string[] }> = ({ baseQuery, omit }) => {
  const omitSet = new Set(omit)
  const entries = Object.entries(baseQuery).filter(([k, v]) => !omitSet.has(k) && v != null && v !== '')
  return (
    <>
      {entries.map(([k, v]) => (
        <input type="hidden" name={k} value={String(v)} />
      ))}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page shell — wraps the card in <Layout>
// ─────────────────────────────────────────────────────────────────────────────

const CLIENT_FILTER_SCRIPT = `
(function(){
  // Popover open/close — replaces server-side ?openFilter= round-trips. Click a
  // pill button: toggle its popover. Click outside: close all. Esc: close all.
  function closeAllPopovers(){
    document.querySelectorAll('[data-pill-popover]').forEach(function(p){ p.classList.add('hidden'); });
    document.querySelectorAll('[data-pill-chevron]').forEach(function(c){ c.classList.remove('rotate-180'); });
  }
  function bindPopovers(){
    document.querySelectorAll('[data-pill-trigger]').forEach(function(btn){
      if (btn.dataset.popoverBound) return;
      btn.dataset.popoverBound = '1';
      btn.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        var key = btn.getAttribute('data-pill-trigger');
        var pop = document.querySelector('[data-pill-popover="' + key + '"]');
        if (!pop) return;
        var wasOpen = !pop.classList.contains('hidden');
        closeAllPopovers();
        if (!wasOpen) {
          pop.classList.remove('hidden');
          var chev = btn.querySelector('[data-pill-chevron]');
          if (chev) chev.classList.add('rotate-180');
        }
      });
    });
  }
  // Close on outside click + Escape
  document.addEventListener('click', function(e){
    if (e.target.closest('[data-pill]') || e.target.closest('[data-pill-popover]')) return;
    closeAllPopovers();
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') closeAllPopovers();
  });

  // Client-side row filtering: reads filter form inputs and toggles row visibility
  // instantly without a server roundtrip. Falls back to server-side filtering if
  // user hits Apply (the form still submits normally).
  function applyFilters(){
    var rows = document.querySelectorAll('tr.delivery-row');
    var storeBoxes = document.querySelectorAll('input[name="stores"]:checked');
    var selectedStores = Array.from(storeBoxes).map(function(b){ return b.value.toLowerCase(); });
    var dateFrom = (document.querySelector('input[name="dateFrom"]') || {}).value || '';
    var dateTo   = (document.querySelector('input[name="dateTo"]')   || {}).value || '';
    function num(name){ var el = document.querySelector('input[name="'+name+'"]'); return el && el.value !== '' ? parseFloat(el.value) : null; }
    var rMin = num('revenueMin'), rMax = num('revenueMax');
    var pMin = num('profitMin'),  pMax = num('profitMax');
    var prMin= num('preparedMin'),prMax= num('preparedMax');
    var visible = 0;
    rows.forEach(function(r){
      var store = r.getAttribute('data-store') || '';
      var date  = r.getAttribute('data-date')  || '';
      var rev   = parseFloat(r.getAttribute('data-rev')  || '0');
      var prof  = parseFloat(r.getAttribute('data-prof') || '0');
      var prep  = parseFloat(r.getAttribute('data-prep') || '0');
      var pass = true;
      if (selectedStores.length && selectedStores.indexOf(store) < 0) pass = false;
      if (pass && dateFrom && date < dateFrom) pass = false;
      if (pass && dateTo   && date > dateTo)   pass = false;
      if (pass && rMin != null && rev < rMin)  pass = false;
      if (pass && rMax != null && rev > rMax)  pass = false;
      if (pass && pMin != null && prof < pMin) pass = false;
      if (pass && pMax != null && prof > pMax) pass = false;
      if (pass && prMin != null && prep < prMin) pass = false;
      if (pass && prMax != null && prep > prMax) pass = false;
      r.classList.toggle('hidden', !pass);
      if (pass) visible += 1;
    });
    // Update "no matches" hint if present
    var hint = document.getElementById('delivery-filter-hint');
    if (hint) hint.textContent = visible + ' visible';
  }
  // Debounce typed input so we don't filter on every keystroke
  var t = null;
  function schedule(){ clearTimeout(t); t = setTimeout(applyFilters, 80); }
  // Date preset chips — fill From/To inputs with preset range, then filter.
  function applyDatePreset(key){
    var now = new Date();
    var y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    function iso(dt){
      var mm = String(dt.getMonth()+1).padStart(2,'0');
      var dd = String(dt.getDate()).padStart(2,'0');
      return dt.getFullYear() + '-' + mm + '-' + dd;
    }
    var from = '', to = '';
    if (key === 'last7')      { var f = new Date(y,m,d-6); from = iso(f); to = iso(now); }
    else if (key === 'last30'){ var f2 = new Date(y,m,d-29); from = iso(f2); to = iso(now); }
    else if (key === 'thisMonth') { from = iso(new Date(y,m,1)); to = iso(new Date(y,m+1,0)); }
    else if (key === 'lastMonth') { from = iso(new Date(y,m-1,1)); to = iso(new Date(y,m,0)); }
    else if (key === 'thisYear')  { from = iso(new Date(y,0,1)); to = iso(new Date(y,11,31)); }
    // 'all' → empty strings (clears)
    var fromEl = document.querySelector('input[name="dateFrom"]');
    var toEl   = document.querySelector('input[name="dateTo"]');
    if (fromEl) fromEl.value = from;
    if (toEl)   toEl.value   = to;
    applyFilters();
  }

  // Clear handlers — wipe inputs for a single pill (date / store / amounts) or all.
  var pillFields = {
    date: ['dateFrom', 'dateTo'],
    store: ['stores'],
    advanced: ['revenueMin','revenueMax','profitMin','profitMax','preparedMin','preparedMax'],
  };
  function clearPill(key){
    var fields = pillFields[key] || [];
    fields.forEach(function(name){
      document.querySelectorAll('input[name="' + name + '"]').forEach(function(el){
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
        else el.value = '';
      });
    });
    applyFilters();
  }
  function clearAll(){
    Object.keys(pillFields).forEach(clearPill);
  }

  // Intercept form submit so we don't navigate
  function bind(){
    bindPopovers();
    document.querySelectorAll('[data-date-preset]').forEach(function(btn){
      if (btn.dataset.boundPreset) return; btn.dataset.boundPreset = '1';
      btn.addEventListener('click', function(e){
        e.preventDefault();
        applyDatePreset(btn.getAttribute('data-date-preset'));
      });
    });
    document.querySelectorAll('[data-pill-clear]').forEach(function(el){
      if (el.dataset.boundClear) return; el.dataset.boundClear = '1';
      el.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation();
        clearPill(el.getAttribute('data-pill-clear'));
      });
    });
    document.querySelectorAll('[data-clear-all]').forEach(function(el){
      if (el.dataset.boundClearAll) return; el.dataset.boundClearAll = '1';
      el.addEventListener('click', function(e){ e.preventDefault(); clearAll(); });
    });
    document.querySelectorAll('form[data-filter-form]').forEach(function(f){
      if (f.dataset.bound) return; f.dataset.bound = '1';
      f.addEventListener('submit', function(e){ e.preventDefault(); applyFilters(); });
      f.querySelectorAll('input, select').forEach(function(el){
        el.addEventListener('input', schedule);
        el.addEventListener('change', schedule);
      });
    });
    applyFilters();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
  document.body.addEventListener('htmx:afterSwap', bind);
})();
`

export const DeliveriesPage: FC<DeliveriesPageProps> = (props) => {
  return (
    <Layout title="Deliveries" active="deliveries">
      <DeliveriesCard {...props} allDeliveries={props.deliveries} />
      <script dangerouslySetInnerHTML={{ __html: CLIENT_FILTER_SCRIPT }} />
    </Layout>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Backward-compat exports — old index.tsx references these names
// ─────────────────────────────────────────────────────────────────────────────

export const DeliveriesTableView: FC<{ deliveries: Delivery[]; view: 'by-date' | 'by-store' }> = ({ deliveries, view }) => (
  <DeliveriesCard
    deliveries={deliveries}
    allDeliveries={deliveries}
    view={view === 'by-store' ? 'byStore' : 'list'}
    sortColumn="id"
    sortDirection="desc"
    showArchived={false}
    selectedStores={[]}
    dateFrom={null}
    dateTo={null}
    revenueMin=""
    revenueMax=""
    profitMin=""
    profitMax=""
    preparedMin=""
    preparedMax=""
    openFilter={null}
  />
)
