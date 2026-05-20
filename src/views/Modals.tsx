import type { FC } from 'hono/jsx'
import { usd, date } from '../lib/format.js'
import type { Delivery } from './Deliveries.js'

// ─────────────────────────────────────────────────────────────────────────────
// MapKit loader (singleton, browser-side).
//
// Mirrors apps/web-b/src/lib/mapkit-loader.ts but inlined as a <script>
// string so the htmx layer doesn't need a bundler. Idempotent: subsequent
// modal opens reuse the already-loaded namespace. The token is injected at
// render time by readMapKitToken() which falls back to the empty string —
// in dev that yields a "no map" placeholder rather than a crash.
//
// Agent #9 (Events map) was also told to inline its own copy of this
// script. If the two copies fight, the SCRIPT_ID guard wins: only the first
// invocation injects the <script src>. The second call's loadMapKit() will
// await the existing tag's `load` event.
// ─────────────────────────────────────────────────────────────────────────────
const mapKitLoaderScript = (token: string) => `
(function(w){
  if (w.__mscLoadMapKit) return;
  var SCRIPT_ID = 'apple-mapkit-js';
  var TOKEN = ${JSON.stringify(token)};
  var loadPromise = null;
  w.__mscLoadMapKit = function(){
    if (typeof w === 'undefined') return Promise.resolve();
    if (w.mapkit && w.mapkit.Coordinate) return Promise.resolve();
    if (loadPromise) return loadPromise;
    loadPromise = new Promise(function(resolve, reject){
      var existing = document.getElementById(SCRIPT_ID);
      if (existing) {
        if (w.mapkit) { resolve(); return; }
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
        w.mapkit.init({ authorizationCallback: function(done){ done(TOKEN); } });
        resolve();
      };
      s.onerror = function(){ reject(new Error('MapKit load failed')); };
      document.head.appendChild(s);
    });
    return loadPromise;
  };
})(window);
`

