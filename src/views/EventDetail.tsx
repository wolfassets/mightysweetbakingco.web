import type { FC } from 'hono/jsx'
import { Layout } from './Layout.js'
import type { Event, EventItem } from './Events.js'
import type { Flavor, FlavorPrice } from './Flavors.js'

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

const normalizeName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

const getFlavorIdForName = (flavorName: string, flavors: Flavor[]): number => {
  const m = flavors.find((f) => f.name === flavorName)
  return m ? m.id : 9999
}

const getRatesForFlavor = (flavorName: string, flavors: Flavor[], prices: FlavorPrice[]): FlavorPrice[] => {
  const flavor = flavors.find((f) => f.name === flavorName)
  if (!flavor) return []
  return prices.filter((p) => p.flavorId === flavor.id)
}

const getSelectableRatesForItem = (
  item: EventItem & { rateId?: number | null },
  flavors: Flavor[],
  prices: FlavorPrice[],
): FlavorPrice[] => {
  const rates = getRatesForFlavor(item.flavorName, flavors, prices)
  return rates.filter((r) => r.isActive || r.id === (item as any).rateId)
}

const getMatchingRate = (
  item: EventItem & { rateId?: number | null },
  flavors: Flavor[],
  prices: FlavorPrice[],
): string => {
  if ((item as any).rateId) {
    const match = prices.find((p) => p.id === (item as any).rateId)
    if (match) return match.tierName
  }
  const rates = getRatesForFlavor(item.flavorName, flavors, prices)
  const match = rates.find((r) => r.cost === item.unitCost)
  return match ? match.tierName : 'Custom'
}

// Date formatting that returns JSX for the weekday-then-rest pattern
const dateFull = (s: string) => {
  const d = new Date(s + 'T00:00:00')
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
  const rest = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  return { weekday, rest }
}

// ────────────────────────────────────────────────────────────
// Inline JS (loaded once per page) — hold-to-delete row buttons,
// add-flavor modal show/hide, rate-dropdown htmx hookup.
// ────────────────────────────────────────────────────────────

