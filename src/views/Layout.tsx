import type { FC, PropsWithChildren } from 'hono/jsx'

// Mirrors apps/web-b/app/layout.tsx (themeInitScript) verbatim. Runs before
// React/htmx hydration to avoid the dark-mode flash-of-wrong-theme.
const themeInitScript = `
(function(){try{
  var t=localStorage.getItem('theme');
  var d=document.documentElement;
  var sysDark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
  if(t==='dark'){d.classList.add('dark');}
  else if(t==='light'){d.classList.remove('dark');}
  else{if(sysDark)d.classList.add('dark');else d.classList.remove('dark');}
}catch(e){}})();
`

// Inline ThemeToggle script: mirrors web-b/app/ThemeToggle.tsx behavior
// (toggle .dark on <html>, persist to localStorage). framer-motion animation
// is dropped — htmx layer doesn't ship it.
const themeToggleScript = `
(function(){
  var btn=document.getElementById('theme-toggle-btn');
  if(!btn) return;
  btn.addEventListener('click', function(){
    var d=document.documentElement;
    var isDark=d.classList.toggle('dark');
    try{localStorage.setItem('theme', isDark?'dark':'light');}catch(e){}
  });
})();
`

// Global count-up + ripple + htmx settle handlers. Animates any element with
// class .count-up & data-target attribute (currency / percent / plain). Re-runs
// after every htmx swap so freshly-rendered numbers tick up the same way.
const animationsScript = `
(function(){
  function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }
  function fmt(n, format, digits){
    if(format === 'currency') return new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', minimumFractionDigits:0, maximumFractionDigits:0 }).format(n);
    if(format === 'percent') return n.toFixed(digits || 1) + '%';
    return Math.round(n).toLocaleString();
  }
  function animateEl(el){
    if(el.dataset.animated) return;
    el.dataset.animated = '1';
    var target = parseFloat(el.getAttribute('data-target'));
    var format = el.getAttribute('data-format') || 'plain';
    var digits = parseInt(el.getAttribute('data-digits') || '1', 10);
    if(!isFinite(target)) return;
    var duration = 700, start = performance.now();
    function tick(now){
      var p = Math.min((now - start) / duration, 1);
      el.textContent = fmt(target * easeOutCubic(p), format, digits);
      if(p < 1) requestAnimationFrame(tick);
      else el.textContent = fmt(target, format, digits);
    }
    requestAnimationFrame(tick);
  }
  function scan(root){
    (root || document).querySelectorAll('.count-up').forEach(animateEl);
  }
  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ scan(); });
  } else {
    scan();
  }
  document.body.addEventListener('htmx:afterSwap', function(e){ scan(e.target); });

  // Tiny ripple on button mousedown — feels nicer than nothing.
  document.addEventListener('mousedown', function(e){
    var b = e.target.closest('button, a.btn-ripple');
    if(!b || b.dataset.noRipple) return;
    var rect = b.getBoundingClientRect();
    var r = document.createElement('span');
    var size = Math.max(rect.width, rect.height);
    r.style.cssText = 'position:absolute;border-radius:9999px;background:currentColor;opacity:0.18;pointer-events:none;width:' + size + 'px;height:' + size + 'px;left:' + (e.clientX - rect.left - size/2) + 'px;top:' + (e.clientY - rect.top - size/2) + 'px;transform:scale(0);transition:transform 420ms ease-out, opacity 600ms ease-out;';
    var pos = getComputedStyle(b).position;
    if(pos === 'static') b.style.position = 'relative';
    var prevOverflow = b.style.overflow;
    b.style.overflow = 'hidden';
    b.appendChild(r);
    requestAnimationFrame(function(){
      r.style.transform = 'scale(2.4)';
      r.style.opacity = '0';
    });
    setTimeout(function(){ r.remove(); if(prevOverflow) b.style.overflow = prevOverflow; else b.style.removeProperty('overflow'); }, 620);
  }, true);
})();
`

// Dev live-reload: listens to /__livereload SSE. The first 'hello' event sends
// the server's boot ID. On reconnect after a server restart, the new boot ID
// differs → full page reload. CSS-only edits emit a 'css' event so we swap the
// stylesheet href in place (no full reload, preserves form state etc.).
const liveReloadScript = `
(function(){
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  var bootId = null;
  function connect(){
    var es = new EventSource('/__livereload');
    es.addEventListener('hello', function(e){
      if (bootId === null) { bootId = e.data; return; }
      if (e.data !== bootId) { location.reload(); }
    });
    es.addEventListener('css', function(){
      document.querySelectorAll('link[rel="stylesheet"]').forEach(function(l){
        var href = l.getAttribute('href');
        if (!href || href.indexOf('/static/style.css') < 0) return;
        l.setAttribute('href', '/static/style.css?t=' + Date.now());
      });
    });
    es.onerror = function(){
      try { es.close(); } catch(e){}
      setTimeout(connect, 600);
    };
  }
  connect();
})();
`

