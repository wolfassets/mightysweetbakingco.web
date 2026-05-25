/**
 * DeliveryDetail view — Hono JSX port of apps/web-b's React component.
 *
 * Visual parity: keeps the same Tailwind class strings, layout structure, and
 * conditional rendering as the web-b version. No React, no hooks, no
 * framer-motion (CSS handles the modest animations we keep).
 *
 * Interactivity is htmx-driven:
 *   - Inline field edits PATCH /deliveries/:id with `change delay:500ms`
 *   - Item prepared/unsold inputs PATCH /delivery-items/:id and swap the row
 *   - Add Flavor modal posts to /delivery-items and re-renders the table body
 *   - Remove item DELETEs and removes the row via outerHTML swap
 *   - Archive uses the shared HoldArchiveButton (delete soft = archive)
 *   - Invoice PDF is generated client-side via jsPDF loaded from CDN; fonts
 *     are imported from /static/fonts/*.js (copied from web-b/src/fonts/).
 *
 * Notes / Invoice notes: TODO Quill — currently plain <textarea>. The hooks
 * to wire Quill via CDN are in place, but parsing Quill HTML for the invoice
 * PDF would require additional work, so we keep textareas for now and the
 * jsPDF renderer treats the value as a plain-text fallback.
 */

import type { FC } from 'hono/jsx'
import { Layout } from './Layout.js'
import { HoldArchiveButton } from './components.js'
import { usd, isoDate, dateLong } from '../lib/format.js'
import type { Delivery } from './Deliveries.js'
import type { Flavor, FlavorPrice } from './Flavors.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DeliveryItem {
  id: number
  deliveryId: number
  flavorName: string
  prepared: number
  unsold: number | null
  unitPrice: number | null
  unitCost: number | null
  revenue: number
  cogs: number
  profit: number
  rateId: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (server-side renders — pure functions)
// ─────────────────────────────────────────────────────────────────────────────

function formatDateFullParts(dateString: string | null | undefined): { weekday: string; rest: string } | null {
  if (!dateString) return null
  const d = new Date(dateString + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
  const rest = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  return { weekday, rest }
}

function getFlavorId(flavorName: string, flavors: Flavor[]): number {
  const f = flavors.find((x) => x.name === flavorName)
  return f ? f.id : 9999
}

function getExpirationStatus(expirationDate: string | null): { color: string } {
  if (!expirationDate) return { color: 'text-gray-500 dark:text-zinc-400' }
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const exp = new Date(expirationDate + 'T00:00:00')
  const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return { color: 'text-red-700 dark:text-red-400' }
  if (diffDays <= 2) return { color: 'text-orange-700 dark:text-orange-400' }
  return { color: 'text-green-700 dark:text-green-400' }
}

function plainNoteValue(value: string | null | undefined): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (trimmed === '<p></p>' || trimmed === '<p><br></p>') return ''
  return value
}

function getRatesForFlavor(flavorName: string, flavors: Flavor[], prices: FlavorPrice[]): FlavorPrice[] {
  const flavor = flavors.find((f) => f.name === flavorName)
  if (!flavor) return []
  return prices.filter((p) => p.flavorId === flavor.id)
}

function getSelectableRatesForItem(item: DeliveryItem, flavors: Flavor[], prices: FlavorPrice[]): FlavorPrice[] {
  return getRatesForFlavor(item.flavorName, flavors, prices).filter((r) => r.isActive || r.id === item.rateId)
}

function getMatchingRate(item: DeliveryItem, flavors: Flavor[], prices: FlavorPrice[]): string {
  if (item.rateId) {
    const m = prices.find((p) => p.id === item.rateId)
    if (m) return m.tierName
  }
  const rates = getRatesForFlavor(item.flavorName, flavors, prices)
  const match = rates.find((r) => r.price === item.unitPrice && r.cost === item.unitCost)
  return match ? match.tierName : 'Custom'
}

const normalizeStore = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const readMapKitToken = () => process.env.MAPKIT_TOKEN ?? process.env.NEXT_PUBLIC_MAPKIT_TOKEN ?? ''

type SuggestedDeliverySet = {
  delivery: Delivery
  items: DeliveryItem[]
  totalPrepared: number
}

function getSuggestedDeliverySets(
  delivery: Delivery,
  allDeliveries: Delivery[],
  allItems: DeliveryItem[],
): SuggestedDeliverySet[] {
  return allDeliveries
    .filter((d) => normalizeStore(d.storeName) === normalizeStore(delivery.storeName) && d.id !== delivery.id)
    .map((d) => {
      const setItems = allItems.filter((i) => i.deliveryId === d.id)
      return {
        delivery: d,
        items: setItems,
        totalPrepared: setItems.reduce((sum, item) => sum + item.prepared, 0),
      }
    })
    .filter((set) => set.items.length > 0)
    .sort((a, b) => {
      const aDate = new Date((a.delivery.dropoffDate || a.delivery.datePrepared) + 'T00:00:00').getTime()
      const bDate = new Date((b.delivery.dropoffDate || b.delivery.datePrepared) + 'T00:00:00').getTime()
      return bDate - aDate
    })
    .slice(0, 3)
}

const mapKitLoaderScript = (token: string) => `
(function(w){
  if (w.__mscLoadMapKit) return;
  var SCRIPT_ID = 'apple-mapkit-js';
  var TOKEN = ${JSON.stringify(token)};
  var loadPromise = null;
  w.__mscLoadMapKit = function(){
    if (typeof w === 'undefined') return Promise.resolve();
    if (!TOKEN) return Promise.reject(new Error('MapKit token missing'));
    if (w.mapkit && w.mapkit.Coordinate) return Promise.resolve();
    if (loadPromise) return loadPromise;
    loadPromise = new Promise(function(resolve, reject){
      var existing = document.getElementById(SCRIPT_ID);
      if (existing) {
        if (w.mapkit) {
          try { w.mapkit.init({ authorizationCallback: function(done){ done(TOKEN); } }); } catch(e){}
          resolve();
        }
        existing.addEventListener('load', function(){
          if (w.mapkit) {
            w.mapkit.init({ authorizationCallback: function(done){ done(TOKEN); } });
          }
          resolve();
        }, { once: true });
        existing.addEventListener('error', function(){ reject(new Error('MapKit load failed')); }, { once: true });
        return;
      }
      var s = document.createElement('script');
      s.id = SCRIPT_ID;
      s.src = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js';
      s.crossOrigin = 'anonymous';
      s.onload = function(){
        if (!w.mapkit) { reject(new Error('MapKit failed to attach')); return; }
        try { w.mapkit.init({ authorizationCallback: function(done){ done(TOKEN); } }); } catch(e){}
        resolve();
      };
      s.onerror = function(){ reject(new Error('MapKit load failed')); };
      document.head.appendChild(s);
    });
    return loadPromise;
  };
})(window);
`