function readMapKitToken(): string {
  return process.env.MAPKIT_TOKEN ?? process.env.NEXT_PUBLIC_MAPKIT_TOKEN ?? ''
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared modal-close client script. Pressing Escape, clicking the backdrop,
// or hitting Cancel triggers `hx-get="/modals/empty"` which clears the
// `#modal-root` container.
// ─────────────────────────────────────────────────────────────────────────────
const modalEscapeScript = `
(function(){
  if (window.__mscModalEscapeBound) return;
  window.__mscModalEscapeBound = true;
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Escape') return;
    var root = document.getElementById('modal-root');
    if (!root || !root.firstChild) return;
    // Don't override map detail card's own escape handler when card is open.
    var detail = document.querySelector('[data-modal-detail-card]');
    if (detail) { detail.remove(); return; }
    root.innerHTML = '';
  });
})();
`

// ─────────────────────────────────────────────────────────────────────────────
// AddStoreModal (htmx port of apps/web-b/src/components/AddStoreModal.tsx).
//
// Web-b is a stateful React modal with three modes (`choice`, `existing`,
// `new`). In htmx we model the same flow via three small server fragments:
//   /modals/add-store           → choice screen
//   /modals/add-store/existing  → existing-store picker
//   /modals/add-store/new       → new-store name input
// Each "back" button is just an `hx-get` to the previous fragment.
//
// Animations: framer-motion's slide-and-fade is replaced by CSS keyframes
// declared inline (Tailwind v4 doesn't have an out-of-the-box `animate-fade`
// utility that fits this shape).
// ─────────────────────────────────────────────────────────────────────────────
const modalFrameStyles = `
@keyframes mscModalBackdropIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes mscModalCardIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
@keyframes mscModalContentIn { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: translateX(0); } }
.msc-modal-backdrop { animation: mscModalBackdropIn 0.18s ease-out forwards; }
.msc-modal-card { animation: mscModalCardIn 0.2s ease-out forwards; }
.msc-modal-content { animation: mscModalContentIn 0.18s ease-out forwards; }
@keyframes mscMapFadeIn { from { opacity: 0; } to { opacity: 1; } }
.msc-map-fade { animation: mscMapFadeIn 0.25s ease-out forwards; }
@keyframes mscDetailIn { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
.msc-detail-card { animation: mscDetailIn 0.25s ease-out forwards; }
`

// Outer modal frame — used by all three AddStoreModal modes.
export const AddStoreFrame: FC<{ children?: unknown }> = ({ children }) => (
  <>
    <style dangerouslySetInnerHTML={{ __html: modalFrameStyles }} />
    <div
      class="msc-modal-backdrop fixed inset-0 bg-black/50 z-50"
      hx-get="/modals/empty"
      hx-target="#modal-root"
      hx-swap="innerHTML"
    />
    <div class="msc-modal-card fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
      <div
        id="add-store-card"
        class="bg-white dark:bg-[#0a0a0a] dark:border dark:border-[#262626] rounded-2xl shadow-2xl w-full max-w-md p-6 pointer-events-auto"
        onclick="event.stopPropagation()"
      >
        <div class="msc-modal-content" key={String(Math.random())}>
          {children}
        </div>
      </div>
    </div>
    <script dangerouslySetInnerHTML={{ __html: modalEscapeScript }} />
  </>
)

// ─── Choice screen ───────────────────────────────────────────────────────────
export const AddStoreChoice: FC<{ storeCount: number }> = ({ storeCount }) => {
  const disabled = storeCount === 0
  return (
    <AddStoreFrame>
      <h3 class="text-title-3 text-gray-900 dark:text-zinc-100 mb-1">New Delivery</h3>
      <p class="text-callout text-gray-500 dark:text-zinc-400 mb-5">
        Pick an existing store, or add a new one.
      </p>
      <div class="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={disabled}
          hx-get="/modals/add-store/existing"
          hx-target="#modal-root"
          hx-swap="innerHTML"
          class="p-5 border border-gray-200 dark:border-[#262626] rounded-2xl hover:border-pink-500 dark:hover:border-pink-400 hover:bg-pink-50/50 dark:hover:bg-pink-950/30 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-200 dark:disabled:hover:border-[#262626] disabled:hover:bg-transparent"
        >
          <svg class="w-7 h-7 text-pink-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 9l2-5h14l2 5M3 9v10a1 1 0 001 1h16a1 1 0 001-1V9M3 9h18M9 14h6" />
          </svg>
          <div class="text-headline text-gray-900 dark:text-zinc-100">Existing store</div>
          <div class="text-caption text-gray-500 dark:text-zinc-400 mt-0.5">
            {storeCount} store{storeCount === 1 ? '' : 's'} on file
          </div>
        </button>
        <button
          type="button"
          hx-get="/modals/add-store/new"
          hx-target="#modal-root"
          hx-swap="innerHTML"
          class="p-5 border border-gray-200 dark:border-[#262626] rounded-2xl hover:border-pink-500 dark:hover:border-pink-400 hover:bg-pink-50/50 dark:hover:bg-pink-950/30 transition-all text-left"
        >
          <svg class="w-7 h-7 text-pink-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 4v16m8-8H4" />
          </svg>
          <div class="text-headline text-gray-900 dark:text-zinc-100">New store</div>
          <div class="text-caption text-gray-500 dark:text-zinc-400 mt-0.5">Type a name from scratch</div>
        </button>
      </div>
      <div class="mt-5 flex justify-end">
        <button
          type="button"
          hx-get="/modals/empty"
          hx-target="#modal-root"
          hx-swap="innerHTML"
          class="px-4 py-2 text-button text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-[#171717] rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </AddStoreFrame>
  )
}

// Back chevron used by both nested screens
const BackButton: FC<{ to: string }> = ({ to }) => (
  <button
    type="button"
    hx-get={to}
    hx-target="#modal-root"
    hx-swap="innerHTML"
    class="text-caption text-gray-500 dark:text-zinc-400 hover:text-pink-600 dark:hover:text-pink-400 transition-colors mb-3 flex items-center gap-1"
  >
    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
    </svg>
    Back
  </button>
)

// ─── Existing store screen ───────────────────────────────────────────────────
export const AddStoreExisting: FC<{ stores: string[] }> = ({ stores }) => {
  const today = new Date().toISOString().slice(0, 10)
  return (
    <AddStoreFrame>
      <BackButton to="/modals/add-store" />
      <h3 class="text-title-3 text-gray-900 dark:text-zinc-100 mb-1">Existing store</h3>
      <p class="text-callout text-gray-500 dark:text-zinc-400 mb-4">Pick the store for this delivery.</p>

      <form
        hx-post="/modals/add-store"
        hx-target="#delivery-list"
        hx-swap="outerHTML"
        hx-on--after-request="if(event.detail.successful){document.getElementById('modal-root').innerHTML='';}"
      >
        <label class="block text-caption uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-400 mb-1.5">Store</label>
        <select
          name="storeName"
          required
          class="w-full px-3 py-2 mb-5 text-callout bg-gray-50 dark:bg-[#171717] border border-gray-200 dark:border-[#262626] rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 text-gray-900 dark:text-zinc-100"
        >
          <option value="">Choose a store...</option>
          {stores.map((s) => (
            <option value={s}>{s}</option>
          ))}
        </select>
        <input type="hidden" name="datePrepared" value={today} />
        <div class="flex justify-end gap-2">
          <button
            type="button"
            hx-get="/modals/empty"
            hx-target="#modal-root"
            hx-swap="innerHTML"
            class="px-4 py-2 text-button text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-[#171717] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="px-4 py-2 text-button bg-pink-500 text-white rounded-lg hover:bg-pink-600 transition-colors disabled:opacity-50"
          >
            Create delivery
          </button>
        </div>
      </form>
    </AddStoreFrame>
  )
}

// ─── New store screen ────────────────────────────────────────────────────────
export const AddStoreNew: FC = () => {
  const today = new Date().toISOString().slice(0, 10)
  return (
    <AddStoreFrame>
      <BackButton to="/modals/add-store" />
      <h3 class="text-title-3 text-gray-900 dark:text-zinc-100 mb-1">New store</h3>
      <p class="text-callout text-gray-500 dark:text-zinc-400 mb-4">Type the name of the new store.</p>

      <form
        hx-post="/modals/add-store"
        hx-target="#delivery-list"
        hx-swap="outerHTML"
        hx-on--after-request="if(event.detail.successful){document.getElementById('modal-root').innerHTML='';}"
      >
        <label class="block text-caption uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-400 mb-1.5">Store name</label>
        <input
          type="text"
          name="storeName"
          required
          placeholder="e.g. Sweet Spot Bakery"
          autofocus
          class="w-full px-3 py-2 mb-5 text-callout bg-gray-50 dark:bg-[#171717] border border-gray-200 dark:border-[#262626] rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-600"
        />
        <input type="hidden" name="datePrepared" value={today} />

        <div class="flex justify-end gap-2">
          <button
            type="button"
            hx-get="/modals/empty"
            hx-target="#modal-root"
            hx-swap="innerHTML"
            class="px-4 py-2 text-button text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-[#171717] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="px-4 py-2 text-button bg-pink-500 text-white rounded-lg hover:bg-pink-600 transition-colors disabled:opacity-50"
          >
            Create delivery
          </button>
        </div>
      </form>
    </AddStoreFrame>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DeliveriesMapModal (htmx port of apps/web-b/src/components/DeliveriesMapModal.tsx).
//
// Full-screen overlay. Apple MapKit is loaded via the inline loader above;
// markers are placed by geocoding each delivery's `location` string. The
// list on the right is purely server-rendered — clicking a row sends an
// `hx-get` for the detail card; clicking a marker fires a custom DOM event
// that the same hx-get handler watches for.
//
// We do NOT try to preserve the React refs/region-restoration logic
// verbatim. The htmx flavor: when a marker is selected, the map keeps its
// current viewport (we don't call `map.region = …` on select), and the
// detail card pops up in the corner. Same UX, less wiring.
// ─────────────────────────────────────────────────────────────────────────────
export const DeliveriesMapModalView: FC<{ deliveries: Delivery[] }> = ({ deliveries }) => {
  const active = deliveries.filter((d) => !d.deletedAt)
  const token = readMapKitToken()
  const deliveriesJson = JSON.stringify(
    active.map((d) => ({
      id: d.id,
      storeName: d.storeName.trim(),
      location: d.location ?? null,
      dateLabel: date(d.dropoffDate ?? d.datePrepared),
    })),
  )

  const mapInitScript = `
(function(){
  var STATE_KEY = '__mscDeliveriesMap';
  if (window[STATE_KEY] && window[STATE_KEY].destroy) {
    try { window[STATE_KEY].destroy(); } catch(e){}
  }
  var data = ${deliveriesJson};
  var container = document.getElementById('deliveries-map-canvas');
  if (!container) return;

  function ready(){
    if (!window.mapkit || !window.mapkit.Coordinate) return false;
    return true;
  }

  function init(){
    var map = new window.mapkit.Map(container, {
      showsCompass: 'adaptive',
      showsScale: 'adaptive',
      colorScheme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    });
    var loadingEl = document.getElementById('deliveries-map-loading');
    var geocoder = new window.mapkit.Geocoder();
    var annotations = [];
    var byId = {};
    var toGeocode = data.filter(function(d){ return d.location && d.location.trim() !== ''; });
    var completed = 0;
    if (toGeocode.length === 0) {
      if (loadingEl) loadingEl.style.display = 'none';
      container.style.opacity = '1';
      return;
    }
    toGeocode.forEach(function(delivery){
      geocoder.lookup(delivery.location, function(err, res){
        completed++;
        if (!err && res && res.results && res.results.length && window.mapkit) {
          var raw = res.results[0].coordinate;
          var lat = Number(raw && raw.latitude);
          var lng = Number(raw && raw.longitude);
          if (isFinite(lat) && isFinite(lng)) {
            var coord = new window.mapkit.Coordinate(lat, lng);
            var marker;
            try {
              marker = new window.mapkit.MarkerAnnotation(coord, {
                title: delivery.storeName,
                subtitle: delivery.dateLabel,
                color: '#ec4899',
                glyphColor: '#ffffff',
              });
            } catch(e){ marker = null; }
            if (marker) {
              marker.addEventListener('select', function(){
                showDetail(delivery.id);
              });
              annotations.push(marker);
              byId[delivery.id] = marker;
              try { map.addAnnotation(marker); } catch(e){}
            }
          }
        }
        if (completed === toGeocode.length) {
          if (annotations.length > 0 && window.mapkit) {
            var lats = annotations.map(function(a){ return a.coordinate.latitude; });
            var lngs = annotations.map(function(a){ return a.coordinate.longitude; });
            var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
            var minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
            var span = function(d, m){ return Math.max(d * 1.5, m); };
            try {
              map.region = new window.mapkit.CoordinateRegion(
                new window.mapkit.Coordinate((minLat+maxLat)/2, (minLng+maxLng)/2),
                new window.mapkit.CoordinateSpan(span(maxLat-minLat, 0.1), span(maxLng-minLng, 0.1)),
              );
            } catch(e){}
          }
          if (loadingEl) loadingEl.style.display = 'none';
          container.style.opacity = '1';
        }
      });
    });

    function showDetail(id){
      var row = document.querySelector('[data-delivery-row="'+id+'"]');
      if (row) htmx.trigger(row, 'click');
    }

    window[STATE_KEY] = {
      destroy: function(){
        try { map.destroy(); } catch(e){}
        delete window[STATE_KEY];
      },
    };
  }

  function go(){
    if (!window.__mscLoadMapKit) {
      setTimeout(go, 50);
      return;
    }
    window.__mscLoadMapKit().then(function(){
      if (ready()) init();
    }).catch(function(){
      var loadingEl = document.getElementById('deliveries-map-loading');
      if (loadingEl) loadingEl.innerHTML = '<p class="text-callout text-red-500">Map failed to load</p>';
    });
  }
  go();
})();
`

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: modalFrameStyles }} />
      <script dangerouslySetInnerHTML={{ __html: mapKitLoaderScript(token) }} />
      <div
        id="deliveries-map-modal"
        class="msc-modal-backdrop fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      >
        <div class="msc-map-fade absolute inset-0 bg-white dark:bg-[#0a0a0a]">
          {/* Header */}
          <div class="absolute top-0 left-0 right-0 z-10 bg-white/90 dark:bg-black/90 backdrop-blur-md border-b border-gray-200 dark:border-[#262626]">
            <div class="flex items-center justify-between px-6 py-4">
              <div>
                <h2 class="text-title-3 text-gray-900 dark:text-zinc-100">Past Deliveries Map</h2>
                <p class="text-callout text-gray-500 dark:text-zinc-400">{active.length} locations</p>
              </div>
              <button
                type="button"
                hx-get="/modals/empty"
                hx-target="#modal-root"
                hx-swap="innerHTML"
                onclick="if(window.__mscDeliveriesMap && window.__mscDeliveriesMap.destroy){window.__mscDeliveriesMap.destroy();}"
                class="p-2 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] rounded-full transition-colors"
              >
                <svg class="w-6 h-6 text-gray-600 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Loading */}
          <div
            id="deliveries-map-loading"
            class="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-[#171717] z-[5]"
          >
            <div class="flex flex-col items-center gap-3">
              <div class="w-8 h-8 border-[3px] border-pink-500 border-t-transparent rounded-full animate-spin" />
              <p class="text-callout text-gray-500 dark:text-zinc-400">Loading map...</p>
            </div>
          </div>

          {/* Map */}
          <div
            id="deliveries-map-canvas"
            class="w-full h-full transition-opacity duration-300"
            style="opacity: 0;"
          />

          {/* Side list (collapsible to detail card on click) */}
          <aside class="absolute top-20 right-6 bottom-6 w-80 hidden md:block bg-white/95 dark:bg-[#0a0a0a]/95 backdrop-blur rounded-2xl shadow-2xl border border-gray-200 dark:border-[#262626] overflow-y-auto z-10">
            <div class="px-4 py-3 border-b border-gray-100 dark:border-[#1f1f1f] sticky top-0 bg-white/95 dark:bg-[#0a0a0a]/95 backdrop-blur">
              <p class="text-headline text-gray-900 dark:text-zinc-100">Deliveries</p>
            </div>
            <ul class="divide-y divide-gray-100 dark:divide-[#1f1f1f]">
              {active.map((d) => (
                <li
                  data-delivery-row={d.id}
                  hx-get={`/modals/deliveries-map/${d.id}`}
                  hx-target="#deliveries-map-detail"
                  hx-swap="innerHTML"
                  hx-trigger="click"
                  class="px-4 py-3 cursor-pointer hover:bg-pink-50 dark:hover:bg-pink-950/30"
                >
                  <p class="text-button text-gray-900 dark:text-zinc-100 truncate">{d.storeName.trim()}</p>
                  <p class="text-caption text-gray-500 dark:text-zinc-500">{date(d.dropoffDate ?? d.datePrepared)}</p>
                  {d.location && (
                    <p class="text-caption text-gray-400 dark:text-zinc-500 truncate mt-0.5">{d.location}</p>
                  )}
                </li>
              ))}
            </ul>
          </aside>

          {/* Detail card slot */}
          <div id="deliveries-map-detail" />
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: mapInitScript }} />
      <script dangerouslySetInnerHTML={{ __html: modalEscapeScript }} />
    </>
  )
}