const inlinePageScript = `
(function(){
  // Toast helper
  window.mscToast = function(msg, type){
    var t = document.createElement('div');
    t.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-xl text-button text-white shadow-lg ' +
      (type === 'error' ? 'bg-red-500' : 'bg-gray-900 dark:bg-zinc-100 dark:text-zinc-900');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function(){ t.style.opacity='0'; t.style.transition='opacity 200ms'; }, 2300);
    setTimeout(function(){ t.remove(); }, 2700);
  };

  // Bind hold-to-delete on every .hold-delete-btn (called after htmx swaps too)
  function bindHoldDelete(btn){
    if (btn.dataset.hdBound) return;
    btn.dataset.hdBound = '1';
    var interval = null, ready = false, progress = 0;
    var holdDuration = 800;
    function paint(){
      btn.style.background = progress > 0
        ? 'linear-gradient(90deg, rgba(239,68,68,' + (0.3 + progress * 0.7) + ') ' + (progress * 100) + '%, #fef2f2 ' + (progress * 100) + '%)'
        : '#fef2f2';
      btn.style.color = progress > 0.5 ? 'white' : '#ef4444';
      btn.style.border = '1px solid ' + (progress > 0 ? 'rgba(239,68,68,' + (0.3 + progress * 0.7) + ')' : '#fecaca');
      btn.textContent = progress > 0 ? (progress >= 0.8 ? 'Release' : 'Hold...') : 'Delete';
    }
    function start(){
      ready = false; progress = 0;
      var t = Date.now();
      interval = setInterval(function(){
        progress = Math.min((Date.now() - t) / holdDuration, 1);
        if (progress >= 1) { clearInterval(interval); interval = null; ready = true; }
        paint();
      }, 16);
    }
    function release(){
      if (interval) { clearInterval(interval); interval = null; }
      if (ready) { htmx.trigger(btn, 'confirmed'); }
      progress = 0; ready = false; paint();
    }
    function cancel(){
      if (interval) { clearInterval(interval); interval = null; }
      progress = 0; ready = false; paint();
    }
    btn.addEventListener('mousedown', start);
    btn.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', cancel);
    btn.addEventListener('touchstart', function(e){ e.preventDefault(); start(); });
    btn.addEventListener('touchend', function(e){ e.preventDefault(); release(); });
  }
  function bindHoldArchive(btn){
    if (btn.dataset.haBound) return;
    btn.dataset.haBound = '1';
    var label = btn.querySelector('span.label');
    var interval = null, ready = false, progress = 0;
    var holdDuration = 1000;
    function paint(){
      btn.style.background = progress > 0
        ? 'linear-gradient(90deg, #991b1b ' + (progress * 100) + '%, #dc2626 ' + (progress * 100) + '%)'
        : '#dc2626';
      if (label) label.textContent = progress >= 1 ? 'Release to Archive' : (progress > 0 ? 'Hold to Archive…' : 'Archive Event');
    }
    function start(){
      ready = false; progress = 0;
      var t = Date.now();
      interval = setInterval(function(){
        progress = Math.min((Date.now() - t) / holdDuration, 1);
        if (progress >= 1) { clearInterval(interval); interval = null; ready = true; }
        paint();
      }, 16);
    }
    function release(){
      if (interval) { clearInterval(interval); interval = null; }
      if (ready) { htmx.trigger(btn, 'confirmed'); }
      progress = 0; ready = false; paint();
    }
    function cancel(){
      if (interval) { clearInterval(interval); interval = null; }
      progress = 0; ready = false; paint();
    }
    btn.addEventListener('mousedown', start);
    btn.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', cancel);
    btn.addEventListener('touchstart', function(e){ e.preventDefault(); start(); });
    btn.addEventListener('touchend', function(e){ e.preventDefault(); release(); });
  }
  function rescan(root){
    (root || document).querySelectorAll('.hold-delete-btn').forEach(bindHoldDelete);
    (root || document).querySelectorAll('.hold-archive-btn').forEach(bindHoldArchive);
  }
  document.addEventListener('DOMContentLoaded', function(){ rescan(); });
  document.body.addEventListener('htmx:afterSwap', function(e){ rescan(e.target); });

  // Modal helpers
  window.mscOpenAddFlavor = function(){
    var el = document.getElementById('add-flavor-modal');
    if (el) { el.classList.remove('hidden'); el.classList.add('flex'); }
  };
  window.mscCloseAddFlavor = function(){
    var el = document.getElementById('add-flavor-modal');
    if (el) { el.classList.add('hidden'); el.classList.remove('flex'); }
    var f = document.getElementById('add-flavor-form');
    if (f) f.reset();
    var rateWrap = document.getElementById('add-flavor-rate-wrap');
    if (rateWrap) rateWrap.classList.add('hidden');
  };
  // Wire flavor-id select to filter rate dropdown
  window.mscOnFlavorPick = function(sel){
    var fId = sel.value;
    var rateSel = document.getElementById('add-flavor-rate');
    var rateWrap = document.getElementById('add-flavor-rate-wrap');
    if (!rateSel || !rateWrap) return;
    if (!fId) { rateWrap.classList.add('hidden'); rateSel.innerHTML = ''; return; }
    rateWrap.classList.remove('hidden');
    var opts = rateSel.querySelectorAll('option[data-flavor-id]');
    var first = '';
    opts.forEach(function(o){
      var match = o.getAttribute('data-flavor-id') === String(fId);
      o.style.display = match ? '' : 'none';
      if (match && !first) first = o.value;
    });
    rateSel.value = first;
  };
})();
`

// ────────────────────────────────────────────────────────────
// Reusable inline editable cell (number, used inside table)
// ────────────────────────────────────────────────────────────

// EditableNumber as a number input that PATCHes on change.
// For prepared cell in items table.
const EditableNumberInput: FC<{
  value: number
  patchUrl: string
  field: string
  showPencil?: boolean
  isCurrency?: boolean
  inline?: boolean
  className?: string
  rowTargetId?: string
}> = ({ value, patchUrl, field, showPencil, isCurrency, inline, className, rowTargetId }) => {
  const step = isCurrency ? '0.01' : '1'
  const display = isCurrency ? `$${value.toFixed(2)}` : String(value)
  // We render the static display by default; click toggles the inline input.
  // Simpler & matches web-b feel: always render an input, styled to look like text until focused.
  const valsJs = isCurrency
    ? `js:{"${field}": parseFloat(event.target.value)||0}`
    : `js:{"${field}": parseInt(event.target.value)||0}`
  const target = rowTargetId ? `#${rowTargetId}` : 'this'
  const swap = rowTargetId ? 'outerHTML' : 'none'
  return (
    <input
      type="number"
      step={step}
      value={String(value)}
      hx-patch={patchUrl}
      hx-trigger="change"
      hx-target={target}
      hx-swap={swap}
      hx-vals={valsJs}
      hx-ext="json-enc"
      class={
        inline
          ? 'w-16 text-right text-callout bg-white dark:bg-[#0a0a0a] dark:text-zinc-100 border border-pink-300 focus:ring-2 focus:ring-pink-500 focus:border-pink-500 rounded px-1 py-0.5'
          : `w-full text-center text-callout bg-transparent dark:text-zinc-100 border border-transparent hover:border-gray-200 dark:hover:border-[#262626] focus:border-pink-300 focus:ring-2 focus:ring-pink-500 rounded px-1 py-0.5 ${className ?? ''}`
      }
    />
  )
}