const DELIVERY_MAP_SCRIPT = (location: string, label: string, dateLabel: string) => `
(function(){
  var data = ${JSON.stringify({ location: location || '', label, dateLabel })};
  var loading = document.getElementById('delivery-map-loading');
  var container = document.getElementById('delivery-map-canvas');
  if (!container) return;
  if (!data.location) {
    if (loading) {
      loading.textContent = 'No location set';
      loading.style.opacity = '1';
    }
    return;
  }
  function init(){
    var scheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    var map = new window.mapkit.Map(container, {
      showsCompass: window.mapkit.FeatureVisibility.Adaptive,
      showsScale: window.mapkit.FeatureVisibility.Adaptive,
      colorScheme: scheme === 'dark' ? window.mapkit.Map.ColorSchemes.Dark : window.mapkit.Map.ColorSchemes.Light,
    });
    var geocoder = new window.mapkit.Geocoder();
    geocoder.lookup(data.location, function(err, res){
      if (err || !res || !res.results || !res.results.length) {
        if (loading) {
          loading.style.opacity = '1';
          loading.style.color = '#ef4444';
          loading.textContent = 'Could not geocode location';
        }
        return;
      }
      var raw = res.results[0].coordinate;
      var lat = Number(raw && raw.latitude);
      var lng = Number(raw && raw.longitude);
      if (!isFinite(lat) || !isFinite(lng)) {
        if (loading) {
          loading.style.opacity = '1';
          loading.style.color = '#ef4444';
          loading.textContent = 'Invalid location coordinates';
        }
        return;
      }
      var coord = new window.mapkit.Coordinate(lat, lng);
      var marker = new window.mapkit.MarkerAnnotation(coord, {
        title: data.label,
        subtitle: data.dateLabel,
        color: '#ec4899',
        glyphColor: '#ffffff',
      });
      try { map.addAnnotation(marker); } catch(e){}
      map.region = new window.mapkit.CoordinateRegion(coord, new window.mapkit.CoordinateSpan(0.35, 0.35));
      if (loading) loading.style.opacity = '0';
    });
  }
  function go(){
    if (!window.__mscLoadMapKit) {
      setTimeout(go, 50);
      return;
    }
    window.__mscLoadMapKit().then(function(){
      if (!window.mapkit || !window.mapkit.Coordinate) throw new Error('MapKit unavailable');
      init();
    }).catch(function(){
      if (loading) {
        loading.style.opacity = '1';
        loading.style.color = '#ef4444';
        loading.textContent = 'Map failed to load';
      }
    });
  }
  go();
})();
`

const DATE_INPUT_SYNC_SCRIPT = `
(function(){
  if (window.__mscSyncDeliveryDate) return;
  function pad(v){
    return String(v).padStart(2, '0');
  }
  function toIso(s){
    var raw = String(s || '').trim();
    if (!raw) return '';
    var v = raw.replace(/,/g, ' ').replace(/\\s+/g, ' ').trim();
    var m1 = /^([A-Za-z]{3,9})\\s+(\\d{1,2})\\s+(\\d{4})$/.exec(v);
    if (m1) {
      var months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      var idx = months.indexOf(m1[1].slice(0,3).toLowerCase());
      if (idx >= 0) {
        var d = Number(m1[2]);
        if (d >= 1 && d <= 31) {
          return m1[3] + '-' + pad(idx + 1) + '-' + pad(d);
        }
      }
    }
    if (/^\\d{4}-\\d{2}-\\d{2}$/.test(v)) return v;
    var parsed = new Date(v);
    if (isNaN(parsed.getTime())) return '';
    return parsed.getFullYear() + '-' + pad(parsed.getMonth() + 1) + '-' + pad(parsed.getDate());
  }
  window.__mscSyncDeliveryDate = function(input, hiddenId){
    var hidden = document.getElementById(hiddenId);
    if (!hidden) return;
    hidden.value = toIso(input.value);
  };
  window.__mscOpenDeliveryDatePicker = function(dateId){
    var input = document.getElementById(dateId);
    if (!input) return;
    if (typeof input.showPicker === 'function') input.showPicker();
    else input.click();
  };
  window.__mscSyncDeliveryDateDisplay = function(input, displayId){
    var display = document.getElementById(displayId);
    if (!display) return;
    if (!input.value) {
      display.value = '';
      return;
    }
    var parsed = new Date(input.value + 'T00:00:00');
    if (isNaN(parsed.getTime())) {
      display.value = input.value;
      return;
    }
    display.value = parsed.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  };
  window.__mscFocusDeliveryField = function(row){
    var input = row && row.querySelector('input:not([type="hidden"])');
    if (!input) return;
    if (input.type === 'date' && typeof input.showPicker === 'function') input.showPicker();
    else if (input.dataset && input.dataset.datePickerId) window.__mscOpenDeliveryDatePicker(input.dataset.datePickerId);
    else {
      input.focus();
      if (typeof input.select === 'function') input.select();
    }
  };
})();
`

const MONEY_INPUT_SYNC_SCRIPT = `
(function(){
  if (window.__mscSyncDeliveryMoney) return;
  function toNumber(value){
    var raw = String(value || '').replace(/[$,]/g, '').trim();
    if (!raw) return 0;
    var parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function formatMoney(value){
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }
  window.__mscSyncDeliveryMoney = function(input, hiddenId){
    var hidden = document.getElementById(hiddenId);
    if (!hidden) return;
    var value = toNumber(input.value);
    hidden.value = value.toFixed(2);
    input.value = formatMoney(value);
  };
})();
`

// ─────────────────────────────────────────────────────────────────────────────
// FormatDateFull — date with weekday in mono pink
// ─────────────────────────────────────────────────────────────────────────────

const FormatDateFull: FC<{ dateString: string | null | undefined }> = ({ dateString }) => {
  const parts = formatDateFullParts(dateString)
  if (!parts) return <span class="text-gray-300 dark:text-zinc-700">--</span>
  return (
    <>
      <span class="text-callout text-gray-400 dark:text-zinc-500 mr-3">{parts.weekday}</span>
      <span>{parts.rest}</span>
    </>
  )
}

