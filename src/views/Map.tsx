import type { FC } from 'hono/jsx'
import { Layout } from './Layout.js'
import type { Event } from './Events.js'
import type { Delivery } from './Deliveries.js'

// ────────────────────────────────────────────────────────────────────────────
// Map view — ports apps/web-b/app/map/page.tsx + AppleMap.tsx +
// EventsMapModal + DeliveriesMapModal into a single server-rendered page.
//
// Apple MapKit JS is a CDN library that operates on the plain DOM; we don't
// need React. We:
//   1. Render a #map div + a <script type="application/json" id="map-data">
//      payload containing pre-shaped event + delivery markers.
//   2. Inject the mapkit.js loader as an inline <script> tag (verbatim port
//      of src/lib/mapkit-loader.ts, simplified for one-off init).
//   3. After mapkit is ready, geocode each location, drop colored
//      MarkerAnnotations, fit the region to the bounding box, and wire up
//      click handlers that surface a detail card + open the entity page.
//
// Token: web-b reads NEXT_PUBLIC_MAPKIT_TOKEN at build-time (frozen into the
// bundle). web-c is server-rendered, so we read process.env.MAPKIT_TOKEN at
// request-time and inline it into the <script> tag. Set the value in
// apps/web-c/.env (already done — copied from apps/web-b/.env.local).
// ────────────────────────────────────────────────────────────────────────────

interface MapMarker {
  kind: 'event' | 'delivery'
  id: number
  title: string
  subtitle: string
  location: string
  href: string
  // Display fields for the detail card (populated based on `kind`):
  date: string
  primaryStat?: { label: string; value: string }
  secondaryStat?: { label: string; value: string }
  tertiaryStat?: { label: string; value: string }
}