// ────────────────────────────────────────────────────────────
// EventItemRow — one row of the items table.
// Re-rendered by hx-swap=outerHTML after every PATCH.
// ────────────────────────────────────────────────────────────

export const EventItemRow: FC<{
  it: EventItem & { remaining?: number; revenue?: number; cogs?: number; profit?: number; rateId?: number | null }
  flavors: Flavor[]
  prices: FlavorPrice[]
}> = ({ it, flavors, prices }) => {
  const flavorId = getFlavorIdForName(it.flavorName, flavors)
  const remaining = (it as any).remaining ?? 0
  const revenue = (it as any).revenue ?? 0
  const cogs = (it as any).cogs ?? 0
  const profit = (it as any).profit ?? 0
  const matchingRate = getMatchingRate(it as any, flavors, prices)
  const selectableRates = getSelectableRatesForItem(it as any, flavors, prices)
  const rowId = `event-item-${it.id}`

  return (
    <tr id={rowId} class="group">
      <td>
        <span class="py-3 min-h-[44px] flex items-center justify-center text-pink-600 dark:text-pink-400 text-callout">
          {flavorId}
        </span>
      </td>
      <td>
        <span class="px-4 py-3 min-h-[44px] flex items-center text-callout text-gray-900 dark:text-zinc-100 whitespace-nowrap">
          {it.flavorName}
        </span>
      </td>
      <td></td>
      <td>
        <div class="px-4 py-3 min-h-[44px] flex items-center justify-start">
          <select
            hx-patch={`/event-items/${it.id}/rate`}
            hx-trigger="change"
            hx-target={`#${rowId}`}
            hx-swap="outerHTML"
            hx-vals="js:{tierName: event.target.value}"
            class="w-56 text-callout border border-gray-200 dark:border-[#262626] rounded-lg px-2 py-1 bg-white dark:bg-[#0a0a0a] dark:text-zinc-300 focus:ring-2 focus:ring-pink-500 focus:border-pink-500 cursor-pointer"
          >
            {selectableRates.map((rate) => (
              <option value={rate.tierName} selected={rate.tierName === matchingRate}>
                {rate.tierName} — ${rate.price.toFixed(2)}
                {rate.cost != null ? ` / $${rate.cost.toFixed(2)} cost` : ''}
              </option>
            ))}
            {matchingRate === 'Custom' && (
              <option value="Custom" selected>
                Custom
              </option>
            )}
          </select>
        </div>
      </td>
      <td>
        <div class="w-full px-4 py-3 min-h-[44px] flex items-center justify-center gap-1.5 group/edit">
          <svg
            class="text-gray-300 dark:text-zinc-700 group-hover/edit:text-gray-400 dark:group-hover/edit:text-zinc-500 shrink-0 transition-colors"
            style="width:1em;height:1em"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
          <EditableNumberInput
            value={(it as any).prepared ?? 0}
            patchUrl={`/event-items/${it.id}`}
            field="prepared"
            rowTargetId={rowId}
          />
        </div>
      </td>
      <td>
        <span class="px-4 py-3 min-h-[44px] flex items-center justify-center text-gray-600 dark:text-zinc-400 text-callout text-center">
          {remaining}
        </span>
      </td>
      <td>
        <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-gray-600 dark:text-zinc-400 text-callout text-right">
          {revenue > 0 ? formatCurrency(revenue) : '—'}
        </span>
      </td>
      <td>
        <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-callout text-right text-gray-600 dark:text-zinc-400">
          {cogs > 0 ? formatCurrency(cogs) : '—'}
        </span>
      </td>
      <td>
        <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-right">
          {profit > 0 ? (
            <span class="text-green-600 dark:text-green-400 text-callout">{formatCurrency(profit)}</span>
          ) : profit < 0 ? (
            <span class="text-red-500 dark:text-red-400 text-callout">{formatCurrency(profit)}</span>
          ) : (
            '—'
          )}
        </span>
      </td>
      <td>
        <div class="px-4 py-3 min-h-[44px] flex items-center justify-center">
          <button
            type="button"
            class="hold-delete-btn relative overflow-hidden rounded-full w-16 py-1 text-button-sm transition-all select-none text-center"
            style="background:#fef2f2;color:#ef4444;border:1px solid #fecaca;"
            hx-delete={`/event-items/${it.id}`}
            hx-trigger="confirmed"
            hx-target={`#${rowId}`}
            hx-swap="outerHTML swap:200ms"
            title="Hold to delete"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  )
}