// Detail card fragment, returned by GET /modals/deliveries-map/:id
export const DeliveryDetailCard: FC<{ d: Delivery }> = ({ d }) => (
  <div
    data-modal-detail-card
    class="msc-detail-card absolute bottom-6 left-6 right-6 md:left-auto md:right-6 md:w-96 bg-white dark:bg-[#0a0a0a] rounded-2xl shadow-2xl border border-gray-200 dark:border-[#262626] overflow-hidden z-20"
  >
    <div class="p-5">
      <div class="flex items-start justify-between mb-3">
        <div>
          <h3 class="text-title-3 text-gray-900 dark:text-zinc-100">{d.storeName.trim()}</h3>
          <p class="text-callout text-gray-500 dark:text-zinc-400">{date(d.dropoffDate ?? d.datePrepared)}</p>
        </div>
        <button
          type="button"
          hx-get="/modals/empty"
          hx-target="#deliveries-map-detail"
          hx-swap="innerHTML"
          class="p-1 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] rounded-full transition-colors"
        >
          <svg class="w-5 h-5 text-gray-400 dark:text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {d.location && (
        <p class="text-callout text-gray-600 dark:text-zinc-400 mb-4 flex items-center gap-1">
          <svg class="w-4 h-4 text-gray-400 dark:text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {d.location}
        </p>
      )}

      <div class="grid grid-cols-3 gap-3 mb-4">
        <div class="text-center p-3 bg-gray-50 dark:bg-[#171717] rounded-xl">
          <p class="text-caption uppercase tracking-[0.08em] text-gray-400 dark:text-zinc-500">Prepared</p>
          <p class="text-title-3 text-gray-900 dark:text-zinc-100">{d.totalPrepared}</p>
        </div>
        <div class="text-center p-3 bg-pink-50 dark:bg-pink-950/40 rounded-xl">
          <p class="text-caption uppercase tracking-[0.08em] text-pink-400 dark:text-pink-500">Revenue</p>
          <p class="text-title-3 text-pink-600 dark:text-pink-400">{usd(d.totalRevenue)}</p>
        </div>
        <div class="text-center p-3 bg-green-50 dark:bg-green-950/40 rounded-xl">
          <p class="text-caption uppercase tracking-[0.08em] text-green-400 dark:text-green-500">Profit</p>
          <p class="text-title-3 text-green-600 dark:text-green-400">{usd(d.grossProfit)}</p>
        </div>
      </div>

      <a
        href={`/deliveries/${d.id}`}
        class="block w-full text-center py-2.5 bg-pink-500 text-white rounded-xl text-button hover:bg-pink-600 transition-colors"
      >
        View Full Details
      </a>
    </div>
  </div>
)