const formatDate = (s: string): string => {
  if (!s) return ''
  const d = new Date(s.includes('T') ? s : `${s}T00:00:00`)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const formatCurrency = (n: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

function buildMarkers(events: Event[], deliveries: Delivery[]): MapMarker[] {
  const out: MapMarker[] = []

  for (const e of events) {
    if (e.deletedAt) continue
    if (!e.location || !e.location.trim()) continue
    out.push({
      kind: 'event',
      id: e.id,
      title: e.name,
      subtitle: formatDate(e.eventDate),
      location: e.location,
      href: `/events/${e.id}`,
      date: formatDate(e.eventDate),
      primaryStat: { label: 'Sold', value: String(e.totalSold) },
      secondaryStat: { label: 'Revenue', value: formatCurrency(e.totalRevenue) },
      tertiaryStat: { label: 'Profit', value: formatCurrency(e.netProfit) },
    })
  }

  for (const d of deliveries) {
    if (d.deletedAt) continue
    if (!d.location || !d.location.trim()) continue
    out.push({
      kind: 'delivery',
      id: d.id,
      title: d.storeName,
      subtitle: formatDate(d.dropoffDate ?? d.datePrepared),
      location: d.location,
      href: `/deliveries/${d.id}`,
      date: formatDate(d.dropoffDate ?? d.datePrepared),
      primaryStat: { label: 'Prepared', value: String(d.totalPrepared) },
      secondaryStat: { label: 'Revenue', value: formatCurrency(d.totalRevenue) },
      tertiaryStat: { label: 'Profit', value: formatCurrency(d.grossProfit) },
    })
  }

  return out
}

// Inline initializer — runs in the browser after the mapkit.js CDN script
// loads. Reads JSON from #map-data and the token from #map-token.
// Mirrors AppleMap.tsx + EventsMapModal/DeliveriesMapModal logic.
const mapInitScript = `
(function(){
  var tokenEl = document.getElementById('map-token');
  var dataEl = document.getElementById('map-data');
  var container = document.getElementById('map');
  var detailEl = document.getElementById('map-detail-card');
  if(!tokenEl || !dataEl || !container) return;

  var loadingEl = document.getElementById('map-loading');
  function hideLoading(){
    if(!loadingEl) return;
    loadingEl.style.opacity = '0';
    setTimeout(function(){ if(loadingEl) loadingEl.style.display = 'none'; }, 500);
  }
  // Reveal the map (fade it in) once it's been panned to the right region.
  function revealMap(){
    container.style.opacity = '1';
    hideLoading();
  }

  var token = tokenEl.textContent.trim();
  if(!token){
    container.innerHTML = '<div class="absolute inset-0 flex items-center justify-center text-gray-400 dark:text-zinc-500 text-callout">MapKit token not configured. Set MAPKIT_TOKEN in apps/web-c/.env.</div>';
    container.style.opacity = '1'; hideLoading();
    return;
  }

  var markers;
  try { markers = JSON.parse(dataEl.textContent); } catch(e){ markers = []; }
  if(!markers.length){
    container.innerHTML = '<div class="absolute inset-0 flex items-center justify-center text-gray-400 dark:text-zinc-500 text-callout">No events or deliveries with a location yet.</div>';
    container.style.opacity = '1'; hideLoading();
    return;
  }

  function colorScheme(){
    if(!window.mapkit) return 'light';
    return document.documentElement.classList.contains('dark')
      ? window.mapkit.Map.ColorSchemes.Dark
      : window.mapkit.Map.ColorSchemes.Light;
  }

  function loadMapKit(){
    return new Promise(function(resolve, reject){
      if(window.mapkit && window.mapkit.Coordinate){ resolve(); return; }
      var existing = document.getElementById('apple-mapkit-js');
      if(existing){
        existing.addEventListener('load', function(){ resolve(); });
        existing.addEventListener('error', function(){ reject(); });
        return;
      }
      var s = document.createElement('script');
      s.id = 'apple-mapkit-js';
      s.src = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js';
      s.crossOrigin = 'anonymous';
      s.onload = function(){
        if(!window.mapkit){ reject(); return; }
        try {
          window.mapkit.init({ authorizationCallback: function(done){ done(token); } });
        } catch(e){}
        resolve();
      };
      s.onerror = function(){ reject(); };
      document.head.appendChild(s);
    });
  }

  function showDetail(m){
    if(!detailEl) return;
    var statsHtml = '';
    if(m.primaryStat){
      statsHtml += '<div class="text-center p-3 bg-gray-50 dark:bg-[#171717] rounded-xl">'+
        '<p class="text-caption uppercase tracking-[0.08em] text-gray-400 dark:text-zinc-500">'+m.primaryStat.label+'</p>'+
        '<p class="text-title-3 text-gray-900 dark:text-zinc-100">'+m.primaryStat.value+'</p></div>';
    }
    if(m.secondaryStat){
      statsHtml += '<div class="text-center p-3 bg-pink-50 dark:bg-pink-950/40 rounded-xl">'+
        '<p class="text-caption uppercase tracking-[0.08em] text-pink-400 dark:text-pink-500">'+m.secondaryStat.label+'</p>'+
        '<p class="text-title-3 text-pink-600 dark:text-pink-400">'+m.secondaryStat.value+'</p></div>';
    }
    if(m.tertiaryStat){
      statsHtml += '<div class="text-center p-3 bg-green-50 dark:bg-green-950/40 rounded-xl">'+
        '<p class="text-caption uppercase tracking-[0.08em] text-green-400 dark:text-green-500">'+m.tertiaryStat.label+'</p>'+
        '<p class="text-title-3 text-green-600 dark:text-green-400">'+m.tertiaryStat.value+'</p></div>';
    }
    var kindBadge = m.kind === 'event'
      ? '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-caption bg-pink-50 text-pink-700 dark:bg-pink-950/40 dark:text-pink-400">Event</span>'
      : '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-caption bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400">Delivery</span>';
    var btnColor = m.kind === 'event' ? 'bg-pink-500 hover:bg-pink-600' : 'bg-green-500 hover:bg-green-600';
    detailEl.innerHTML = '<div class="p-5">'+
      '<div class="flex items-start justify-between mb-3">'+
        '<div>'+
          '<div class="flex items-center gap-2 mb-1">'+kindBadge+'</div>'+
          '<h3 class="text-title-3 text-gray-900 dark:text-zinc-100">'+m.title+'</h3>'+
          '<p class="text-callout text-gray-500 dark:text-zinc-400">'+m.date+'</p>'+
        '</div>'+
        '<button type="button" id="map-detail-close" class="p-1 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] rounded-full transition-colors">'+
          '<svg class="w-5 h-5 text-gray-400 dark:text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>'+
        '</button>'+
      '</div>'+
      '<p class="text-callout text-gray-600 dark:text-zinc-400 mb-4 flex items-center gap-1">'+
        '<svg class="w-4 h-4 text-gray-400 dark:text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>'+
        m.location+
      '</p>'+
      '<div class="grid grid-cols-3 gap-3 mb-4">'+statsHtml+'</div>'+
      '<a href="'+m.href+'" class="block w-full text-center py-2.5 '+btnColor+' text-white rounded-xl text-button transition-colors">View Full Details</a>'+
    '</div>';
    detailEl.classList.remove('hidden');
    var closeBtn = document.getElementById('map-detail-close');
    if(closeBtn) closeBtn.addEventListener('click', function(){ detailEl.classList.add('hidden'); });
  }

  loadMapKit().then(function(){
    if(!window.mapkit){ return; }
    var map = new window.mapkit.Map(container, {
      colorScheme: colorScheme(),
      showsCompass: window.mapkit.FeatureVisibility.Adaptive,
      showsScale: window.mapkit.FeatureVisibility.Adaptive,
      showsZoomControl: true,
      showsMapTypeControl: true,
    });

    // Seed the camera on the Capital Region (Albany/Schenectady, NY) where
    // nearly all markers live. The map is still hidden behind the loading
    // overlay at this point — this just guarantees the first painted frame is
    // the right neighborhood, not the whole globe, before we fit to the bbox.
    try {
      map.region = new window.mapkit.CoordinateRegion(
        new window.mapkit.Coordinate(42.78, -73.84),
        new window.mapkit.CoordinateSpan(0.9, 0.9)
      );
    } catch(e){}

    // React to dark-mode flips
    var obs = new MutationObserver(function(){ map.colorScheme = colorScheme(); });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    var geocoder = new window.mapkit.Geocoder();
    var annotations = [];
    var completed = 0;
    var userRegion = null;
    var restoring = false;

    map.addEventListener('region-change-end', function(){
      if(!restoring) userRegion = map.region;
    });

    markers.forEach(function(m){
      geocoder.lookup(m.location, function(err, data){
        completed++;
        if(!err && data && data.results && data.results.length && window.mapkit){
          var raw = data.results[0].coordinate;
          var lat = Number(raw.latitude);
          var lng = Number(raw.longitude);
          if(Number.isFinite(lat) && Number.isFinite(lng)){
            var coord = new window.mapkit.Coordinate(lat, lng);
            // pink for events, green for deliveries
            var color = m.kind === 'event' ? '#ec4899' : '#10b981';
            var marker;
            try {
              marker = new window.mapkit.MarkerAnnotation(coord, {
                title: m.title,
                subtitle: m.subtitle,
                color: color,
                glyphColor: '#ffffff',
                // Cluster nearby pins (declutters the tight Albany area) and
                // only reveal the text labels when there's room — i.e. as you
                // zoom in. Adaptive lets MapKit collide-test the labels.
                clusteringIdentifier: m.kind,
                titleVisibility: window.mapkit.FeatureVisibility.Adaptive,
                subtitleVisibility: window.mapkit.FeatureVisibility.Adaptive,
              });
            } catch(e){ return; }

            marker.addEventListener('select', function(){
              showDetail(m);
              if(userRegion){
                restoring = true;
                setTimeout(function(){
                  map.region = userRegion;
                  setTimeout(function(){ restoring = false; }, 100);
                }, 10);
              }
            });

            try { map.addAnnotation(marker); annotations.push(marker); } catch(e){}
          }
        }

        if(completed === markers.length && annotations.length > 0){
          var coords = annotations.map(function(a){ return a.coordinate; });
          var lats = coords.map(function(c){ return c.latitude; });
          var lngs = coords.map(function(c){ return c.longitude; });
          var minLat = Math.min.apply(null, lats);
          var maxLat = Math.max.apply(null, lats);
          var minLng = Math.min.apply(null, lngs);
          var maxLng = Math.max.apply(null, lngs);
          var centerLat = (minLat + maxLat) / 2;
          var centerLng = (minLng + maxLng) / 2;
          var latSpan = Math.max((maxLat - minLat) * 1.5, 0.1);
          var lngSpan = Math.max((maxLng - minLng) * 1.5, 0.1);
          var region = new window.mapkit.CoordinateRegion(
            new window.mapkit.Coordinate(centerLat, centerLng),
            new window.mapkit.CoordinateSpan(latSpan, lngSpan)
          );
          map.region = region;
          userRegion = region;
          // Region is now fitted to all markers — let the tiles settle a beat,
          // then fade the (already panned-in) map in and drop the overlay.
          setTimeout(revealMap, 350);
        } else if(completed === markers.length){
          // Everything geocoded but nothing plottable — still reveal the map.
          revealMap();
        }
      });
    });
    // Safety net: if geocoding hangs, reveal the map anyway after 8s.
    setTimeout(revealMap, 8000);
  }).catch(function(){
    container.innerHTML = '<div class="absolute inset-0 flex items-center justify-center text-gray-400 dark:text-zinc-500 text-callout">Failed to load MapKit.</div>';
    container.style.opacity = '1'; hideLoading();
  });
})();
`

export interface MapPageProps {
  events: Event[]
  deliveries: Delivery[]
  mapkitToken: string
}

export const MapPage: FC<MapPageProps> = ({ events, deliveries, mapkitToken }) => {
  const markers = buildMarkers(events, deliveries)
  const eventCount = markers.filter((m) => m.kind === 'event').length
  const deliveryCount = markers.filter((m) => m.kind === 'delivery').length

  return (
    <Layout title="Map" active="map">
      <div class="w-full bg-white dark:bg-[#0a0a0a] rounded-3xl overflow-hidden">
        {/* Header inside card — matches Events / Deliveries spacing */}
        <div class="flex items-center justify-between px-8 pt-8 pb-4">
          <div>
            <h2 class="text-title-2 text-gray-900 dark:text-zinc-100">Map</h2>
            <p class="text-callout text-gray-400 dark:text-zinc-500 mt-1">
              {markers.length} location{markers.length === 1 ? '' : 's'} ·{' '}
              <span class="text-pink-600 dark:text-pink-400">{eventCount} event{eventCount === 1 ? '' : 's'}</span>
              {' · '}
              <span class="text-green-600 dark:text-green-400">{deliveryCount} deliver{deliveryCount === 1 ? 'y' : 'ies'}</span>
            </p>
          </div>
          <div class="flex items-center gap-2 text-caption text-gray-500 dark:text-zinc-400">
            <span class="inline-flex items-center gap-1.5">
              <span class="inline-block w-3 h-3 rounded-full" style="background:#ec4899" />
              Events
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="inline-block w-3 h-3 rounded-full" style="background:#10b981" />
              Deliveries
            </span>
          </div>
        </div>

        {/* Map container — sized to fill the viewport below the header (approx.
            calc(100vh - 220px) accounts for site header + card padding) */}
        <div class="relative px-4 pb-4">
          <div
            class="relative w-full rounded-2xl overflow-hidden bg-gray-50 dark:bg-[#171717]"
            style="height: calc(100vh - 220px); min-height: 480px;"
          >
            <div id="map" class="absolute inset-0 opacity-0 transition-opacity duration-500" />
            {/* Loading overlay — covers the map until it's geocoded + panned in,
                so the user never sees the raw world map snapping into place. */}
            <div
              id="map-loading"
              class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-50 dark:bg-[#171717] transition-opacity duration-500"
            >
              <svg class="w-8 h-8 text-pink-500 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p class="text-callout text-gray-400 dark:text-zinc-500 animate-pulse">Loading map…</p>
            </div>
            {/* Floating detail card (hidden until a marker is clicked) */}
            <div
              id="map-detail-card"
              class="hidden absolute bottom-6 left-6 right-6 md:left-auto md:right-6 md:w-96 bg-white dark:bg-[#0a0a0a] rounded-2xl shadow-2xl border border-gray-200 dark:border-[#262626] overflow-hidden"
            />
          </div>
        </div>
      </div>

      {/* Server-rendered token + marker payload — read by the inline script.
          Using <script type="application/json"> means the browser won't try
          to execute it, and we don't have to JSON-encode-then-escape twice. */}
      <script id="map-token" type="text/plain" dangerouslySetInnerHTML={{ __html: mapkitToken }} />
      <script id="map-data" type="application/json" dangerouslySetInnerHTML={{ __html: JSON.stringify(markers) }} />
      <script dangerouslySetInnerHTML={{ __html: mapInitScript }} />
    </Layout>
  )
}