// ────────────────────────────────────────────────────────────
// EventDetailPage — the full page.
// ────────────────────────────────────────────────────────────

export const EventDetailPage: FC<{
  event: Event & { notes?: string | null }
  items: (EventItem & { remaining?: number; revenue?: number; cogs?: number; profit?: number; rateId?: number | null })[]
  flavors: Flavor[]
  prices?: FlavorPrice[]
  allEvents?: Event[]
}> = ({ event, items, flavors, prices, allEvents }) => {
  // Default these so the page renders even if the caller hasn't been
  // updated to pass them (during the agent #5 / #12 hand-off window).
  const _prices: FlavorPrice[] = prices ?? []
  const _allEvents: Event[] = allEvents ?? []

  // Past events (same normalized name)
  const pastEvents = _allEvents
    .filter((e) => normalizeName(e.name) === normalizeName(event.name) && e.id !== event.id)
    .sort((a, b) => new Date(b.eventDate + 'T00:00:00').getTime() - new Date(a.eventDate + 'T00:00:00').getTime())

  // Totals for items
  const totalPrepared = items.reduce((s, i) => s + ((i as any).prepared ?? 0), 0)
  const totalRemaining = items.reduce((s, i) => s + ((i as any).remaining ?? 0), 0)
  const totalRevenue = items.reduce((s, i) => s + ((i as any).revenue ?? 0), 0)
  const totalCogs = items.reduce((s, i) => s + ((i as any).cogs ?? 0), 0)
  const totalProfit = items.reduce((s, i) => s + ((i as any).profit ?? 0), 0)

  const collectedTotal = (event.cashCollected || 0) + (event.venmoCollected || 0) + (event.otherCollected || 0)
  const det = dateFull(event.eventDate)

  return (
    <Layout title={event.name} active="events">
      <script dangerouslySetInnerHTML={{ __html: inlinePageScript }} />

      <div class="space-y-6">
        {/* Top Bar: Back link | Title | Buttons */}
        <div class="flex items-center gap-6">
          <a
            href="/events"
            class="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 dark:bg-zinc-100 px-4 py-2 text-button text-white dark:text-zinc-900 transition-colors hover:bg-gray-800 dark:hover:bg-zinc-200"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Events
          </a>
          <div class="flex-1 min-w-0 flex justify-center">
            <input
              name="name"
              value={event.name}
              hx-patch={`/events/${event.id}`}
              hx-trigger="change delay:500ms"
              hx-swap="none"
              hx-vals="js:{name: event.target.value}"
              class="text-title-2 text-gray-900 dark:text-zinc-100 hover:text-pink-600 dark:hover:text-pink-400 transition-colors bg-transparent text-center border-0 focus:ring-2 focus:ring-pink-500 rounded-lg px-2"
              style="font-size: 24px; font-weight: 700; min-width: 200px;"
            />
          </div>
          <div class="shrink-0 w-[350px] grid grid-cols-1 gap-2">
            <button
              type="button"
              class="hold-archive-btn relative overflow-hidden w-full inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-button text-white transition-colors select-none whitespace-nowrap"
              style="background:#dc2626;"
              hx-delete={`/events/${event.id}`}
              hx-trigger="confirmed"
              hx-target="body"
              title="Hold to archive"
            >
              <svg class="w-4 h-4 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                />
              </svg>
              <span class="label relative z-10">Archive Event</span>
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-9 xl:grid-cols-[1fr_350px] xl:items-start">
          <div class="space-y-2">
            <div class="px-5 pt-0 pb-2 -mt-2">
              <h3 class="text-title-3 text-gray-900 dark:text-zinc-100">Flavors</h3>
              <p class="text-callout text-gray-900 dark:text-zinc-100 mt-1">
                {items.length === 0
                  ? 'No flavors added to this event yet.'
                  : `${items.length} flavor${items.length === 1 ? '' : 's'} on this event.`}
              </p>
            </div>

            {/* Items table */}
            <div class="px-5 pb-4 w-full">
              {items.length === 0 ? (
                <div class="text-center py-12 text-gray-400 dark:text-zinc-500">
                  <div>No flavors added to this event yet.</div>
                  <button
                    type="button"
                    onclick="mscOpenAddFlavor()"
                    class="mt-4 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-button text-pink-600 transition-colors hover:bg-pink-50 hover:text-pink-700 dark:text-pink-400 dark:hover:bg-pink-950/30 dark:hover:text-pink-300"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                    </svg>
                    Add Flavor
                  </button>
                </div>
              ) : (
                <table class="data-table">
                  <colgroup>
                    <col style="width:24px" />
                    <col style="width:260px" />
                    <col />
                    <col style="width:260px" />
                    <col style="width:80px" />
                    <col style="width:96px" />
                    <col style="width:96px" />
                    <col style="width:96px" />
                    <col style="width:96px" />
                    <col style="width:100px" />
                  </colgroup>
                  <thead>
                    <tr class="bg-gray-50 dark:bg-[#171717] [&>th:first-child]:shadow-[-20px_0_0_#f9fafb] dark:[&>th:first-child]:shadow-[-20px_0_0_#171717] [&>th:last-child]:shadow-[20px_0_0_#f9fafb] dark:[&>th:last-child]:shadow-[20px_0_0_#171717]">
                      <th class="w-6 text-center" style="padding-left:0;padding-right:0">#</th>
                      <th style="width:260px">Flavor</th>
                      <th style="width:100%"></th>
                      <th class="text-center" style="width:260px">Rate</th>
                      <th class="text-center" style="width:80px">Prepared</th>
                      <th class="text-center" style="width:96px">Unsold</th>
                      <th class="text-right" style="width:96px">Revenue</th>
                      <th class="text-right" style="width:96px">COGS</th>
                      <th class="text-right" style="width:96px">Profit</th>
                      <th class="text-center" style="width:100px">Actions</th>
                    </tr>
                  </thead>
                  <tbody id="event-items-tbody">
                    {items.map((it) => (
                      <EventItemRow it={it} flavors={flavors} prices={_prices} />
                    ))}

                    {/* Totals row */}
                    <tr class="totals-row border-t-2 border-gray-200 dark:border-[#262626] bg-gray-50 dark:bg-[#171717] [&>td:first-child]:shadow-[-20px_0_0_#f9fafb] dark:[&>td:first-child]:shadow-[-20px_0_0_#171717] [&>td:last-child]:shadow-[20px_0_0_#f9fafb] dark:[&>td:last-child]:shadow-[20px_0_0_#171717]">
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
                          {totalRemaining}
                        </span>
                      </td>
                      <td>
                        <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-callout text-right text-gray-900 dark:text-zinc-100">
                          {formatCurrency(totalRevenue)}
                        </span>
                      </td>
                      <td>
                        <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-callout text-right text-gray-900 dark:text-zinc-100">
                          {formatCurrency(totalCogs)}
                        </span>
                      </td>
                      <td>
                        <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-right">
                          {totalProfit >= 0 ? (
                            <span class="text-green-600 dark:text-green-400 text-callout">{formatCurrency(totalProfit)}</span>
                          ) : (
                            <span class="text-red-500 dark:text-red-400 text-callout">{formatCurrency(totalProfit)}</span>
                          )}
                        </span>
                      </td>
                      <td>
                        <div class="px-4 py-3 min-h-[44px] flex items-center justify-center">
                          <button
                            type="button"
                            onclick="mscOpenAddFlavor()"
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
            </div>

            {/* Past Events */}
            <div class="rounded-3xl">
              <div class="px-5 pt-6 pb-2">
                <h3 class="text-title-3 text-gray-900 dark:text-zinc-100">Past Events</h3>
                <p class="text-callout text-gray-900 dark:text-zinc-100 mt-1">
                  {pastEvents.length === 0
                    ? `No prior events for ${event.name}.`
                    : `${pastEvents.length} past event${pastEvents.length === 1 ? '' : 's'} for ${event.name}.`}
                </p>
              </div>

              {pastEvents.length > 0 && (
                <div class="px-5 pb-4">
                  <table class="data-table">
                    <colgroup>
                      <col style="width:24px" />
                      <col style="width:260px" />
                      <col />
                      <col style="width:80px" />
                      <col style="width:96px" />
                      <col style="width:96px" />
                      <col style="width:96px" />
                      <col style="width:96px" />
                    </colgroup>
                    <thead>
                      <tr class="bg-gray-50 dark:bg-[#171717] [&>th:first-child]:shadow-[-20px_0_0_#f9fafb] dark:[&>th:first-child]:shadow-[-20px_0_0_#171717] [&>th:last-child]:shadow-[20px_0_0_#f9fafb] dark:[&>th:last-child]:shadow-[20px_0_0_#171717]">
                        <th class="w-6 text-center" style="padding-left:0;padding-right:0">#</th>
                        <th style="width:260px">Date</th>
                        <th style="width:100%"></th>
                        <th class="text-center" style="width:80px">Prepared</th>
                        <th class="text-center" style="width:96px">Unsold</th>
                        <th class="text-right" style="width:96px">Revenue</th>
                        <th class="text-right" style="width:96px">COGS</th>
                        <th class="text-right" style="width:96px">Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pastEvents.map((e) => {
                        const remaining = Math.max(0, e.totalPrepared - e.totalSold - (e.totalGiveaway || 0))
                        const d = dateFull(e.eventDate)
                        return (
                          <tr
                            class="group cursor-pointer hover:bg-[#fafafa] dark:hover:bg-[#171717] transition-colors"
                            onclick={`window.location='/events/${e.id}'`}
                          >
                            <td>
                              <span class="py-3 min-h-[44px] flex items-center justify-center text-pink-600 dark:text-pink-400 text-callout">
                                {e.id}
                              </span>
                            </td>
                            <td>
                              <span class="px-4 py-3 min-h-[44px] flex items-center text-gray-600 dark:text-zinc-400 text-callout whitespace-nowrap">
                                <span class="text-callout text-gray-400 dark:text-zinc-500 mr-3">{d.weekday}</span>
                                <span>{d.rest}</span>
                              </span>
                            </td>
                            <td></td>
                            <td>
                              <span class="px-4 py-3 min-h-[44px] flex items-center justify-center text-gray-600 dark:text-zinc-400 text-callout">
                                {e.totalPrepared}
                              </span>
                            </td>
                            <td>
                              <span class="px-4 py-3 min-h-[44px] flex items-center justify-center text-gray-600 dark:text-zinc-400 text-callout">
                                {remaining}
                              </span>
                            </td>
                            <td>
                              <span class="px-4 py-3 min-h-[44px] flex items-center justify-end whitespace-nowrap">
                                {e.totalRevenue > 0 ? (
                                  <span class="text-gray-900 dark:text-zinc-100 text-callout">{formatCurrency(e.totalRevenue)}</span>
                                ) : (
                                  <span class="text-gray-300 dark:text-zinc-700 text-callout">--</span>
                                )}
                              </span>
                            </td>
                            <td>
                              <span class="px-4 py-3 min-h-[44px] flex items-center justify-end whitespace-nowrap">
                                {e.totalCost > 0 ? (
                                  <span class="text-gray-600 dark:text-zinc-400 text-callout">{formatCurrency(e.totalCost)}</span>
                                ) : (
                                  <span class="text-gray-300 dark:text-zinc-700 text-callout">--</span>
                                )}
                              </span>
                            </td>
                            <td>
                              <span class="px-4 py-3 min-h-[44px] flex items-center justify-end whitespace-nowrap">
                                {e.netProfit > 0 ? (
                                  <span class="text-green-600 dark:text-green-400 text-callout">{formatCurrency(e.netProfit)}</span>
                                ) : e.netProfit < 0 ? (
                                  <span class="text-red-500 dark:text-red-400 text-callout">{formatCurrency(e.netProfit)}</span>
                                ) : (
                                  <span class="text-gray-300 dark:text-zinc-700 text-callout">--</span>
                                )}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Right column: 350px */}
          <div class="space-y-4">
            <div class="relative h-[350px] w-[350px] max-w-full overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-[#262626] dark:bg-[#0a0a0a]">
              {event.location ? (
                <div class="absolute inset-0 flex items-center justify-center text-callout text-gray-400 dark:text-zinc-500 p-4 text-center">
                  {/* TODO: Apple MapKit JS — for now a static placeholder. */}
                  {event.location}
                </div>
              ) : (
                <div class="absolute inset-0 flex items-center justify-center text-callout text-gray-400 dark:text-zinc-500">
                  No location set
                </div>
              )}
            </div>
            <div class="px-1 pt-1 pb-0">
              <h3 class="text-headline text-gray-900 dark:text-zinc-100 mb-0.5">Location</h3>
              <div class="flex items-center gap-1.5 group/edit">
                <svg
                  class="text-gray-300 dark:text-zinc-700 group-hover/edit:text-gray-400 dark:group-hover/edit:text-zinc-500 shrink-0 transition-colors"
                  style="width:1em;height:1em"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                <input
                  name="location"
                  value={event.location ?? ''}
                  placeholder="Click to add address"
                  hx-patch={`/events/${event.id}`}
                  hx-trigger="change delay:500ms"
                  hx-swap="none"
                  hx-vals="js:{location: event.target.value}"
                  class="text-callout text-gray-900 dark:text-zinc-100 hover:text-pink-600 dark:hover:text-pink-400 hover:bg-gray-50 dark:hover:bg-[#171717] px-2 -ml-2 rounded transition-colors bg-transparent border-0 focus:ring-2 focus:ring-pink-500 w-full"
                />
              </div>
            </div>
            <div class="px-1 pt-1">
              <h3 class="text-headline text-gray-900 dark:text-zinc-100 mb-3">Event Info & Payments</h3>
              <div class="grid grid-cols-2 gap-x-6 gap-y-2 items-start">
                <div>
                  <div class="space-y-3">
                    <div class="flex flex-col gap-0.5">
                      <span class="text-headline text-gray-500 dark:text-zinc-400">Date</span>
                      <div class="flex items-center gap-1.5 group/edit">
                        <svg
                          class="text-gray-300 dark:text-zinc-700 group-hover/edit:text-gray-400 dark:group-hover/edit:text-zinc-500 shrink-0 transition-colors"
                          style="width:1em;height:1em"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                        <input
                          type="date"
                          name="eventDate"
                          value={event.eventDate.slice(0, 10)}
                          hx-patch={`/events/${event.id}`}
                          hx-trigger="change"
                          hx-swap="none"
                          hx-vals="js:{eventDate: event.target.value}"
                          class="text-headline text-gray-900 dark:text-zinc-100 hover:text-pink-600 dark:hover:text-pink-400 hover:bg-gray-50 dark:hover:bg-[#171717] px-2 -ml-2 rounded transition-colors bg-transparent border-0 focus:ring-2 focus:ring-pink-500"
                        />
                      </div>
                    </div>
                    <div class="flex flex-col gap-0.5">
                      <span class="text-headline text-gray-500 dark:text-zinc-400">Fee</span>
                      <div class="flex items-center gap-1.5 group/edit">
                        <svg
                          class="text-gray-300 dark:text-zinc-700 group-hover/edit:text-gray-400 dark:group-hover/edit:text-zinc-500 shrink-0 transition-colors"
                          style="width:1em;height:1em"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                        <input
                          type="number"
                          step="0.01"
                          name="eventCost"
                          value={String(event.eventCost ?? 0)}
                          hx-patch={`/events/${event.id}`}
                          hx-trigger="change delay:500ms"
                          hx-swap="none"
                          hx-vals="js:{eventCost: parseFloat(event.target.value)||0}"
                          class="text-callout text-gray-900 dark:text-zinc-100 hover:text-pink-600 dark:hover:text-pink-400 hover:bg-gray-50 dark:hover:bg-[#171717] px-2 -ml-2 rounded transition-colors bg-transparent border-0 focus:ring-2 focus:ring-pink-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <div class="space-y-3">
                    <div class="flex flex-col gap-0.5">
                      <span class="text-headline text-gray-500 dark:text-zinc-400">Cash</span>
                      <input
                        type="number"
                        step="0.01"
                        name="cashCollected"
                        value={String(event.cashCollected ?? 0)}
                        hx-patch={`/events/${event.id}`}
                        hx-trigger="change delay:500ms"
                        hx-swap="none"
                        hx-vals="js:{cashCollected: parseFloat(event.target.value)||0}"
                        class="text-callout text-gray-900 dark:text-zinc-100 hover:text-pink-600 dark:hover:text-pink-400 hover:bg-gray-50 dark:hover:bg-[#171717] px-2 -ml-2 rounded transition-colors bg-transparent border-0 focus:ring-2 focus:ring-pink-500"
                      />
                    </div>
                    <div class="flex flex-col gap-0.5">
                      <span class="text-headline text-gray-500 dark:text-zinc-400">Venmo</span>
                      <input
                        type="number"
                        step="0.01"
                        name="venmoCollected"
                        value={String(event.venmoCollected ?? 0)}
                        hx-patch={`/events/${event.id}`}
                        hx-trigger="change delay:500ms"
                        hx-swap="none"
                        hx-vals="js:{venmoCollected: parseFloat(event.target.value)||0}"
                        class="text-callout text-gray-900 dark:text-zinc-100 hover:text-pink-600 dark:hover:text-pink-400 hover:bg-gray-50 dark:hover:bg-[#171717] px-2 -ml-2 rounded transition-colors bg-transparent border-0 focus:ring-2 focus:ring-pink-500"
                      />
                    </div>
                    <div class="flex flex-col gap-0.5">
                      <span class="text-headline text-gray-500 dark:text-zinc-400">Other</span>
                      <input
                        type="number"
                        step="0.01"
                        name="otherCollected"
                        value={String(event.otherCollected ?? 0)}
                        hx-patch={`/events/${event.id}`}
                        hx-trigger="change delay:500ms"
                        hx-swap="none"
                        hx-vals="js:{otherCollected: parseFloat(event.target.value)||0}"
                        class="text-callout text-gray-900 dark:text-zinc-100 hover:text-pink-600 dark:hover:text-pink-400 hover:bg-gray-50 dark:hover:bg-[#171717] px-2 -ml-2 rounded transition-colors bg-transparent border-0 focus:ring-2 focus:ring-pink-500"
                      />
                    </div>
                    <div class="flex flex-col gap-0.5">
                      <span class="text-headline text-gray-500 dark:text-zinc-400">Total</span>
                      <span class="text-callout px-2 -ml-2 text-green-600 dark:text-green-400 flex items-center gap-1.5 whitespace-nowrap">
                        {formatCurrency(collectedTotal)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="px-1 py-5 delivery-detail-notes-editor">
              {/* TODO: Quill rich-text editor (web-b uses react-quill-new with bold/italic/underline). For now: plain textarea. */}
              <h3 class="text-headline text-gray-900 dark:text-zinc-100 mb-2">Notes</h3>
              <textarea
                name="notes"
                rows={6}
                placeholder="Add notes..."
                hx-patch={`/events/${event.id}`}
                hx-trigger="change delay:500ms"
                hx-swap="none"
                hx-vals="js:{notes: event.target.value}"
                class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#262626] bg-white dark:bg-[#0a0a0a] text-callout text-gray-900 dark:text-zinc-100 focus:ring-2 focus:ring-pink-500 focus:border-pink-500 resize-y min-h-[160px]"
              >
                {event.notes ?? ''}
              </textarea>
            </div>
          </div>
        </div>
      </div>

      {/* Add Flavor Modal */}
      <div id="add-flavor-modal" class="hidden fixed inset-0 z-50 items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50" onclick="mscCloseAddFlavor()"></div>
        <div
          class="relative bg-white dark:bg-[#0a0a0a] dark:border dark:border-[#262626] rounded-2xl shadow-2xl w-full max-w-md p-6"
          onclick="event.stopPropagation()"
        >
          <h3 class="text-title-3 text-gray-900 dark:text-zinc-100 mb-4">Add Flavor to Event</h3>
          <form
            id="add-flavor-form"
            hx-post="/event-items"
            hx-target="#event-items-tbody"
            hx-swap="beforeend"
            hx-on--after-request="if(event.detail.successful){mscCloseAddFlavor();window.location.reload();}"
          >
            <input type="hidden" name="eventId" value={String(event.id)} />
            <div class="mb-4">
              <label class="block text-button text-gray-700 dark:text-zinc-300 mb-1">Flavor</label>
              <select
                name="flavorId"
                required
                onchange="mscOnFlavorPick(this)"
                class="w-full px-3 py-2 border border-gray-300 dark:border-[#3f3f3f] dark:bg-[#0a0a0a] dark:text-zinc-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
              >
                <option value="">Choose a flavor...</option>
                {flavors
                  .filter((f) => f.isActive)
                  .map((f) => (
                    <option value={String(f.id)}>{f.name}</option>
                  ))}
              </select>
            </div>

            <div id="add-flavor-rate-wrap" class="mb-4 hidden">
              <label class="block text-button text-gray-700 dark:text-zinc-300 mb-1">Rate</label>
              <select
                id="add-flavor-rate"
                name="rateId"
                required
                class="w-full px-3 py-2 border border-gray-300 dark:border-[#3f3f3f] dark:bg-[#0a0a0a] dark:text-zinc-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
              >
                {_prices
                  .filter((p) => p.isActive)
                  .map((p) => (
                    <option value={String(p.id)} data-flavor-id={String(p.flavorId)} style="display:none">
                      {p.tierName} — ${p.price.toFixed(2)}
                      {p.cost != null ? ` / $${p.cost.toFixed(2)} cost` : ''}
                    </option>
                  ))}
              </select>
            </div>

            <div class="mb-6">
              <label class="block text-button text-gray-700 dark:text-zinc-300 mb-1">Prepared Qty</label>
              <input
                type="number"
                name="prepared"
                value="0"
                class="w-full px-3 py-2 border border-gray-300 dark:border-[#3f3f3f] dark:bg-[#0a0a0a] dark:text-zinc-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
              />
            </div>

            <div class="flex gap-3">
              <button
                type="button"
                onclick="mscCloseAddFlavor()"
                class="flex-1 px-4 py-2 text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] rounded-lg text-button transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="flex-1 px-4 py-2 bg-pink-500 text-white rounded-lg text-button hover:bg-pink-600 transition-colors"
              >
                Add Flavor
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  )
}