interface LayoutProps {
  title?: string
  active?: string
}

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({ title = 'Mighty Sweet Baking Co.', active, children }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title}</title>
      <link rel="icon" type="image/png" href="https://mightysweetbakingco.com/wp-content/uploads/2025/07/logo-1.png" />
      {/* Preload the latin Geist + Geist Mono so the browser fetches them in
          parallel with the CSS and avoids a Flash-Of-Unstyled-Text on refresh. */}
      <link rel="preload" href="/static/files/geist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
      <link rel="preload" href="/static/files/geist-mono-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
      <link rel="stylesheet" href="/static/style.css" />
      <script src="https://unpkg.com/htmx.org@2.0.4" />
      <script src="https://unpkg.com/htmx-ext-sse@2.2.2/sse.js" />
      <script src="https://unpkg.com/alpinejs@3.14.7/dist/cdn.min.js" defer />
      <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
    </head>
    <body class="bg-white dark:bg-black min-h-screen antialiased">
      {/* Header — pixel-for-pixel parity with apps/web-b/app/layout.tsx */}
      <header class="bg-white dark:bg-black sticky top-0 z-50">
        <div class="max-w-[1600px] mx-auto px-4 lg:px-8 py-4 flex items-center justify-between">
          <a href="/" class="flex items-center gap-4 hover:opacity-80 transition-opacity">
            <img
              src="https://mightysweetbakingco.com/wp-content/uploads/2025/07/logo-1.png"
              alt="Mighty Sweet Baking Co."
              class="h-12 w-auto"
            />
            <div>
              <h1 class="text-title-3 text-gray-900 dark:text-zinc-100">Mighty Sweet Baking Co.</h1>
              <p class="text-headline text-pink-500">Inventory Manager</p>
            </div>
          </a>

          <div class="flex items-center gap-2">
            <nav class="flex gap-1">
              <NavLink href="/" active={active === 'home'}>Home</NavLink>
              <NavLink href="/flavors" active={active === 'flavors'}>Flavors</NavLink>
              <NavLink href="/events" active={active === 'events'}>Events</NavLink>
              <NavLink href="/deliveries" active={active === 'deliveries'}>Deliveries</NavLink>
              <NavLink href="/donations" active={active === 'donations'}>Donations</NavLink>
              <NavLink href="/map" active={active === 'map'}>Map</NavLink>
              <NavLink href="/experimental" active={active === 'experimental'}>Experimental</NavLink>
              <NavLink href="/activity" active={active === 'activity'}>Activity</NavLink>
            </nav>
            <div class="w-px h-6 bg-gray-200 dark:bg-[#262626] mx-2" />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main class="max-w-[1600px] mx-auto px-4 lg:px-8 py-6">{children}</main>

      {/* Modal portal — htmx modal fragments swap their content in here */}
      <div id="modal-root" />

      <script dangerouslySetInnerHTML={{ __html: themeToggleScript }} />
      <script dangerouslySetInnerHTML={{ __html: animationsScript }} />
      <script dangerouslySetInnerHTML={{ __html: liveReloadScript }} />
    </body>
  </html>
)

// Mirrors apps/web-b/app/NavLink.tsx classes exactly. Active styling is
// resolved server-side via the `active` prop (Hono JSX is stringly-rendered;
// no usePathname). Framer-motion `layoutId` animation is dropped — we paint
// a static rounded pill via the same Tailwind bg colors.
const NavLink: FC<PropsWithChildren<{ href: string; active?: boolean }>> = ({ href, active, children }) => (
  <a
    href={href}
    class={`relative px-4 py-2 rounded-lg text-button transition-colors ${
      active
        ? 'text-pink-600 dark:text-pink-400'
        : 'text-gray-600 hover:text-pink-600 hover:bg-pink-50 dark:text-zinc-400 dark:hover:text-pink-400 dark:hover:bg-pink-950/30'
    }`}
  >
    {active && <span class="absolute inset-0 bg-pink-50 dark:bg-pink-950/40 rounded-lg" />}
    <span class="relative">{children}</span>
  </a>
)

// Mirrors apps/web-b/app/ThemeToggle.tsx. We render both icons and let CSS
// (.dark:hidden / .hidden.dark:inline) swap them; no client-side state needed.
// Click handler is wired up by themeToggleScript at the bottom of <body>.
const ThemeToggle: FC = () => (
  <button
    id="theme-toggle-btn"
    type="button"
    aria-label="Toggle theme"
    class="h-9 w-9 inline-flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-[#1f1f1f] transition-colors align-middle"
  >
    {/* Sun icon — shown in dark mode (i.e. click to go light) */}
    <svg class="w-5 h-5 hidden dark:inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
    {/* Moon icon — shown in light mode (i.e. click to go dark) */}
    <svg class="w-5 h-5 inline dark:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  </button>
)
