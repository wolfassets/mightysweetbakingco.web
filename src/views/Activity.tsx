import type { FC } from 'hono/jsx'
import { Layout } from './Layout.js'

// ───────────────────────── Types ─────────────────────────
export interface AuditRow {
  id: number
  action: string // 'create' | 'update' | 'delete' | 'restore' (but api may return others)
  entityType: string // 'flavor' | 'flavor_price' | 'event' | 'event_item' | 'delivery' | 'delivery_item'
  entityId: number
  entityLabel: string | null
  changedFields: string | null
  beforeJson: string | null
  afterJson: string | null
  ipAddress: string | null
  createdAt: string
}

// Render an IP as a flag + city + ip. For local dev (::1 / 127.0.0.1 / private
// subnets) we hardcode the operator's location (Schenectady, NY) so the feed
// shows something useful instead of "Localhost". Real public IPs fall through
// to a 🌐 glyph + raw address — full city geolocation via ipapi.co is TODO
// (would need a per-IP fetch with in-memory cache).
interface IpInfo {
  glyph: string
  city: string | null
  ip: string | null
}

function ipBadge(ip: string | null): IpInfo {
  if (!ip) return { glyph: '·', city: 'unknown', ip: null }
  const isLocal =
    ip === '::1' ||
    ip === '127.0.0.1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') ||
    ip.startsWith('172.19.') ||
    ip.startsWith('172.2') ||
    ip.startsWith('172.30.') ||
    ip.startsWith('172.31.')
  if (isLocal) {
    return { glyph: '🇺🇸', city: 'Schenectady, NY 12308', ip }
  }
  return { glyph: '🌐', city: null, ip }
}

export interface ActivityFilters {
  entityType?: string // 'all' | entityType string
  action?: string // 'all' | action string
  search?: string
  from?: string // ISO date YYYY-MM-DD
  to?: string // ISO date YYYY-MM-DD
}

// ───────────────────────── Constants ─────────────────────────
const ENTITY_LABELS: Record<string, string> = {
  flavor: 'Flavor',
  flavor_price: 'Rate',
  event: 'Event',
  event_item: 'Event item',
  delivery: 'Delivery',
  delivery_item: 'Delivery item',
}

interface ActionBadge {
  label: string
  className: string
}

const ACTION_BADGES: Record<string, ActionBadge> = {
  create: {
    label: 'Created',
    className:
      'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-900/60',
  },
  update: {
    label: 'Updated',
    className:
      'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/60',
  },
  delete: {
    label: 'Deleted',
    className:
      'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/60',
  },
  restore: {
    label: 'Restored',
    className:
      'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/60',
  },
}

// ───────────────────────── Helpers ─────────────────────────
function parseCreatedAt(iso: string): Date {
  // Audit rows can come back as 'CURRENT_TIMESTAMP' (server-default sentinel)
  // or as actual ISO timestamps. Normalize defensively.
  if (!iso || iso === 'CURRENT_TIMESTAMP') return new Date()
  const normalized = iso.endsWith('Z') || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'
  const d = new Date(normalized)
  return isNaN(d.getTime()) ? new Date() : d
}