const FormatDetailDate: FC<{ dateString: string | null | undefined }> = ({ dateString }) => {
  const parts = formatDateFullParts(dateString)
  if (!parts) return <span class="text-gray-300 dark:text-zinc-700">--</span>
  return (
    <span class="inline-flex items-center gap-2">
      <span class="text-callout text-gray-400 dark:text-zinc-500">{parts.weekday}</span>
      <span class="text-callout">{parts.rest}</span>
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DeliveryItemRow — one row in the items table
//
// Inline-edit prepared/unsold via hx-patch returning the recomputed row.
// Rate select fires its own PATCH (using js: hx-vals to pull unitPrice/cost
// from the option's data attributes).
// ─────────────────────────────────────────────────────────────────────────────

export const DeliveryItemRow: FC<{
  it: DeliveryItem
  delivery?: Delivery
  flavors?: Flavor[]
  prices?: FlavorPrice[]
}> = ({ it, flavors = [], prices = [] }) => {
  const flavorId = getFlavorId(it.flavorName, flavors)
  const matchingRate = getMatchingRate(it, flavors, prices)
  const selectable = getSelectableRatesForItem(it, flavors, prices)
  return (
    <tr id={`delivery-item-${it.id}`} class="group">
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
            name="rateId"
            hx-patch={`/delivery-items/${it.id}/rate`}
            hx-trigger="change"
            hx-target={`#delivery-item-${it.id}`}
            hx-swap="outerHTML"
            class="w-56 text-callout border border-gray-200 dark:border-[#262626] rounded-lg px-2 py-1 bg-white dark:bg-[#0a0a0a] dark:text-zinc-300 focus:ring-2 focus:ring-pink-500 focus:border-pink-500 cursor-pointer"
          >
            {selectable.map((r) => (
              <option value={r.id} selected={r.tierName === matchingRate}>
                {r.tierName} — ${r.price.toFixed(2)}{r.cost != null ? ` / $${r.cost.toFixed(2)} cost` : ''}
              </option>
            ))}
            {matchingRate === 'Custom' && (
              <option value="" selected>Custom</option>
            )}
          </select>
        </div>
      </td>
      <td>
        <input
          type="number"
          min="0"
          value={it.prepared}
          name="prepared"
          hx-patch={`/delivery-items/${it.id}`}
          hx-trigger="change"
          hx-target={`#delivery-item-${it.id}`}
          hx-swap="outerHTML"
          hx-vals="js:{prepared: parseInt(event.target.value)||0}"
          class="w-full px-4 py-3 min-h-[44px] flex items-center justify-center text-gray-600 dark:text-zinc-400 text-callout text-center bg-transparent border-0 focus:ring-2 focus:ring-pink-500 rounded-lg"
        />
      </td>
      <td>
        <input
          type="number"
          min="0"
          value={it.unsold ?? 0}
          name="unsold"
          hx-patch={`/delivery-items/${it.id}`}
          hx-trigger="change"
          hx-target={`#delivery-item-${it.id}`}
          hx-swap="outerHTML"
          hx-vals="js:{unsold: parseInt(event.target.value)||0}"
          class="w-full px-4 py-3 min-h-[44px] flex items-center justify-center text-gray-600 dark:text-zinc-400 text-callout text-center bg-transparent border-0 focus:ring-2 focus:ring-pink-500 rounded-lg"
        />
      </td>
      <td>
        <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-gray-600 dark:text-zinc-400 text-callout text-right">
          {it.revenue > 0 ? usd(it.revenue) : '—'}
        </span>
      </td>
      <td>
        <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-callout text-right text-gray-600 dark:text-zinc-400">
          {it.cogs > 0 ? usd(it.cogs) : '—'}
        </span>
      </td>
      <td>
        <span class="px-4 py-3 min-h-[44px] flex items-center justify-end text-right">
          {it.profit > 0 ? (
            <span class="text-green-600 dark:text-green-400 text-callout">{usd(it.profit)}</span>
          ) : it.profit < 0 ? (
            <span class="text-red-500 dark:text-red-400 text-callout">{usd(it.profit)}</span>
          ) : (
            '—'
          )}
        </span>
      </td>
      <td>
        <div class="px-4 py-3 min-h-[44px] flex items-center justify-center">
          <HoldDeleteButton url={`/delivery-items/${it.id}`} target={`#delivery-item-${it.id}`} />
        </div>
      </td>
    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// HoldDeleteButton — vanilla-JS hold-to-confirm delete (port of web-b's React)
// ─────────────────────────────────────────────────────────────────────────────

const HOLD_DELETE_HANDLER = `(function(btn){
  if(btn.dataset.bound)return; btn.dataset.bound='1';
  var interval=null, ready=false, progress=0;
  function paint(){
    btn.style.background = progress>0
      ? 'linear-gradient(90deg, rgba(239,68,68,'+(0.3+progress*0.7)+') '+(progress*100)+'%, #fef2f2 '+(progress*100)+'%)'
      : '#fef2f2';
    btn.style.color = progress>0.5 ? 'white' : '#ef4444';
    btn.style.border = '1px solid '+(progress>0 ? 'rgba(239,68,68,'+(0.3+progress*0.7)+')' : '#fecaca');
    btn.textContent = progress>0 ? (progress>=0.8 ? 'Release' : 'Hold...') : 'Delete';
  }
  function start(){
    ready=false; progress=0; var t=Date.now();
    interval=setInterval(function(){
      progress=Math.min((Date.now()-t)/800,1);
      if(progress>=1){clearInterval(interval);interval=null;ready=true;}
      paint();
    },16);
  }
  function release(){
    if(interval){clearInterval(interval);interval=null;}
    if(ready){htmx.trigger(btn,'confirmdelete');}
    progress=0; ready=false; paint();
  }
  function cancel(){
    if(interval){clearInterval(interval);interval=null;}
    progress=0; ready=false; paint();
  }
  btn.addEventListener('mousedown',start);
  btn.addEventListener('mouseup',release);
  btn.addEventListener('mouseleave',cancel);
  btn.addEventListener('touchstart',function(e){e.preventDefault();start();});
  btn.addEventListener('touchend',function(e){e.preventDefault();release();});
})(this)`

const HoldDeleteButton: FC<{ url: string; target: string }> = ({ url, target }) => (
  <button
    type="button"
    onmouseover={HOLD_DELETE_HANDLER}
    class="relative overflow-hidden rounded-full w-20 py-1 text-button transition-all select-none text-center"
    style="background: #fef2f2; color: #ef4444; border: 1px solid #fecaca;"
    hx-delete={url}
    hx-trigger="confirmdelete"
    hx-target={target}
    hx-swap="outerHTML swap:200ms"
    title="Hold to delete"
  >
    Delete
  </button>
)

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar — top bar with back link, store name (editable), Download Invoice,
// Archive
// ─────────────────────────────────────────────────────────────────────────────

const Toolbar: FC<{ delivery: Delivery }> = ({ delivery }) => (
  <div class="flex items-center gap-6">
    <a
      href="/deliveries"
      class="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 dark:bg-zinc-100 px-4 py-2 text-button text-white dark:text-zinc-900 transition-colors hover:bg-gray-800 dark:hover:bg-zinc-200"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      Back to Deliveries
    </a>
    <div class="flex-1 min-w-0 flex justify-center">
      <form
        hx-patch={`/deliveries/${delivery.id}`}
        hx-trigger="change delay:300ms from:find input"
        hx-swap="none"
        class="inline-flex items-center gap-1 group/edit px-0 py-0"
      >
        <input
          type="text"
          name="storeName"
          value={delivery.storeName}
          class="text-title-2 text-gray-900 dark:text-zinc-100 bg-transparent border-0 focus:ring-2 focus:ring-pink-500 rounded-lg px-0 text-right w-auto"
          style={`width: ${Math.max(delivery.storeName.trim().length, 8)}ch;`}
        />
        <svg
          class="text-black dark:text-zinc-100 shrink-0"
          style="width: 0.9em; height: 0.9em;"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      </form>
    </div>
    <div class="shrink-0 w-[350px] grid grid-cols-2 gap-2">
      <button
        type="button"
        onclick={`window.mscDownloadInvoice(${delivery.id})`}
        class="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-pink-500 px-3 py-2 text-button text-white transition-colors hover:bg-pink-600 whitespace-nowrap"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Download Invoice
      </button>
      <HoldArchiveButton
        url={`/deliveries/${delivery.id}`}
        target="body"
        class="relative overflow-hidden w-full inline-flex items-center justify-center rounded-xl bg-red-500 px-3 py-2 text-button text-white transition-colors hover:bg-red-600 whitespace-nowrap select-none"
      />
    </div>
  </div>
)

// ─────────────────────────────────────────────────────────────────────────────
// Items table
// ─────────────────────────────────────────────────────────────────────────────

const ItemsTable: FC<{
  delivery: Delivery
  items: DeliveryItem[]
  flavors: Flavor[]
  prices: FlavorPrice[]
  suggestions?: SuggestedDeliverySet[]
}> = ({ delivery, items, flavors, prices, suggestions = [] }) => {
  if (items.length === 0) {
    return (
      <div class="py-8 text-gray-400 dark:text-zinc-500">
        <div class="text-center">No flavors added to this delivery yet.</div>
        {suggestions.length > 0 && (
          <div class="mx-auto mt-5 max-w-3xl text-left">
            <div class="mb-2 px-1 text-headline text-gray-900 dark:text-zinc-100">Suggested sets</div>
            <div class="grid gap-2 md:grid-cols-3">
              {suggestions.map((set) => {
                const preview = set.items
                  .slice(0, 4)
                  .map((item) => `${item.prepared}x ${item.flavorName}`)
                  .join(', ')
                const extra = set.items.length > 4 ? ` +${set.items.length - 4} more` : ''
                return (
                  <form
                    hx-post="/delivery-items/suggested-set"
                    hx-target="#delivery-items"
                    hx-swap="outerHTML"
                    class="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm transition-colors hover:border-pink-200 hover:bg-pink-50/40 dark:border-[#262626] dark:bg-[#0a0a0a] dark:hover:border-pink-900/50 dark:hover:bg-pink-950/10"
                  >
                    <input type="hidden" name="deliveryId" value={delivery.id} />
                    <input type="hidden" name="sourceDeliveryId" value={set.delivery.id} />
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <div class="text-callout text-gray-900 dark:text-zinc-100">
                          {dateLong(set.delivery.dropoffDate ?? set.delivery.datePrepared)}
                        </div>
                        <div class="mt-0.5 text-caption-1 text-gray-500 dark:text-zinc-400">
                          {set.items.length} flavor{set.items.length === 1 ? '' : 's'} | {set.totalPrepared} prepared
                        </div>
                      </div>
                      <button
                        type="submit"
                        class="shrink-0 rounded-full bg-pink-500 px-3 py-1 text-button text-white transition-colors hover:bg-pink-600"
                      >
                        Use
                      </button>
                    </div>
                    <div class="mt-2 line-clamp-2 text-caption-1 leading-5 text-gray-600 dark:text-zinc-400">
                      {preview}{extra}
                    </div>
                  </form>
                )
              })}
            </div>
          </div>
        )}
        <div class="text-center">
          <button
            type="button"
            onclick="document.getElementById('add-flavor-modal').classList.remove('hidden')"
            class="mt-4 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-button text-pink-600 transition-colors hover:bg-pink-50 hover:text-pink-700 dark:text-pink-400 dark:hover:bg-pink-950/30 dark:hover:text-pink-300"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add Flavor
          </button>
        </div>
      </div>
    )
  }

  const totalPrepared = items.reduce((s, i) => s + i.prepared, 0)
  const totalUnsold = items.reduce((s, i) => s + (i.unsold ?? 0), 0)
  const totalRevenue = items.reduce((s, i) => s + i.revenue, 0)
  const totalCogs = items.reduce((s, i) => s + i.cogs, 0)
  const totalProfit = items.reduce((s, i) => s + i.profit, 0)

  return (
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
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Previous deliveries table
// ─────────────────────────────────────────────────────────────────────────────

const PreviousDeliveries: FC<{
  delivery: Delivery
  allDeliveries: Delivery[]
  allItems: DeliveryItem[]
}> = ({ delivery, allDeliveries, allItems }) => {
  const prev = allDeliveries
    .filter((d) => normalizeStore(d.storeName) === normalizeStore(delivery.storeName) && d.id !== delivery.id)
    .sort((a, b) => {
      const aDate = new Date((a.dropoffDate || a.datePrepared) + 'T00:00:00').getTime()
      const bDate = new Date((b.dropoffDate || b.datePrepared) + 'T00:00:00').getTime()
      return bDate - aDate
    })

  return (
    <div class="rounded-3xl">
      <div class="px-5 pt-6 pb-2">
        <h3 class="text-title-3 text-gray-900 dark:text-zinc-100">Previous Deliveries</h3>
        <p class="text-callout text-gray-900 dark:text-zinc-100 mt-1">
          {prev.length === 0
            ? `No prior deliveries to ${delivery.storeName}.`
            : `${prev.length} previous deliver${prev.length === 1 ? 'y' : 'ies'} to ${delivery.storeName}.`}
        </p>
      </div>
      {prev.length > 0 && (
        <div class="px-5 pb-4">
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
                <th style="width: 260px;">Dropoff</th>
                <th style="width: 100%;"></th>
                <th style="width: 260px;">Date Prepared</th>
                <th class="text-center" style="width: 80px;">Prepared</th>
                <th class="text-center" style="width: 96px;">Unsold</th>
                <th class="text-right" style="width: 96px;">Revenue</th>
                <th class="text-right" style="width: 96px;">COGS</th>
                <th class="text-right" style="width: 96px;">Profit</th>
                <th class="text-center" style="width: 100px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              {prev.map((d) => {
                const unsoldTotal = allItems.filter((i) => i.deliveryId === d.id).reduce((s, i) => s + (i.unsold ?? 0), 0)
                return (
                  <tr class="group cursor-pointer hover:bg-[#fafafa] dark:hover:bg-[#171717] transition-colors" onclick={`location.href='/deliveries/${d.id}'`}>
                    <td>
                      <span class="py-3 min-h-[44px] flex items-center justify-center text-pink-600 dark:text-pink-400 text-callout">{d.id}</span>
                    </td>
                    <td>
                      <span class="px-4 py-3 min-h-[44px] flex items-center text-gray-600 dark:text-zinc-400 text-callout whitespace-nowrap">
                        <FormatDateFull dateString={d.dropoffDate} />
                      </span>
                    </td>
                    <td></td>
                    <td>
                      <span class="px-4 py-3 min-h-[44px] flex items-center text-gray-600 dark:text-zinc-400 text-callout whitespace-nowrap">
                        <FormatDateFull dateString={d.datePrepared} />
                      </span>
                    </td>
                    <td>
                      <span class="px-4 py-3 min-h-[44px] flex items-center justify-center text-gray-600 dark:text-zinc-400 text-callout">{d.totalPrepared}</span>
                    </td>
                    <td>
                      <span class="px-4 py-3 min-h-[44px] flex items-center justify-center text-gray-600 dark:text-zinc-400 text-callout">{unsoldTotal}</span>
                    </td>
                    <td>
                      <span class="px-4 py-3 min-h-[44px] flex items-center justify-end whitespace-nowrap">
                        {d.totalRevenue > 0 ? (
                          <span class="text-gray-900 dark:text-zinc-100 text-callout">{usd(d.totalRevenue)}</span>
                        ) : (
                          <span class="text-gray-300 dark:text-zinc-700 text-callout">--</span>
                        )}
                      </span>
                    </td>
                    <td>
                      <span class="px-4 py-3 min-h-[44px] flex items-center justify-end whitespace-nowrap">
                        {d.totalCogs > 0 ? (
                          <span class="text-gray-600 dark:text-zinc-400 text-callout">{usd(d.totalCogs)}</span>
                        ) : (
                          <span class="text-gray-300 dark:text-zinc-700 text-callout">--</span>
                        )}
                      </span>
                    </td>
                    <td>
                      <span class="px-4 py-3 min-h-[44px] flex items-center justify-end whitespace-nowrap">
                        {d.grossProfit > 0 ? (
                          <span class="text-green-600 dark:text-green-400 text-callout">{usd(d.grossProfit)}</span>
                        ) : d.grossProfit < 0 ? (
                          <span class="text-red-500 dark:text-red-400 text-callout">{usd(d.grossProfit)}</span>
                        ) : (
                          <span class="text-gray-300 dark:text-zinc-700 text-callout">--</span>
                        )}
                      </span>
                    </td>
                    <td>
                      <div class="px-4 py-3 min-h-[44px] flex items-center justify-center">
                        <button
                          type="button"
                          onclick={`event.stopPropagation();window.mscDownloadInvoice(${d.id})`}
                          class="rounded-full w-24 py-1 text-button transition-all select-none text-center whitespace-nowrap bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 hover:text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/50 dark:hover:bg-blue-950/60 dark:hover:text-blue-300"
                        >
                          Invoice
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Add-Flavor Modal — open via [onclick] on the Add Flavor buttons, close via
// the cancel button. Form POSTs to /delivery-items.
// ─────────────────────────────────────────────────────────────────────────────

const AddFlavorModal: FC<{ delivery: Delivery; flavors: Flavor[]; prices: FlavorPrice[] }> = ({ delivery, flavors, prices }) => {
  // Build a JS map from flavorId -> rates JSON so the in-page select can update
  const ratesMap = flavors
    .filter((f) => f.isActive)
    .reduce<Record<number, FlavorPrice[]>>((acc, f) => {
      acc[f.id] = prices.filter((p) => p.flavorId === f.id && p.isActive)
      return acc
    }, {})
  const ratesJson = JSON.stringify(ratesMap)
  return (
    <div id="add-flavor-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        class="absolute inset-0 bg-black/50"
        onclick="document.getElementById('add-flavor-modal').classList.add('hidden')"
      ></div>
      <div class="relative bg-white dark:bg-[#0a0a0a] dark:border dark:border-[#262626] rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h3 class="text-title-3 text-gray-900 dark:text-zinc-100 mb-4">Add Flavor to Delivery</h3>
        <form
          id="add-flavor-form"
          hx-post="/delivery-items"
          hx-target="#delivery-items"
          hx-swap="outerHTML"
          hx-on--after-request="if(event.detail.successful){this.reset();document.getElementById('add-flavor-modal').classList.add('hidden')}"
        >
          <input type="hidden" name="deliveryId" value={delivery.id} />
          <div class="mb-4">
            <label class="block text-callout text-gray-700 dark:text-zinc-300 mb-1">Select Flavor</label>
            <select
              name="flavorId"
              required
              class="w-full px-3 py-2 border border-gray-300 dark:border-[#3f3f3f] dark:bg-[#0a0a0a] dark:text-zinc-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
              onchange={`(function(sel){
                var rates = window.__rateMap[sel.value] || [];
                var rateSel = document.getElementById('add-flavor-rate');
                rateSel.innerHTML = rates.length===0
                  ? '<option value="">No active rates</option>'
                  : '<option value="">Choose a rate...</option>' + rates.map(function(r){
                      return '<option value="'+r.id+'">'+r.tierName+' — $'+r.price.toFixed(2)+(r.cost!=null?' / $'+r.cost.toFixed(2)+' cost':'')+'</option>';
                    }).join('');
              })(this)`}
            >
              <option value="">Choose a flavor...</option>
              {flavors
                .filter((f) => f.isActive)
                .map((f) => (
                  <option value={f.id}>{f.name}</option>
                ))}
            </select>
          </div>
          <div class="mb-4">
            <label class="block text-callout text-gray-700 dark:text-zinc-300 mb-1">Rate</label>
            <select
              id="add-flavor-rate"
              name="rateId"
              required
              class="w-full px-3 py-2 border border-gray-300 dark:border-[#3f3f3f] dark:bg-[#0a0a0a] dark:text-zinc-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
            >
              <option value="">Choose a flavor first...</option>
            </select>
          </div>
          <div class="mb-6">
            <label class="block text-callout text-gray-700 dark:text-zinc-300 mb-1">Prepared Qty</label>
            <input
              type="number"
              name="prepared"
              value="0"
              min="0"
              class="w-full px-3 py-2 border border-gray-300 dark:border-[#3f3f3f] dark:bg-[#0a0a0a] dark:text-zinc-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
            />
          </div>
          <div class="flex gap-3">
            <button
              type="button"
              onclick="document.getElementById('add-flavor-modal').classList.add('hidden')"
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
        <script dangerouslySetInnerHTML={{ __html: `window.__rateMap = ${ratesJson};` }} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoice PDF download — client-side jsPDF
//
// Loads jsPDF from CDN on first invocation, then dynamic-imports the bundled
// font modules from /static/fonts/*.js. Renders the same invoice layout as
// web-b's handleDownloadInvoice (Stripe-style header, items, totals, footer).
//
// Quill HTML parsing for invoice notes is simplified to plain text since the
// editor surface is currently a <textarea>. If Quill is later wired in, replace
// the simple textContent path with the same DOM walker the React version uses.
// ─────────────────────────────────────────────────────────────────────────────

const INVOICE_SCRIPT = `
window.mscDownloadInvoice = async function(deliveryId){
  try {
    if (!window.jspdf) {
      await new Promise(function(resolve, reject){
        var s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js';
        s.onload = resolve;
        s.onerror = function(){ reject(new Error('jsPDF CDN failed')); };
        document.head.appendChild(s);
      });
    }
    var ft;
    try {
      ft = await Promise.all([
        import('/static/fonts/geist.js'),
        import('/static/fonts/bricolage-grotesque.js'),
      ]);
    } catch (e) {
      console.warn('Font modules unavailable, falling back to Helvetica:', e);
      ft = null;
    }
    var resp = await Promise.all([
      fetch('/deliveries/' + deliveryId + '/json').then(function(r){return r.json();}),
      fetch('/delivery-items/by-delivery/' + deliveryId + '.json').then(function(r){return r.json();}),
    ]);
    var delivery = resp[0];
    var items = resp[1];
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF();
    var hasGeist = false;
    if (ft) {
      try {
        var g = ft[0];
        var b = ft[1];
        doc.addFileToVFS('Geist-Regular.ttf', g.geistRegular);
        doc.addFont('Geist-Regular.ttf', 'Geist', 'normal');
        doc.addFileToVFS('Geist-Medium.ttf', g.geistMedium);
        doc.addFont('Geist-Medium.ttf', 'Geist', 'normal', 500);
        doc.addFileToVFS('Geist-SemiBold.ttf', g.geistSemiBold);
        doc.addFont('Geist-SemiBold.ttf', 'Geist', 'bold');
        doc.addFileToVFS('GeistMono-Regular.ttf', g.geistMonoRegular);
        doc.addFont('GeistMono-Regular.ttf', 'GeistMono', 'normal');
        hasGeist = true;
        var logo = b.mightySweetsLogo;
      } catch (err) {
        console.warn('Font load failed:', err);
      }
    }
    var formatCurrency = function(n){
      return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
    };
    var shortDate = function(d){
      var dd = new Date(d + 'T00:00:00');
      return dd.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
    };
    var trackPxToMm = function(px){ return px * (25.4 / 96); };
    var applyTypo = function(family, size, weight, trackingPx){
      var fontName = hasGeist ? (family === 'mono' ? 'GeistMono' : 'Geist') : 'helvetica';
      if (hasGeist) {
        if (weight === 'semibold') doc.setFont(fontName, 'bold');
        else if (weight === 'medium') doc.setFont(fontName, 'normal', 500);
        else doc.setFont(fontName, 'normal');
      } else {
        doc.setFont(fontName, weight === 'semibold' ? 'bold' : 'normal');
      }
      doc.setFontSize(size * 0.75);
      doc.setCharSpace(trackPxToMm(trackingPx));
    };

    applyTypo('sans', 32, 'semibold', -1.28);
    doc.setTextColor(30, 30, 30);
    doc.text('Invoice', 14, 20);

    if (hasGeist) {
      try {
        var logoW = 16;
        var logoH = logoW * (100/116);
        doc.addImage(logo, 'PNG', 196 - logoW, 10, logoW, logoH);
      } catch(e){}
    }

    doc.setTextColor(30,30,30);
    var metaLabelX = 14, metaValX2 = 50;
    applyTypo('sans', 16, 'semibold', -0.32);
    doc.text('Invoice number', metaLabelX, 35);
    applyTypo('mono', 14, 'regular', 0);
    doc.text(String(delivery.id), metaValX2, 35);
    applyTypo('sans', 14, 'regular', 0);
    doc.text('Date of issue', metaLabelX, 40);
    doc.text(shortDate(delivery.datePrepared), metaValX2, 40);
    doc.text('Date due', metaLabelX, 45);
    doc.text(delivery.dropoffDate ? shortDate(delivery.dropoffDate) : '—', metaValX2, 45);

    applyTypo('sans', 16, 'semibold', -0.32);
    doc.text('Mighty Sweet Baking Co.', 14, 55);
    applyTypo('sans', 14, 'regular', 0);
    doc.text('Niskayuna, NY 12309', 14, 60);
    doc.text('United States', 14, 65);
    doc.text('hello@mightysweetbakingco.com', 14, 70);

    var billToX = 90;
    applyTypo('sans', 16, 'semibold', -0.32);
    doc.text('Bill to', billToX, 55);
    applyTypo('sans', 14, 'regular', 0);
    doc.text(delivery.storeName, billToX, 60);
    doc.text('United States', billToX, 65);

    var subtotal = delivery.totalRevenue;
    var fees = delivery.additionalFees || 0;
    var disc = delivery.discount || 0;
    var invoiceTotal = subtotal + fees - disc;
    var amountDue = invoiceTotal - (delivery.prepaidAmount || 0);

    applyTypo('sans', 24, 'semibold', -0.96);
    doc.setTextColor(30,30,30);
    var dueDateStr = delivery.dropoffDate ? shortDate(delivery.dropoffDate) : '—';
    doc.text(formatCurrency(amountDue) + ' USD due ' + dueDateStr, 14, 85);

    var tableStartY = 100;
    applyTypo('sans', 12, 'semibold', -0.32);
    doc.setTextColor(30,30,30);
    var cols = ['Description', 'Qty', 'Unit price', 'Amount'];
    var colX = [14, 150, 173, 196];
    doc.text(cols[0], colX[0], tableStartY);
    doc.text(cols[1], colX[1], tableStartY, { align: 'right' });
    doc.text(cols[2], colX[2], tableStartY, { align: 'right' });
    doc.text(cols[3], colX[3], tableStartY, { align: 'right' });
    doc.setDrawColor(200,200,200);
    doc.setLineWidth(0.3);
    doc.line(14, tableStartY + 3, 196, tableStartY + 3);

    doc.setTextColor(60);
    var rowHeight = 7;
    var y = tableStartY + 9;
    items.forEach(function(item, idx){
      if (y > 270) { doc.addPage(); y = 20; }
      if (items.length >= 3 && idx % 2 === 0) {
        doc.setFillColor(245,245,245);
        doc.rect(14, y - 4.5, 182, rowHeight, 'F');
      }
      doc.setTextColor(60);
      applyTypo('sans', 14, 'regular', 0);
      doc.text(item.flavorName, colX[0], y);
      applyTypo('mono', 14, 'regular', 0);
      doc.text(String(item.prepared), colX[1], y, { align: 'right' });
      doc.text(item.unitPrice ? formatCurrency(item.unitPrice) : '—', colX[2], y, { align: 'right' });
      doc.text(formatCurrency(item.revenue), colX[3], y, { align: 'right' });
      y += rowHeight;
    });

    y += 3;
    doc.line(14, y - 5, 196, y - 5);
    doc.setTextColor(30,30,30);
    applyTypo('sans', 14, 'regular', 0);
    doc.text('Subtotal', colX[0], y);
    applyTypo('mono', 14, 'regular', 0);
    doc.text(formatCurrency(subtotal), colX[3], y, { align: 'right' });
    if (fees > 0) {
      y += rowHeight;
      applyTypo('sans', 14, 'regular', 0);
      doc.text('Additional fees', colX[0], y);
      applyTypo('mono', 14, 'regular', 0);
      doc.text(formatCurrency(fees), colX[3], y, { align: 'right' });
    }
    if (disc > 0) {
      y += rowHeight;
      applyTypo('sans', 14, 'regular', 0);
      doc.text('Discount', colX[0], y);
      applyTypo('mono', 14, 'regular', 0);
      doc.text('-' + formatCurrency(disc), colX[3], y, { align: 'right' });
    }
    y += rowHeight;
    applyTypo('sans', 14, 'regular', 0);
    doc.text('Total', colX[0], y);
    applyTypo('mono', 14, 'regular', 0);
    doc.text(formatCurrency(invoiceTotal), colX[3], y, { align: 'right' });
    if ((delivery.prepaidAmount || 0) > 0) {
      y += rowHeight;
      applyTypo('sans', 14, 'regular', 0);
      doc.text('Prepaid', colX[0], y);
      applyTypo('mono', 14, 'regular', 0);
      doc.text('-' + formatCurrency(delivery.prepaidAmount), colX[3], y, { align: 'right' });
    }
    y += rowHeight;
    doc.line(14, y - 5, 196, y - 5);
    applyTypo('sans', 16, 'semibold', -0.32);
    doc.text('Amount due', colX[0], y);
    applyTypo('mono', 14, 'regular', 0);
    doc.text(formatCurrency(amountDue), colX[3], y, { align: 'right' });

    y += 14;
    applyTypo('sans', 16, 'semibold', -0.32);
    doc.setTextColor(30,30,30);
    doc.text('Instructions', 14, y);
    var instrW = doc.getTextWidth('Instructions');
    doc.setDrawColor(30,30,30);
    doc.setLineWidth(0.4);
    doc.line(14, y + 1.2, 14 + instrW, y + 1.2);
    y += 7;

    applyTypo('sans', 14, 'regular', 0);
    doc.setTextColor(60);
    var prepDate = new Date(delivery.datePrepared + 'T00:00:00');
    var prepDay = prepDate.toLocaleDateString('en-US',{weekday:'long'});
    var prepFull = shortDate(delivery.datePrepared);
    var prepText = 'Prepared on ';
    var prepDateText = prepDay + ', ' + prepFull;
    doc.text(prepText, 14, y);
    var prepTextW = doc.getTextWidth(prepText);
    doc.setTextColor(236,72,153);
    applyTypo('mono', 14, 'regular', 0);
    doc.text(prepDateText, 14 + prepTextW, y);

    if (delivery.expirationDate) {
      y += 6;
      applyTypo('sans', 14, 'regular', 0);
      doc.setTextColor(60);
      var expDate = new Date(delivery.expirationDate + 'T00:00:00');
      var expDay = expDate.toLocaleDateString('en-US',{weekday:'long'});
      var expFull = shortDate(delivery.expirationDate);
      var expText = 'Best before ';
      var expDateText = expDay + ', ' + expFull;
      doc.text(expText, 14, y);
      var expTextW = doc.getTextWidth(expText);
      doc.setTextColor(236,72,153);
      applyTypo('mono', 14, 'regular', 0);
      doc.text(expDateText, 14 + expTextW, y);
    }

    if (
      delivery.invoiceNotes &&
      delivery.invoiceNotes.trim() &&
      delivery.invoiceNotes.trim() !== '<p></p>' &&
      delivery.invoiceNotes.trim() !== '<p><br></p>'
    ) {
      y += 14;
      applyTypo('sans', 16, 'semibold', -0.32);
      doc.setTextColor(30,30,30);
      doc.text('Additional notes', 14, y);
      var notesW = doc.getTextWidth('Additional notes');
      doc.setDrawColor(30,30,30);
      doc.setLineWidth(0.4);
      doc.line(14, y + 1.2, 14 + notesW, y + 1.2);
      y += 7;
      applyTypo('sans', 14, 'regular', 0);
      doc.setTextColor(60);
      // Strip HTML for textarea fallback; TODO: walk DOM tree for Quill content.
      var tmp = document.createElement('div');
      tmp.innerHTML = delivery.invoiceNotes;
      var noteText = (tmp.textContent || '').trim();
      var lines = doc.splitTextToSize(noteText, 182);
      doc.text(lines, 14, y, { maxWidth: 182 });
      y += lines.length * 5;
    }

    var pageH = doc.internal.pageSize.height;
    var pageW = doc.internal.pageSize.width;
    y = Math.max(y + 20, pageH - 18);
    applyTypo('sans', 12, 'regular', 0);
    doc.setTextColor(100);
    var seg1 = 'Made with ', seg2 = ' by ', seg3 = 'Mighty Sweet Baking Co.';
    var seg1W = doc.getTextWidth(seg1);
    var seg2W = doc.getTextWidth(seg2);
    var seg3W = doc.getTextWidth(seg3);
    var heartSize = 4;
    var totalW = seg1W + heartSize + seg2W + seg3W;
    var loveX = (pageW - totalW) / 2;
    doc.text(seg1, loveX, y);
    loveX += seg1W;
    var heartCanvas = document.createElement('canvas');
    heartCanvas.width = 128; heartCanvas.height = 128;
    var hctx = heartCanvas.getContext('2d');
    hctx.clearRect(0,0,128,128);
    hctx.font = '110px "Apple Color Emoji"';
    hctx.textBaseline = 'top';
    hctx.fillText('❤️', 8, 8);
    var heartDataUrl = heartCanvas.toDataURL('image/png');
    doc.addImage(heartDataUrl, 'PNG', loveX, y - 2.8, heartSize, heartSize);
    loveX += heartSize;
    doc.text(seg2, loveX, y);
    loveX += seg2W;
    doc.setTextColor(236,72,153);
    doc.text(seg3, loveX, y);
    doc.setDrawColor(236,72,153);
    doc.setLineWidth(0.3);
    doc.line(loveX, y + 1, loveX + seg3W, y + 1);

    var pdfBlob = doc.output('blob');
    var pdfFile = new File([pdfBlob], 'invoice_' + delivery.id + '.pdf', { type: 'application/pdf' });
    var pdfUrl = URL.createObjectURL(pdfFile);
    window.open(pdfUrl, '_blank');
  } catch (e) {
    console.error('Invoice generation failed:', e);
    alert('Failed to generate invoice: ' + (e && e.message ? e.message : e));
  }
};
`

// ─────────────────────────────────────────────────────────────────────────────
// Main page component
// ─────────────────────────────────────────────────────────────────────────────

export const DeliveryDetailPage: FC<{
  delivery: Delivery
  items: DeliveryItem[]
  flavors: Flavor[]
  prices: FlavorPrice[]
  allDeliveries?: Delivery[]
  allItems?: DeliveryItem[]
}> = ({ delivery, items, flavors, prices, allDeliveries = [], allItems = [] }) => {
  const totalCollected = (delivery.cashCollected || 0) + (delivery.venmoCollected || 0) + (delivery.otherCollected || 0)
  const expirationStatus = getExpirationStatus(delivery.expirationDate)
  const suggestedSets = items.length === 0 ? getSuggestedDeliverySets(delivery, allDeliveries, allItems) : []
  const detailLabelClass = 'text-headline text-gray-500 dark:text-zinc-400 leading-5'
  const detailEditableValueClass = 'flex h-7 items-center gap-px'
  const detailReadOnlyValueClass = 'flex h-7 w-full items-center px-0 text-left text-callout leading-5 whitespace-nowrap'
  const detailInputClass =
    'h-7 w-full text-left text-callout leading-5 text-gray-900 dark:text-zinc-100 hover:text-pink-600 dark:hover:text-pink-400 hover:bg-gray-50 dark:hover:bg-[#171717] px-2 py-0 rounded transition-colors bg-transparent border-0 focus:ring-2 focus:ring-pink-500'
  const pencilIcon = (
    <svg
      class="text-black dark:text-zinc-100 shrink-0"
      style="width: 0.9em; height: 0.9em;"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  )
  const field = (label: string, value: any) => (
    <div class="flex flex-col gap-0.5">
      <span class={detailLabelClass}>{label}</span>
      {value}
    </div>
  )
  const editableField = (label: string, value: any) =>
    field(
      label,
      <div class={detailEditableValueClass} onclick="__mscFocusDeliveryField(this)">
        {pencilIcon}
        {value}
      </div>,
    )
  const readOnlyField = (label: string, value: string, colorClass: string) =>
    field(label, <div class={`${detailReadOnlyValueClass} ${colorClass}`}>{value}</div>)
  const moneyField = (label: string, name: string, amount: number | null | undefined) => {
    const value = amount ?? 0
    const hiddenId = `delivery-money-${name}`
    return editableField(
      label,
      <>
        <input
          type="text"
          value={usd(value)}
          onchange={`__mscSyncDeliveryMoney(this, '${hiddenId}')`}
          class={detailInputClass}
        />
        <input type="hidden" id={hiddenId} name={name} value={value.toFixed(2)} />
      </>,
    )
  }
  const dateField = (label: string, name: string, dateValue: string | null | undefined) => {
    const iso = isoDate(dateValue)
    const dateId = `delivery-date-picker-${name}`
    const displayId = `delivery-date-display-${name}`
    return editableField(
      label,
      <>
        <input
          id={displayId}
          type="text"
          readonly
          value={dateLong(dateValue)}
          data-date-picker-id={dateId}
          onclick={`__mscOpenDeliveryDatePicker('${dateId}')`}
          class={`${detailInputClass} cursor-pointer`}
        />
        <input
          id={dateId}
          type="date"
          name={name}
          value={iso}
          onchange={`__mscSyncDeliveryDateDisplay(this, '${displayId}')`}
          class="sr-only"
          tabIndex={-1}
        />
      </>,
    )
  }

  return (
    <Layout title={delivery.storeName.trim()} active="deliveries">
      <div class="space-y-6">
        <Toolbar delivery={delivery} />

        <div class="grid grid-cols-1 gap-9 xl:grid-cols-[1fr_350px] xl:items-start">
          <div class="space-y-2">
            <div class="flex gap-6">
              <div class="flex-[3]">
                <div class="rounded-3xl">
                  <div class="px-5 pt-0 pb-2 -mt-2">
                    <h3 class="text-title-3 text-gray-900 dark:text-zinc-100">Flavors</h3>
                    <p class="text-callout text-gray-900 dark:text-zinc-100 mt-1">
                      {items.length === 0
                        ? 'No flavors added to this delivery yet.'
                        : `${items.length} flavor${items.length === 1 ? '' : 's'} on this delivery.`}
                    </p>
                  </div>

                  <div id="delivery-items" class="px-5 pb-4 w-full">
                    <ItemsTable delivery={delivery} items={items} flavors={flavors} prices={prices} suggestions={suggestedSets} />
                  </div>
                </div>
              </div>
            </div>

            <PreviousDeliveries delivery={delivery} allDeliveries={allDeliveries} allItems={allItems} />

            <div class="px-5 pt-4 pb-2">
              <h3 class="text-title-3 text-gray-900 dark:text-zinc-100">Additional Information</h3>
              <p class="text-callout text-gray-900 dark:text-zinc-100 mt-1">
                Keep internal context and customer-facing invoice notes for this delivery.
              </p>
              <form
                hx-patch={`/deliveries/${delivery.id}`}
                hx-trigger="change delay:500ms"
                hx-swap="none"
                class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2"
              >
                <div>
                  <label class="block text-headline text-gray-500 dark:text-zinc-400 mb-1.5">Personal Notes</label>
                  <textarea
                    name="notes"
                    rows={6}
                    placeholder="Add internal notes..."
                    class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#262626] bg-white dark:bg-[#0a0a0a] text-callout text-gray-900 dark:text-zinc-100 focus:ring-2 focus:ring-pink-500 focus:border-pink-500 resize-y min-h-[150px]"
                  >{plainNoteValue(delivery.notes)}</textarea>
                </div>
                <div>
                  <label class="block text-headline text-gray-500 dark:text-zinc-400 mb-1.5">Invoice Notes</label>
                  <textarea
                    name="invoiceNotes"
                    rows={6}
                    placeholder="Notes shown on the customer invoice..."
                    class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#262626] bg-white dark:bg-[#0a0a0a] text-callout text-gray-900 dark:text-zinc-100 focus:ring-2 focus:ring-pink-500 focus:border-pink-500 resize-y min-h-[150px]"
                  >{plainNoteValue(delivery.invoiceNotes)}</textarea>
                </div>
              </form>
            </div>
          </div>

          {/* Right sidebar — map + info + payments + notes */}
          <div class="space-y-4">
            <div class="relative h-[350px] w-[350px] max-w-full overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-[#262626] dark:bg-[#0a0a0a]">
              <div id="delivery-map-loading" class="absolute inset-0 flex items-center justify-center text-callout text-gray-400 dark:text-zinc-500">
                {delivery.location ? 'Loading map…' : 'No location set'}
              </div>
              <div id="delivery-map-canvas" class="absolute inset-0" />
              <script dangerouslySetInnerHTML={{ __html: mapKitLoaderScript(readMapKitToken()) }} />
              <script
                dangerouslySetInnerHTML={{
                  __html: DELIVERY_MAP_SCRIPT(
                    delivery.location ?? '',
                    delivery.storeName.trim(),
                    dateLong(delivery.dropoffDate ?? delivery.datePrepared),
                  ),
                }}
              />
              <script dangerouslySetInnerHTML={{ __html: DATE_INPUT_SYNC_SCRIPT }} />
              <script dangerouslySetInnerHTML={{ __html: MONEY_INPUT_SYNC_SCRIPT }} />
            </div>

            <form
              hx-patch={`/deliveries/${delivery.id}`}
              hx-trigger="change delay:500ms"
              hx-swap="none"
              class="space-y-4"
            >
              <div class="px-1 pt-1 pb-0">
                <h3 class="text-headline text-gray-900 dark:text-zinc-100 mb-0.5">Location</h3>
                <input
                  type="text"
                  name="location"
                  value={delivery.location ?? ''}
                  placeholder="Click to add address"
                  class="w-full text-left text-callout text-gray-900 dark:text-zinc-100 hover:text-pink-600 dark:hover:text-pink-400 hover:bg-gray-50 dark:hover:bg-[#171717] px-0 rounded transition-colors bg-transparent border-0 focus:ring-2 focus:ring-pink-500"
                />
              </div>

              <div class="px-1 pt-1">
                <h3 class="text-headline text-gray-900 dark:text-zinc-100 mb-3">Delivery Info & Payments</h3>
                <div class="grid grid-cols-2 gap-x-6 gap-y-2 items-start">
                  <div>
                    <div class="space-y-2.5">
                      {dateField('Prepared', 'datePrepared', delivery.datePrepared)}
                      {dateField('Dropoff', 'dropoffDate', delivery.dropoffDate)}
                      {readOnlyField(
                        'Expiration',
                        delivery.expirationDate ? dateLong(delivery.expirationDate) : 'Not set',
                        expirationStatus.color,
                      )}
                    </div>
                  </div>
                  <div>
                    <div class="space-y-2.5">
                      {moneyField('Cash', 'cashCollected', delivery.cashCollected)}
                      {moneyField('Venmo', 'venmoCollected', delivery.venmoCollected)}
                      {readOnlyField('Total', usd(totalCollected), 'text-green-600 dark:text-green-400')}
                    </div>
                  </div>
                </div>

                {/* Additional invoice fields */}
                <div class="grid grid-cols-2 gap-x-6 gap-y-2 items-start mt-4">
                  {moneyField('Additional Fees', 'additionalFees', delivery.additionalFees)}
                  {moneyField('Discount', 'discount', delivery.discount)}
                  {moneyField('Prepaid', 'prepaidAmount', delivery.prepaidAmount)}
                  {moneyField('Other', 'otherCollected', delivery.otherCollected)}
                </div>
              </div>
            </form>
          </div>
        </div>

        <AddFlavorModal delivery={delivery} flavors={flavors} prices={prices} />

        {/* Embedded jsPDF invoice-download routine. */}
        <script dangerouslySetInnerHTML={{ __html: INVOICE_SCRIPT }} />
      </div>
    </Layout>
  )
}
