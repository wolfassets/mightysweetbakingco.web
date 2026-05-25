import type { FC } from 'hono/jsx'
import { Layout } from './Layout.js'
import { HoldArchiveButton } from './components.js'

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface Event {
  id: number
  name: string
  eventDate: string
  location: string | null
  eventCost: number
  totalPrepared: number
  totalSold: number
  totalGiveaway: number
  totalRevenue: number
  totalCost: number
  netProfit: number
  cashCollected?: number
  venmoCollected?: number
  otherCollected?: number
  notes: string | null
  deletedAt?: string | null
  createdAt?: string
}

export interface EventItem {
  id: number
  eventId: number
  flavorId: number | null
  flavorName: string
  prepared: number | null
  sold: number | null
  giveaway: number | null
  unitPrice: number | null
  unitCost: number | null
}

export type SortColumn =
  | 'id'
  | 'name'
  | 'eventDate'
  | 'totalPrepared'
  | 'totalSold'
  | 'totalGiveaway'
  | 'totalRevenue'
  | 'totalCost'
  | 'netProfit'
  | 'eventCost'
export type SortDir = 'asc' | 'desc'

// ────────────────────────────────────────────────────────────────────────────
// Local formatters (mirror web-b's EventsTable.tsx exactly)
// ────────────────────────────────────────────────────────────────────────────