export function formatRelative(iso: string): string {
  const d = parseCreatedAt(iso)
  const diffMs = Date.now() - d.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatAbsolute(iso: string): string {
  const d = parseCreatedAt(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

function dayHeading(iso: string): string {
  const d = parseCreatedAt(iso)
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function safeParse<T = unknown>(s: string | null): T | null {
  if (!s) return null
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

// HTML-escape used by the string-fragment helper (used by SSE bridge)
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Apply filters in-memory (server-side render path uses this, SSE doesn't).
export function applyFilters(rows: AuditRow[], filters: ActivityFilters): AuditRow[] {
  const fe = filters.entityType && filters.entityType !== 'all' ? filters.entityType : null
  const fa = filters.action && filters.action !== 'all' ? filters.action : null
  const fs = (filters.search ?? '').trim().toLowerCase()
  const ffrom = filters.from ?? null
  const fto = filters.to ?? null
  return rows.filter((r) => {
    if (fe && r.entityType !== fe) return false
    if (fa && r.action !== fa) return false
    if (fs) {
      const label = (r.entityLabel || '').toLowerCase()
      if (!label.includes(fs) && !String(r.entityId).includes(fs)) return false
    }
    if (ffrom || fto) {
      const d = parseCreatedAt(r.createdAt)
      // Compare on date-only (yyyy-mm-dd)
      const ymd = d.toISOString().slice(0, 10)
      if (ffrom && ymd < ffrom) return false
      if (fto && ymd > fto) return false
    }
    return true
  })
}

// Group filtered rows by day-of-creation, preserving order.
function groupByDay(rows: AuditRow[]): Array<[string, AuditRow[]]> {
  const map = new Map<string, AuditRow[]>()
  for (const r of rows) {
    const key = dayHeading(r.createdAt)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(r)
  }
  return [...map.entries()]
}

// ───────────────────────── AuditEntry (single row) ─────────────────────────
// Renders one card. Used by:
//  • Initial page render (server-side groups them by day).
//  • SSE bridge (string-form helper below) — afterbegin swap inserts at top.
export const AuditEntry: FC<{ r: AuditRow }> = ({ r }) => {
  const badge = ACTION_BADGES[r.action] ?? {
    label: r.action,
    className:
      'bg-gray-100 text-gray-700 border-gray-200 dark:bg-[#1f1f1f] dark:text-zinc-300 dark:border-[#262626]',
  }
  const fields: string[] = r.changedFields ? safeParse<string[]>(r.changedFields) || [] : []
  const entityLabel = ENTITY_LABELS[r.entityType] ?? r.entityType
  const ip = ipBadge(r.ipAddress)

  return (
    <div
      class="flex items-center gap-3 px-4 py-1.5 rounded-xl hover:bg-gray-50 dark:hover:bg-[#171717] transition-colors fade-in"
      data-audit-id={String(r.id)}
    >
      <span class="flex items-center gap-1.5 text-callout text-gray-500 dark:text-zinc-400 whitespace-nowrap">
        <span class="text-callout">{ip.glyph}</span>
        {ip.city && <span>{ip.city}</span>}
        {ip.ip && <span class="text-callout text-gray-400 dark:text-zinc-500">{ip.ip}</span>}
      </span>
      <span class="text-callout text-gray-400 dark:text-zinc-600 whitespace-nowrap">·</span>
      <span class="text-callout text-gray-500 dark:text-zinc-400 whitespace-nowrap">{entityLabel}</span>
      <span
        class={`text-button-sm px-2.5 py-0.5 rounded-full border whitespace-nowrap ${badge.className}`}
      >
        {badge.label}
      </span>
      <span class="text-callout text-gray-900 dark:text-zinc-100 truncate">
        {r.entityLabel || `#${r.entityId}`}
      </span>
      {r.action === 'update' && fields.length > 0 && (
        <span class="text-callout text-gray-500 dark:text-zinc-400 truncate">
          {fields.length === 1 ? `changed ${fields[0]}` : `changed ${fields.length} fields`}
        </span>
      )}
      <span class="ml-auto text-callout text-gray-400 dark:text-zinc-500 whitespace-nowrap">
        {formatAbsolute(r.createdAt)}
      </span>
    </div>
  )
}

// ───────────────────────── Day group ─────────────────────────
const DayGroup: FC<{ day: string; items: AuditRow[] }> = ({ day, items }) => (
  <div class="day-group" data-day={day}>
    <h3 class="text-headline text-gray-900 dark:text-zinc-100 mb-3">{day}</h3>
    <div class="space-y-0.5">
      {items.map((row) => (
        <AuditEntry r={row} />
      ))}
    </div>
  </div>
)

// ───────────────────────── Filter form ─────────────────────────
const FilterForm: FC<{ filters: ActivityFilters }> = ({ filters }) => {
  const entity = filters.entityType ?? 'all'
  const action = filters.action ?? 'all'
  return (
    <form
      hx-get="/activity"
      hx-target="#activity-results"
      hx-swap="innerHTML"
      hx-push-url="true"
      hx-trigger="change, keyup changed delay:300ms from:input[name='search']"
      class="flex items-center gap-2 flex-wrap"
    >
      <input
        type="text"
        name="search"
        placeholder="Search labels..."
        value={filters.search ?? ''}
        class="px-3 py-1.5 text-callout bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-[#262626] rounded-full focus:outline-none focus:ring-2 focus:ring-pink-500 text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-600 w-48"
      />
      <select
        name="entityType"
        class="px-3 py-1.5 text-button-sm bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-[#262626] rounded-full text-gray-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-pink-500 cursor-pointer"
      >
        <option value="all" selected={entity === 'all'}>
          All types
        </option>
        <option value="flavor" selected={entity === 'flavor'}>
          Flavors
        </option>
        <option value="flavor_price" selected={entity === 'flavor_price'}>
          Rates
        </option>
        <option value="event" selected={entity === 'event'}>
          Events
        </option>
        <option value="event_item" selected={entity === 'event_item'}>
          Event items
        </option>
        <option value="delivery" selected={entity === 'delivery'}>
          Deliveries
        </option>
        <option value="delivery_item" selected={entity === 'delivery_item'}>
          Delivery items
        </option>
      </select>
      <select
        name="action"
        class="px-3 py-1.5 text-button-sm bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-[#262626] rounded-full text-gray-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-pink-500 cursor-pointer"
      >
        <option value="all" selected={action === 'all'}>
          All actions
        </option>
        <option value="create" selected={action === 'create'}>
          Created
        </option>
        <option value="update" selected={action === 'update'}>
          Updated
        </option>
        <option value="delete" selected={action === 'delete'}>
          Deleted
        </option>
        <option value="restore" selected={action === 'restore'}>
          Restored
        </option>
      </select>
      <input
        type="date"
        name="from"
        value={filters.from ?? ''}
        title="From date"
        class="px-3 py-1.5 text-button-sm bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-[#262626] rounded-full text-gray-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-pink-500 cursor-pointer"
      />
      <input
        type="date"
        name="to"
        value={filters.to ?? ''}
        title="To date"
        class="px-3 py-1.5 text-button-sm bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-[#262626] rounded-full text-gray-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-pink-500 cursor-pointer"
      />
    </form>
  )
}

// ───────────────────────── Results block (filtered) ─────────────────────────
// This is the htmx swap target. It also hosts the SSE-connected feed container.
export const ActivityResults: FC<{
  rows: AuditRow[]
  totalCount: number
  filtered: AuditRow[]
}> = ({ rows, totalCount, filtered }) => {
  const groups = groupByDay(filtered)
  return (
    <>
      {filtered.length !== totalCount && (
        <p class="text-callout text-gray-500 dark:text-zinc-400 mb-4 px-8">
          Showing {filtered.length} of {totalCount}.
        </p>
      )}
      <div class="px-8 pb-8">
        {filtered.length === 0 ? (
          <div class="text-center py-12 text-gray-400 dark:text-zinc-500">
            {rows.length === 0
              ? 'No activity yet — start editing to see actions appear here.'
              : 'No actions match your filters.'}
          </div>
        ) : (
          <div
            id="activity-feed"
            class="space-y-6"
            hx-ext="sse"
            sse-connect="/stream-events"
            sse-swap="audit"
            hx-swap="afterbegin"
          >
            {groups.map(([day, items]) => (
              <DayGroup day={day} items={items} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ───────────────────────── Page ─────────────────────────
export const ActivityPage: FC<{ rows: AuditRow[]; filters?: ActivityFilters }> = ({
  rows,
  filters = {},
}) => {
  const filtered = applyFilters(rows, filters)
  return (
    <Layout title="Activity" active="activity">
      <div class="w-full bg-white dark:bg-[#0a0a0a] rounded-3xl overflow-hidden fade-in">
        {/* Header */}
        <div class="flex items-start justify-between gap-4 flex-wrap px-8 pt-8 pb-4">
          <div>
            <h2 class="text-title-2 text-gray-900 dark:text-zinc-100">Activity</h2>
          </div>
          <FilterForm filters={filters} />
        </div>

        {/* Results (htmx swap target) */}
        <div id="activity-results">
          <ActivityResults rows={rows} totalCount={rows.length} filtered={filtered} />
        </div>
      </div>
    </Layout>
  )
}

// ───────────────────────── String-form audit row (for SSE bridge) ─────────────────────────
// Mirrors AuditEntry layout but produces a single-line HTML string with no
// embedded newlines so it can be placed after a single `data: ` SSE field.
export function renderAuditEntryHtml(r: AuditRow): string {
  const badge =
    ACTION_BADGES[r.action] ??
    ({
      label: r.action,
      className:
        'bg-gray-100 text-gray-700 border-gray-200 dark:bg-[#1f1f1f] dark:text-zinc-300 dark:border-[#262626]',
    } as ActionBadge)
  const fields: string[] = r.changedFields ? safeParse<string[]>(r.changedFields) || [] : []
  const entityLabel = ENTITY_LABELS[r.entityType] ?? r.entityType
  const displayLabel = r.entityLabel || `#${r.entityId}`

  const changedSummary =
    r.action === 'update' && fields.length > 0
      ? `<span class="text-callout text-gray-500 dark:text-zinc-400 truncate">${
          fields.length === 1
            ? `changed ${esc(fields[0])}`
            : `changed ${fields.length} fields`
        }</span>`
      : ''

  const ip = ipBadge(r.ipAddress)
  const ipBlock =
    `<span class="flex items-center gap-1.5 text-callout text-gray-500 dark:text-zinc-400 whitespace-nowrap">` +
    `<span class="text-callout">${ip.glyph}</span>` +
    (ip.city ? `<span>${esc(ip.city)}</span>` : '') +
    (ip.ip ? `<span class="text-callout text-gray-400 dark:text-zinc-500">${esc(ip.ip)}</span>` : '') +
    `</span>` +
    `<span class="text-callout text-gray-400 dark:text-zinc-600 whitespace-nowrap">·</span>`

  return (
    `<div class="flex items-center gap-3 px-4 py-1.5 rounded-xl hover:bg-gray-50 dark:hover:bg-[#171717] transition-colors fade-in" data-audit-id="${r.id}">` +
    ipBlock +
    `<span class="text-callout text-gray-500 dark:text-zinc-400 whitespace-nowrap">${esc(entityLabel)}</span>` +
    `<span class="text-button-sm px-2.5 py-0.5 rounded-full border whitespace-nowrap ${badge.className}">${esc(
      badge.label,
    )}</span>` +
    `<span class="text-callout text-gray-900 dark:text-zinc-100 truncate">${esc(displayLabel)}</span>` +
    changedSummary +
    `<span class="ml-auto text-callout text-gray-400 dark:text-zinc-500 whitespace-nowrap">${esc(
      formatAbsolute(r.createdAt),
    )}</span>` +
    `</div>`
  )
}