const formatDate = (s: string): string => {
  const d = new Date(s + 'T00:00:00')
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Mirrors Deliveries' formatDateFull: uppercase weekday badge (FRI/WED) in a
// muted font to the left, then the full date. Used in the table date column.
const formatDateFull = (s: string) => {
  const d = new Date(s + 'T00:00:00')
  if (isNaN(d.getTime())) return <span>{s}</span>
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
  const rest = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  return (
    <>
      <span class="text-callout text-gray-400 dark:text-zinc-500 mr-3">{weekday}</span>
      <span>{rest}</span>
    </>
  )
}

const formatCurrency = (n: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

// Filter-pill control, adapted from Deliveries' filter UI for visual parity.
const FilterPill: FC<{
  label: string
  active: boolean
  activeText: string | null
  isOpen: boolean
  children: any
}> = ({ label, active, activeText, isOpen, children }) => {
  const key = label.toLowerCase().replace(/\s+/g, '-')
  return (
    <div class="relative" data-events-pill={key}>
      <button
        type="button"
        data-events-pill-trigger={key}
      class={`px-4 py-1.5 rounded-full text-button transition-all flex items-center gap-2 border ${
          active
            ? 'bg-pink-50 dark:bg-pink-950/40 border-pink-200 dark:border-pink-900/60 text-pink-700 dark:text-pink-300'
            : isOpen
            ? 'bg-gray-100 dark:bg-[#1f1f1f] border-gray-300 dark:border-[#3f3f3f] text-gray-900 dark:text-zinc-100'
            : 'bg-white dark:bg-[#0a0a0a] border-gray-200 dark:border-[#262626] text-gray-700 dark:text-zinc-300 hover:bg-[#fafafa] dark:hover:bg-[#171717]'
        }`}
      >
        <span>{label}</span>
        <span data-events-pill-active-text class={`text-caption opacity-80 max-w-[160px] truncate ${active && activeText ? '' : 'hidden'}`}>
          {active && activeText ? `: ${activeText}` : ''}
        </span>
        <span
          data-events-pill-clear={key}
          role="button"
          tabindex={0}
          class={`ml-0.5 opacity-60 hover:opacity-100 inline-flex cursor-pointer ${active ? '' : 'hidden'}`}
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </span>
        {active ? (
          <svg
            data-events-pill-chevron
            class={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        ) : null}
      </button>
      <div
        data-events-pill-popover={key}
        class={`absolute right-0 top-full mt-2 z-50 bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-[#262626] rounded-2xl shadow-xl fade-in ${isOpen ? '' : 'hidden'}`}
      >
        {children}
      </div>
    </div>
  )
}

// Client-side filter for the events table (search + date window/preset).
// Reads data-name / data-date on each .event-row; no server round-trip. Bound
// once via document-level delegation so it survives htmx swaps of the card.
const EVENTS_FILTER_SCRIPT = `
(function(){
  function closeAllPopovers(){
    document.querySelectorAll('[data-events-pill-popover]').forEach(function(p){ p.classList.add('hidden'); });
    document.querySelectorAll('[data-events-pill-chevron]').forEach(function(c){ c.classList.remove('rotate-180'); });
  }

  function iso(dt){
    var mm = String(dt.getMonth()+1).padStart(2,'0');
    var dd = String(dt.getDate()).padStart(2,'0');
    return dt.getFullYear() + '-' + mm + '-' + dd;
  }

  function formatRangeText(from, to){
    if(!from && !to) return null;
    if(from && to) return from + ' to ' + to;
    if(from) return 'From ' + from;
    return 'Until ' + to;
  }

  function applyDatePreset(key){
    var now = new Date();
    var y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    var from = '', to = '';
    if(key === 'last7'){
      from = iso(new Date(y,m,d-6));
      to = iso(now);
    } else if(key === 'last30'){
      from = iso(new Date(y,m,d-29));
      to = iso(now);
    } else if(key === 'thisMonth'){
      from = iso(new Date(y,m,1));
      to = iso(new Date(y,m+1,0));
    } else if(key === 'lastMonth'){
      from = iso(new Date(y,m-1,1));
      to = iso(new Date(y,m,0));
    } else if(key === 'thisYear'){
      from = iso(new Date(y,0,1));
      to = iso(new Date(y,11,31));
    }
    var fromEl = document.getElementById('events-date-from');
    var toEl = document.getElementById('events-date-to');
    if(fromEl) fromEl.value = from;
    if(toEl) toEl.value = to;
    applyFilters();
  }

  function updateUi(q, from, to){
    var searchText = q ? q : null;
    var dateText = formatRangeText(from, to);
    var searchTextNode = document.querySelector('[data-events-pill=\"search\"] [data-events-pill-active-text]');
    if(searchTextNode) searchTextNode.textContent = searchText ? ': ' + searchText : '';
    var dateTextNode = document.querySelector('[data-events-pill=\"date\"] [data-events-pill-active-text]');
    if(dateTextNode) dateTextNode.textContent = dateText ? ': ' + dateText : '';

    updateActiveState('search', searchText);
    updateActiveState('date', dateText);
    updateClearAllVisibility(searchText || dateText);
  }

  function updateActiveState(key, activeText){
    var keyToSelector = { search: 'search', date: 'date' };
    var el = document.querySelector('[data-events-pill=\"' + keyToSelector[key] + '\"]');
    if(!el) return;
    var btn = el.querySelector('button');
    if(!btn) return;
    var isActive = !!activeText;
    btn.classList.toggle('bg-pink-50', isActive);
    btn.classList.toggle('dark:bg-pink-950/40', isActive);
    btn.classList.toggle('border-pink-200', isActive);
    btn.classList.toggle('dark:border-pink-900/60', isActive);
    btn.classList.toggle('text-pink-700', isActive);
    btn.classList.toggle('dark:text-pink-300', isActive);
    var clear = el.querySelector('[data-events-pill-clear]');
    if(clear) clear.classList.toggle('hidden', !isActive);
    var textHint = el.querySelector('[data-events-pill-active-text]');
    if(textHint) textHint.classList.toggle('hidden', !isActive);
  }

  function updateClearAllVisibility(show){
    var clearAll = document.querySelector('[data-events-clear-all]');
    if(!clearAll) return;
    clearAll.classList.toggle('hidden', !show);
  }

  function applyFilters(){
    var qEl = document.getElementById('events-search');
    var fromEl = document.getElementById('events-date-from');
    var toEl = document.getElementById('events-date-to');
    var q = (qEl && qEl.value ? qEl.value : '').trim().toLowerCase();
    var from = (fromEl && fromEl.value ? fromEl.value : '');
    var to = (toEl && toEl.value ? toEl.value : '');
    var rows = document.querySelectorAll('#events-table-body tr.event-row');
    var visible = 0;

    rows.forEach(function(r){
      var name = r.getAttribute('data-name') || '';
      var dateStr = r.getAttribute('data-date') || '';
      var ok = true;
      if(q && name.indexOf(q) < 0) ok = false;
      if(ok && from && dateStr && dateStr < from) ok = false;
      if(ok && to && dateStr && dateStr > to) ok = false;
      r.style.display = ok ? '' : 'none';
      if(ok) visible += 1;
    });

    var hint = document.getElementById('events-filter-hint');
    if(hint){
      hint.textContent = visible === rows.length ? 'Track your sales events and performance.' : 'Showing ' + visible + ' of ' + rows.length + ' events.';
    }
    var noMatch = document.getElementById('events-filter-no-match');
    if(noMatch){
      noMatch.classList.toggle('hidden', visible > 0 || rows.length === 0);
    }
    updateUi(q, from, to);
  }

  function clearPill(key){
    if(key === 'search'){
      var el = document.getElementById('events-search');
      if(el) el.value = '';
    }
    if(key === 'date'){
      var fromEl = document.getElementById('events-date-from');
      var toEl = document.getElementById('events-date-to');
      if(fromEl) fromEl.value = '';
      if(toEl) toEl.value = '';
    }
    applyFilters();
  }

  function clearAll(){
    clearPill('search');
    clearPill('date');
  }

  function schedule(){
    clearTimeout(window.__eventsFilterDebounce);
    window.__eventsFilterDebounce = setTimeout(applyFilters, 80);
  }

  if(!window.__eventsFilterBound){
    window.__eventsFilterBound = true;
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape') closeAllPopovers();
    });
    document.body.addEventListener('click', function(e){
      var trigger = e.target.closest('[data-events-pill-trigger]');
      var clearPillEl = e.target.closest('[data-events-pill-clear]');
      var preset = e.target.closest('[data-events-date-preset]');
      var clearAllEl = e.target.closest('[data-events-clear-all]');
      if(clearPillEl){
        e.preventDefault();
        e.stopPropagation();
        clearPill(clearPillEl.getAttribute('data-events-pill-clear'));
        return;
      }
      if(clearAllEl){
        e.preventDefault();
        e.stopPropagation();
        clearAll();
        return;
      }
      if(e.target.closest('[data-events-date-clear]')){
        e.preventDefault();
        e.stopPropagation();
        clearPill('date');
        return;
      }
      if(preset){
        e.preventDefault();
        e.stopPropagation();
        var presetKey = preset.getAttribute('data-events-date-preset');
        if(presetKey) applyDatePreset(presetKey);
        return;
      }
      if(trigger){
        e.preventDefault();
        var key = trigger.getAttribute('data-events-pill-trigger');
        var pop = document.querySelector('[data-events-pill-popover=\"' + key + '\"]');
        if(!pop) return;
        var wasOpen = !pop.classList.contains('hidden');
        closeAllPopovers();
        if(!wasOpen){
          pop.classList.remove('hidden');
          var chev = trigger.querySelector('[data-events-pill-chevron]');
          if(chev) chev.classList.add('rotate-180');
        }
        return;
      }
      if(!e.target.closest('[data-events-pill]') && !e.target.closest('[data-events-pill-popover]')){
        closeAllPopovers();
      }
    });
    document.addEventListener('input', function(e){
      if(e.target.closest('form[data-events-filter-form]')) schedule();
    });
    document.addEventListener('change', function(e){
      if(e.target.closest('form[data-events-filter-form]')) schedule();
    });
    document.addEventListener('submit', function(e){
      if(e.target.closest('form[data-events-filter-form]')){
        e.preventDefault();
        applyFilters();
      }
    });
    document.body && document.body.addEventListener('htmx:afterSwap', applyFilters);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', applyFilters);
  } else {
    applyFilters();
  }
})();`

// ────────────────────────────────────────────────────────────────────────────
// Sort helper — pure, used by routes
// ────────────────────────────────────────────────────────────────────────────

export function sortEvents(events: Event[], col: SortColumn, dir: SortDir): Event[] {
  const sorted = [...events].sort((a, b) => {
    let cmp = 0
    if (col === 'id') cmp = a.id - b.id
    else if (col === 'name') cmp = a.name.localeCompare(b.name)
    else if (col === 'eventDate') cmp = new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime()
    else cmp = (a[col] as number) - (b[col] as number)
    return dir === 'asc' ? cmp : -cmp
  })
  return sorted
}

// ────────────────────────────────────────────────────────────────────────────
// Inline scripts (vanilla JS — no framework)
// ────────────────────────────────────────────────────────────────────────────

// Animated counter that fades from 0 → target. Mirrors framer-motion's
// `animate(mv, value)` from EventsTable.tsx's <AnimatedNumber> component.
const animatedCounterScript = `
(function(){
  function easeOutCubic(t){return 1-Math.pow(1-t,3);}
  function animateEl(el){
    var target=parseFloat(el.getAttribute('data-target'));
    var format=el.getAttribute('data-format')||'plain';
    var digits=parseInt(el.getAttribute('data-digits')||'1',10);
    var duration=600, start=performance.now();
    function fmt(n){
      if(format==='currency') return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
      if(format==='percent')  return n.toFixed(digits)+'%';
      return n.toLocaleString();
    }
    function tick(now){
      var p=Math.min((now-start)/duration,1);
      var v=target*easeOutCubic(p);
      el.textContent=fmt(v);
      if(p<1) requestAnimationFrame(tick);
      else el.textContent=fmt(target);
    }
    requestAnimationFrame(tick);
  }
  function run(root){
    (root||document).querySelectorAll('.animated-number:not([data-animated])').forEach(function(el){
      el.setAttribute('data-animated','1');
      animateEl(el);
    });
  }
  run(document);
  document.body.addEventListener('htmx:afterSwap',function(e){run(e.target);});
})();`

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

const SortableHeader: FC<{
  label: string
  column: SortColumn
  currentColumn: SortColumn
  direction: SortDir
  className?: string
  showArchived?: boolean
}> = ({ label, column, currentColumn, direction, className = '', showArchived }) => {
  const isActive = currentColumn === column
  const isRight = className.includes('text-right')
  const isCenter = className.includes('text-center')
  // Clicking active column flips direction; otherwise default to desc.
  const nextDir: SortDir = isActive ? (direction === 'asc' ? 'desc' : 'asc') : 'desc'
  const archivedQs = showArchived ? '&archived=1' : ''
  const url = `/events?sort=${column}&dir=${nextDir}${archivedQs}`
  return (
    <th
      class={`cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-[#171717] transition-colors ${className}`}
      hx-get={url}
      hx-target="#events-table-body"
      hx-swap="outerHTML"
      hx-push-url="true"
    >
      <div class={`flex items-center gap-1 ${isRight ? 'justify-end' : isCenter ? 'justify-center' : ''}`}>
        <span>{label}</span>
        {isActive && (
          <svg
            class={`w-3 h-3 text-pink-500 dark:text-pink-400 transition-transform ${direction === 'desc' ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M5 15l7-7 7 7" />
          </svg>
        )}
      </div>
    </th>
  )
}

const StatCard: FC<{
  label: string
  value: string
  sublabel?: string
  highlight?: boolean
  numericValue?: number
  format?: 'currency' | 'percent' | 'plain'
  digits?: number
}> = ({ label, value, sublabel, highlight, numericValue, format, digits }) => (
  <div class="p-4 bg-[#fafafa] dark:bg-[#171717] rounded-2xl">
    <p class="text-headline text-gray-700 dark:text-zinc-300">{label}</p>
    <p
      class={`text-title-2 mt-1 ${
        highlight ? 'text-pink-600 dark:text-pink-400' : 'text-gray-900 dark:text-zinc-100'
      }`}
    >
      {numericValue !== undefined && format ? (
        <span class="animated-number" data-target={String(numericValue)} data-format={format} data-digits={String(digits ?? 1)}>
          {value}
        </span>
      ) : (
        value
      )}
    </p>
    {sublabel && <p class="text-headline text-gray-500 dark:text-zinc-400 mt-1">{sublabel}</p>}
  </div>
)

// ────────────────────────────────────────────────────────────────────────────
// EventRow — single row, used for hot-swap by routes (e.g. PATCH)
// ────────────────────────────────────────────────────────────────────────────

export const EventRow: FC<{ e: Event; showArchived?: boolean }> = ({ e, showArchived }) => (
  <tr
    id={`event-${e.id}`}
    class="event-row group cursor-pointer hover:bg-pink-50 dark:hover:bg-pink-950/30 transition-colors"
    onclick={`window.location.href='/events/${e.id}'`}
    data-name={e.name.trim().toLowerCase()}
    data-date={e.eventDate}
    data-rev={e.totalRevenue.toString()}
    data-prof={e.netProfit.toString()}
  >
    <td>
      <span class="px-2 py-3 min-h-[44px] flex items-center justify-center text-pink-600 dark:text-pink-400 text-callout">
        {e.id}
      </span>
    </td>
    <td>
      <span class="px-4 py-3 min-h-[44px] flex items-center text-gray-900 dark:text-zinc-100 text-headline">
        {e.name}
      </span>
    </td>
    <td>
      <span class="px-4 py-3 min-h-[44px] flex items-center text-gray-600 dark:text-zinc-400 text-callout whitespace-nowrap">
        {formatDateFull(e.eventDate)}
      </span>
    </td>
    <td>
      <span class="px-4 py-3 min-h-[44px] flex items-center justify-center text-gray-600 dark:text-zinc-400 text-callout">
        {e.totalPrepared}
      </span>
    </td>
    <td>
      <span class="px-4 py-3 min-h-[44px] flex items-center justify-center text-gray-600 dark:text-zinc-400 text-callout">
        {e.totalSold}
      </span>
    </td>
    <td>
      <span class="px-4 py-3 min-h-[44px] flex items-center justify-center text-gray-600 dark:text-zinc-400 text-callout">
        {e.totalGiveaway}
      </span>
    </td>
    <td>
      <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-callout whitespace-nowrap">
        {e.totalRevenue > 0 ? (
          <span class="text-gray-900 dark:text-zinc-100">{formatCurrency(e.totalRevenue)}</span>
        ) : (
          <span class="text-gray-300 dark:text-zinc-700">—</span>
        )}
      </span>
    </td>
    <td>
      <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-callout whitespace-nowrap">
        {e.totalCost > 0 ? (
          <span class="text-gray-600 dark:text-zinc-400">{formatCurrency(e.totalCost)}</span>
        ) : (
          <span class="text-gray-300 dark:text-zinc-700">—</span>
        )}
      </span>
    </td>
    <td>
      <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-callout whitespace-nowrap">
        <span class={e.eventCost > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-400 dark:text-zinc-500'}>
          {formatCurrency(e.eventCost || 0)}
        </span>
      </span>
    </td>
    <td>
      <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-callout whitespace-nowrap">
        {e.netProfit > 0 ? (
          <span class="text-green-600 dark:text-green-400">{formatCurrency(e.netProfit)}</span>
        ) : e.netProfit < 0 ? (
          <span class="text-red-500 dark:text-red-400">{formatCurrency(e.netProfit)}</span>
        ) : (
          <span class="text-gray-300 dark:text-zinc-700">—</span>
        )}
      </span>
    </td>
    {showArchived && (
      <td>
        <span class="px-4 py-3 min-h-[44px] flex items-center justify-center">
          <button
            type="button"
            hx-post={`/events/${e.id}/restore`}
            hx-target={`#event-${e.id}`}
            hx-swap="outerHTML"
            onclick="event.stopPropagation()"
            class="text-button-sm text-pink-500 dark:text-pink-400 hover:text-pink-600 dark:hover:text-pink-300"
          >
            Restore
          </button>
        </span>
      </td>
    )}
  </tr>
)

// ────────────────────────────────────────────────────────────────────────────
// EventsTableBody — what `hx-target="#events-table-body"` swaps
// ────────────────────────────────────────────────────────────────────────────

export const EventsTableBody: FC<{
  events: Event[]
  sortColumn: SortColumn
  sortDirection: SortDir
  showArchived: boolean
}> = ({ events, sortColumn, sortDirection, showArchived }) => {
  const totals = {
    prepared: events.reduce((s, e) => s + e.totalPrepared, 0),
    sold: events.reduce((s, e) => s + e.totalSold, 0),
    giveaway: events.reduce((s, e) => s + e.totalGiveaway, 0),
    revenue: events.reduce((s, e) => s + e.totalRevenue, 0),
    cost: events.reduce((s, e) => s + e.totalCost, 0),
    fee: events.reduce((s, e) => s + (e.eventCost || 0), 0),
    profit: events.reduce((s, e) => s + e.netProfit, 0),
  }
  return (
    <tbody id="events-table-body">
      {events.map((e) => (
        <EventRow e={e} showArchived={showArchived} />
      ))}
      {events.length > 0 && (
        <tr class="border-t-2 border-gray-200 dark:border-[#262626] bg-gray-50 dark:bg-[#171717]">
          <td></td>
          <td>
            <span class="px-4 py-3 min-h-[44px] flex items-center text-headline text-gray-900 dark:text-zinc-100">
              Total
            </span>
          </td>
          <td>
            <span class="px-4 py-3 min-h-[44px] flex items-center text-gray-400 dark:text-zinc-500 text-callout">
              {events.length} events
            </span>
          </td>
          <td>
            <span class="px-4 py-3 min-h-[44px] flex items-center justify-center text-gray-900 dark:text-zinc-100 text-callout">
              {totals.prepared.toLocaleString()}
            </span>
          </td>
          <td>
            <span class="px-4 py-3 min-h-[44px] flex items-center justify-center text-gray-900 dark:text-zinc-100 text-callout">
              {totals.sold.toLocaleString()}
            </span>
          </td>
          <td>
            <span class="px-4 py-3 min-h-[44px] flex items-center justify-center text-gray-900 dark:text-zinc-100 text-callout">
              {totals.giveaway.toLocaleString()}
            </span>
          </td>
          <td>
            <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-callout text-gray-900 dark:text-zinc-100 whitespace-nowrap">
              {formatCurrency(totals.revenue)}
            </span>
          </td>
          <td>
            <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-callout text-gray-900 dark:text-zinc-100 whitespace-nowrap">
              {formatCurrency(totals.cost)}
            </span>
          </td>
          <td>
            <span
              class={`px-4 py-3 min-h-[44px] flex items-center justify-end text-callout whitespace-nowrap ${
                totals.fee > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-400 dark:text-zinc-500'
              }`}
            >
              {formatCurrency(totals.fee)}
            </span>
          </td>
          <td>
            <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-callout whitespace-nowrap">
              {totals.profit >= 0 ? (
                <span class="text-green-600 dark:text-green-400">{formatCurrency(totals.profit)}</span>
              ) : (
                <span class="text-red-500 dark:text-red-400">{formatCurrency(totals.profit)}</span>
              )}
            </span>
          </td>
          {showArchived && <td></td>}
        </tr>
      )}
    </tbody>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// EventsCard — the full white floating card + header + stats + table.
// Returned standalone by the POST handler so the form can swap the whole list.
// ────────────────────────────────────────────────────────────────────────────

export const EventsCard: FC<{
  events: Event[]
  sortColumn: SortColumn
  sortDirection: SortDir
  showArchived: boolean
}> = ({ events, sortColumn, sortDirection, showArchived }) => {
  const totals = {
    prepared: events.reduce((s, e) => s + e.totalPrepared, 0),
    sold: events.reduce((s, e) => s + e.totalSold, 0),
    giveaway: events.reduce((s, e) => s + e.totalGiveaway, 0),
    revenue: events.reduce((s, e) => s + e.totalRevenue, 0),
    cost: events.reduce((s, e) => s + e.totalCost, 0),
    fee: events.reduce((s, e) => s + (e.eventCost || 0), 0),
    profit: events.reduce((s, e) => s + e.netProfit, 0),
  }
  const eventsWithSales = events.filter((e) => e.totalSold > 0).length
  const avgProfitPerEvent = eventsWithSales > 0 ? totals.profit / eventsWithSales : 0
  const avgRevenuePerEvent = eventsWithSales > 0 ? totals.revenue / eventsWithSales : 0
  const profitMargin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0
  const sellThroughRate = totals.prepared > 0 ? (totals.sold / totals.prepared) * 100 : 0

  return (
    <div id="events-card" class="w-full bg-white dark:bg-[#0a0a0a] rounded-3xl overflow-hidden fade-in">
      {/* Header */}
      <div class="flex items-center justify-between px-8 pt-8 pb-4">
        <div>
          <h2 class="text-title-2 text-gray-900 dark:text-zinc-100">View Your Events</h2>
        </div>
        <div class="flex items-center gap-3">
          <a
            href={showArchived ? '/events' : '/events?archived=1'}
            class={`px-5 py-2.5 border rounded-full text-button transition-all hover:shadow-md flex items-center gap-2 ${
              showArchived
                ? 'bg-gray-900 border-gray-900 text-white hover:bg-gray-800 dark:bg-zinc-100 dark:border-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200'
                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 dark:bg-[#0a0a0a] dark:border-[#262626] dark:text-zinc-300 dark:hover:bg-[#171717]'
            }`}
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width={2}
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
              />
            </svg>
            Archived
          </a>
          <button
            type="button"
            hx-post="/events/quick-add"
            hx-target="body"
            hx-swap="none"
            class="px-5 py-2.5 bg-pink-500 hover:bg-pink-600 text-white rounded-full text-button transition-all hover:shadow-md flex items-center gap-2"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Event
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      {events.length > 0 && (
        <div class="px-8 pb-6">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Sell-through Rate"
              value={`${sellThroughRate.toFixed(1)}%`}
              numericValue={sellThroughRate}
              format="percent"
              digits={1}
              sublabel={`${totals.sold.toLocaleString()} of ${totals.prepared.toLocaleString()} sold`}
              highlight
            />
            <StatCard
              label="Profit Margin"
              value={`${profitMargin.toFixed(1)}%`}
              numericValue={profitMargin}
              format="percent"
              digits={1}
              sublabel={`${formatCurrency(totals.profit)} total profit`}
            />
            <StatCard
              label="Avg. Revenue/Event"
              value={formatCurrency(avgRevenuePerEvent)}
              numericValue={avgRevenuePerEvent}
              format="currency"
              sublabel={`${eventsWithSales} events with sales`}
            />
            <StatCard
              label="Avg. Profit/Event"
              value={formatCurrency(avgProfitPerEvent)}
              numericValue={avgProfitPerEvent}
              format="currency"
              sublabel="per event with sales"
            />
          </div>
        </div>
      )}

      {/* Filter bar */}
      {events.length > 0 && (
        <div class="flex items-start justify-between gap-4 flex-wrap px-8 pb-4">
          <p id="events-filter-hint" class="text-body text-gray-700 dark:text-zinc-300">
            Track your sales events and performance.
          </p>
          <div class="flex items-center gap-2 flex-wrap">
            <FilterPill label="Search" active={false} activeText={null} isOpen={false}>
              <form data-events-filter-form class="p-3 w-72">
                <label class="block text-caption uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-400 mb-1.5">Search by name</label>
                <input
                  id="events-search"
                  type="text"
                  placeholder="Start typing to filter"
                  class="w-full px-3 py-2 text-callout bg-gray-50 dark:bg-[#171717] border border-gray-200 dark:border-[#262626] rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-600"
                />
              </form>
            </FilterPill>

            <FilterPill label="Date" active={false} activeText={null} isOpen={false}>
              <form data-events-filter-form class="p-4 w-80">
                <div class="flex flex-wrap gap-1.5 mb-3">
                  {(['last7', 'last30', 'thisMonth', 'lastMonth', 'thisYear', 'all'] as const).map((preset) => (
                    <button
                      type="button"
                      data-events-date-preset={preset}
                      class="px-3 py-1 text-button-sm rounded-full border bg-gray-50 dark:bg-[#171717] text-gray-700 dark:text-zinc-300 border-gray-200 dark:border-[#262626] hover:bg-pink-50 dark:hover:bg-pink-950/30 hover:text-pink-600 dark:hover:text-pink-400 transition-colors"
                    >
                      {preset === 'last7'
                        ? 'Last 7 days'
                        : preset === 'last30'
                          ? 'Last 30 days'
                          : preset === 'thisMonth'
                            ? 'This month'
                            : preset === 'lastMonth'
                              ? 'Last month'
                              : preset === 'thisYear'
                                ? 'This year'
                                : 'All time'}
                    </button>
                  ))}
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-caption uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-400 mb-1.5">From</label>
                    <input
                      id="events-date-from"
                      type="date"
                      class="w-full px-3 py-2 text-callout bg-gray-50 dark:bg-[#171717] border border-gray-200 dark:border-[#262626] rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 text-gray-900 dark:text-zinc-100"
                    />
                  </div>
                  <div>
                    <label class="block text-caption uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-400 mb-1.5">To</label>
                    <input
                      id="events-date-to"
                      type="date"
                      class="w-full px-3 py-2 text-callout bg-gray-50 dark:bg-[#171717] border border-gray-200 dark:border-[#262626] rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 text-gray-900 dark:text-zinc-100"
                    />
                  </div>
                    <div class="col-span-2">
                    <button
                      type="button"
                      data-events-date-clear
                      class="mt-3 text-button-sm text-pink-600 dark:text-pink-400 hover:underline inline-flex items-center"
                    >
                      Clear date filter
                    </button>
                  </div>
                </div>
                <div class="flex justify-end pt-3 mt-2 border-t border-gray-100 dark:border-[#1f1f1f]">
                  <button
                    type="submit"
                    class="px-3 py-1.5 text-button-sm bg-pink-500 text-white rounded-lg hover:bg-pink-600 transition-colors"
                  >
                    Apply
                  </button>
                </div>
              </form>
            </FilterPill>

            <button
              type="button"
              data-events-clear-all
              class="text-button-sm text-gray-500 dark:text-zinc-400 hover:text-pink-600 dark:hover:text-pink-400 transition-colors px-2 hidden"
            >
              Clear all
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div class="px-4 pb-4">
        <table class="data-table">
          <thead>
            <tr>
              <SortableHeader label="#" column="id" currentColumn={sortColumn} direction={sortDirection} className="w-12 text-center" showArchived={showArchived} />
              <SortableHeader label="Event Name" column="name" currentColumn={sortColumn} direction={sortDirection} className="w-52" showArchived={showArchived} />
              <SortableHeader label="Date" column="eventDate" currentColumn={sortColumn} direction={sortDirection} className="w-44" showArchived={showArchived} />
              <SortableHeader label="Prepared" column="totalPrepared" currentColumn={sortColumn} direction={sortDirection} className="w-20 text-center" showArchived={showArchived} />
              <SortableHeader label="Sold" column="totalSold" currentColumn={sortColumn} direction={sortDirection} className="w-14 text-center" showArchived={showArchived} />
              <SortableHeader label="Giveaway" column="totalGiveaway" currentColumn={sortColumn} direction={sortDirection} className="w-20 text-center" showArchived={showArchived} />
              <SortableHeader label="Revenue" column="totalRevenue" currentColumn={sortColumn} direction={sortDirection} className="w-24 text-right" showArchived={showArchived} />
              <SortableHeader label="COGS" column="totalCost" currentColumn={sortColumn} direction={sortDirection} className="w-20 text-right" showArchived={showArchived} />
              <SortableHeader label="Fee" column="eventCost" currentColumn={sortColumn} direction={sortDirection} className="w-20 text-right" showArchived={showArchived} />
              <SortableHeader label="Profit" column="netProfit" currentColumn={sortColumn} direction={sortDirection} className="w-24 text-right" showArchived={showArchived} />
              {showArchived && (
                <th class="w-20">
                  <span class="px-2 py-3 text-caption text-gray-400 dark:text-zinc-500 uppercase tracking-[0.08em]"></span>
                </th>
              )}
            </tr>
          </thead>
          <EventsTableBody
            events={events}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            showArchived={showArchived}
          />
        </table>

        {events.length === 0 && (
          <div class="text-center py-12 text-callout text-gray-400 dark:text-zinc-500">
            No events yet. Click "Add Event" to get started.
          </div>
        )}
        <div id="events-filter-no-match" class="text-center py-6 text-callout text-gray-400 dark:text-zinc-500 hidden">
          No events match your filters.{' '}
          <button type="button" data-events-clear-all class="text-pink-600 dark:text-pink-400 hover:underline">
            Clear filters
          </button>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: EVENTS_FILTER_SCRIPT }} />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// EventsPage — top-level export, called by route handler via `page(c, …)`
// ────────────────────────────────────────────────────────────────────────────

export const EventsPage: FC<{
  events: Event[]
  sortColumn?: SortColumn
  sortDirection?: SortDir
  showArchived?: boolean
}> = ({ events, sortColumn = 'id', sortDirection = 'desc', showArchived = false }) => {
  const sorted = sortEvents(events, sortColumn, sortDirection)
  return (
    <Layout title="Events" active="events">
      <EventsCard
        events={sorted}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        showArchived={showArchived}
      />
      <script dangerouslySetInnerHTML={{ __html: animatedCounterScript }} />
    </Layout>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// EventsTableView — back-compat shim. The OLD route in index.tsx still imports
// this and passes it raw events. It used to be the only table renderer.
// Kept here so agent #12's overhaul doesn't break before it lands.
// ────────────────────────────────────────────────────────────────────────────

export const EventsTableView: FC<{ events: Event[] }> = ({ events }) => (
  <EventsCard events={sortEvents(events, 'id', 'desc')} sortColumn="id" sortDirection="desc" showArchived={false} />
)
