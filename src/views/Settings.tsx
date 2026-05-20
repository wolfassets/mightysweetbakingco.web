import type { FC } from 'hono/jsx'
import { Layout } from './Layout.js'

// ────────────────────────────────────────────────────────────────────────────
// Settings page
//
// The web-b reference is intentionally absent (apps/web-b/app/settings/ is
// an empty directory — Next.js does not register a route). Both web-a's
// layout.tsx and the shared globals.css contain inline comments documenting
// what *used* to live here before 2026-05-02:
//
//   "Bricolage was a togglable font option in /settings; we now ship Geist
//    only. Uncomment these and the html.font-bricolage logic in globals.css
//    to re-enable."
//
// Per the agent brief we replicate the original toggle surface for parity.
// All interactions are vanilla JS + localStorage so settings survive reloads
// without a server round-trip (theme already uses the same pattern from
// Layout.tsx). The page wrapper mirrors web-b's other "rounded-3xl p-8"
// shell — same chrome as Donations etc.
// ────────────────────────────────────────────────────────────────────────────

// Inline script: read current preferences from localStorage on load, reflect
// them in the inputs, and persist on every change. Theme key matches the
// pre-existing `localStorage.theme` contract from Layout.tsx so we don't
// fight the boot-time theme init.
const settingsScript = `
(function(){
  function read(k, def){
    try { var v = localStorage.getItem(k); return v == null ? def : v; }
    catch(e){ return def; }
  }
  function write(k, v){
    try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch(e){}
  }
  function applyTheme(t){
    var d = document.documentElement;
    var sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (t === 'dark') d.classList.add('dark');
    else if (t === 'light') d.classList.remove('dark');
    else { if (sysDark) d.classList.add('dark'); else d.classList.remove('dark'); }
  }
  function applyFont(f){
    var d = document.documentElement;
    if (f === 'bricolage') d.classList.add('font-bricolage');
    else d.classList.remove('font-bricolage');
  }

  // Hydrate the form from localStorage on first paint.
  var theme = read('theme', 'system');
  var font  = read('font',  'geist');
  var arch  = read('showArchived', '0');
  var compact = read('compactDensity', '0');
  var anims = read('disableAnimations', '0');

  var radios = document.querySelectorAll('input[name="theme"]');
  for (var i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === theme);

  var fontSel = document.getElementById('font-select');
  if (fontSel) fontSel.value = font;

  var archCb = document.getElementById('show-archived-toggle');
  if (archCb) archCb.checked = (arch === '1');

  var densityCb = document.getElementById('compact-density-toggle');
  if (densityCb) densityCb.checked = (compact === '1');

  var animCb = document.getElementById('disable-animations-toggle');
  if (animCb) animCb.checked = (anims === '1');

  // Wire change handlers.
  for (var j = 0; j < radios.length; j++) {
    radios[j].addEventListener('change', function(e){
      write('theme', e.target.value);
      applyTheme(e.target.value);
    });
  }
  if (fontSel) {
    fontSel.addEventListener('change', function(e){
      write('font', e.target.value);
      applyFont(e.target.value);
    });
  }
  if (archCb) {
    archCb.addEventListener('change', function(e){
      write('showArchived', e.target.checked ? '1' : '0');
    });
  }
  if (densityCb) {
    densityCb.addEventListener('change', function(e){
      write('compactDensity', e.target.checked ? '1' : '0');
      document.documentElement.classList.toggle('density-compact', e.target.checked);
    });
  }
  if (animCb) {
    animCb.addEventListener('change', function(e){
      write('disableAnimations', e.target.checked ? '1' : '0');
      document.documentElement.classList.toggle('no-animations', e.target.checked);
    });
  }

  // Apply persisted font + density immediately on settings page load.
  applyFont(font);
  document.documentElement.classList.toggle('density-compact', compact === '1');
  document.documentElement.classList.toggle('no-animations', anims === '1');

  // Reset button — clears everything, returns to defaults.
  var reset = document.getElementById('reset-prefs-btn');
  if (reset) {
    reset.addEventListener('click', function(){
      if (!confirm('Reset all preferences to defaults?')) return;
      ['theme','font','showArchived','compactDensity','disableAnimations'].forEach(function(k){ write(k, null); });
      applyTheme('system');
      applyFont('geist');
      document.documentElement.classList.remove('density-compact','no-animations');
      location.reload();
    });
  }
})();
`

// Reusable row layout: label + description on the left, control on the right.
// Matches the rounded-3xl card + dark-zinc treatment used across web-b pages.
const Row: FC<{ label: string; description?: string; children: unknown }> = ({ label, description, children }) => (
  <div class="flex items-start justify-between gap-6 py-5 border-b border-gray-100 dark:border-[#1f1f1f] last:border-b-0">
    <div class="min-w-0 flex-1">
      <p class="text-button text-gray-900 dark:text-zinc-100">{label}</p>
      {description && <p class="text-caption text-gray-500 dark:text-zinc-500 mt-0.5">{description}</p>}
    </div>
    <div class="flex-shrink-0">{children as never}</div>
  </div>
)

export const SettingsPage: FC = () => (
  <Layout title="Settings" active="settings">
    <div class="bg-white dark:bg-[#0a0a0a] rounded-3xl p-8 max-w-3xl">
      <h1 class="text-title-1 text-gray-900 dark:text-zinc-100">Settings</h1>
      <p class="text-callout text-gray-500 dark:text-zinc-400 mt-2">
        Preferences are stored locally and persist across page reloads.
      </p>

      {/* ───── Appearance section ───── */}
      <section class="mt-8">
        <h2 class="text-headline uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-500 mb-1">Appearance</h2>

        <Row label="Theme" description="Light, dark, or follow your system setting.">
          <div class="flex gap-1 rounded-full bg-gray-100 dark:bg-[#1a1a1a] p-1">
            <label class="cursor-pointer">
              <input type="radio" name="theme" value="light" class="peer sr-only" />
              <span class="block px-4 py-1.5 rounded-full text-button-sm text-gray-600 dark:text-zinc-400 peer-checked:bg-white peer-checked:text-gray-900 dark:peer-checked:bg-[#262626] dark:peer-checked:text-zinc-100 transition-colors">
                Light
              </span>
            </label>
            <label class="cursor-pointer">
              <input type="radio" name="theme" value="dark" class="peer sr-only" />
              <span class="block px-4 py-1.5 rounded-full text-button-sm text-gray-600 dark:text-zinc-400 peer-checked:bg-white peer-checked:text-gray-900 dark:peer-checked:bg-[#262626] dark:peer-checked:text-zinc-100 transition-colors">
                Dark
              </span>
            </label>
            <label class="cursor-pointer">
              <input type="radio" name="theme" value="system" class="peer sr-only" />
              <span class="block px-4 py-1.5 rounded-full text-button-sm text-gray-600 dark:text-zinc-400 peer-checked:bg-white peer-checked:text-gray-900 dark:peer-checked:bg-[#262626] dark:peer-checked:text-zinc-100 transition-colors">
                System
              </span>
            </label>
          </div>
        </Row>

        <Row
          label="Font"
          description="Bricolage was the original headline font (deprecated 2026-05-02). Geist is the default."
        >
          <select
            id="font-select"
            class="px-3 py-1.5 rounded-full text-button-sm bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-[#1a1a1a] dark:hover:bg-[#262626] dark:text-zinc-300 border-0 focus:outline-none focus:ring-2 focus:ring-pink-500"
          >
            <option value="geist">Geist (default)</option>
            <option value="bricolage">Bricolage Grotesque</option>
          </select>
        </Row>

        <Row
          label="Compact density"
          description="Tighter padding in tables and cards."
        >
          <label class="relative inline-flex items-center cursor-pointer">
            <input id="compact-density-toggle" type="checkbox" class="sr-only peer" />
            <span class="w-11 h-6 bg-gray-200 dark:bg-[#262626] peer-checked:bg-pink-500 rounded-full transition-colors relative">
              <span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
            </span>
          </label>
        </Row>

        <Row
          label="Disable animations"
          description="Skip page transitions and animated counters."
        >
          <label class="relative inline-flex items-center cursor-pointer">
            <input id="disable-animations-toggle" type="checkbox" class="sr-only peer" />
            <span class="w-11 h-6 bg-gray-200 dark:bg-[#262626] peer-checked:bg-pink-500 rounded-full transition-colors relative">
              <span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
            </span>
          </label>
        </Row>
      </section>

      {/* ───── Data section ───── */}
      <section class="mt-10">
        <h2 class="text-headline uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-500 mb-1">Data</h2>

        <Row
          label="Show archived rows by default"
          description="When enabled, archived flavors / events / deliveries appear in their lists without clicking the toggle each time."
        >
          <label class="relative inline-flex items-center cursor-pointer">
            <input id="show-archived-toggle" type="checkbox" class="sr-only peer" />
            <span class="w-11 h-6 bg-gray-200 dark:bg-[#262626] peer-checked:bg-pink-500 rounded-full transition-colors relative">
              <span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
            </span>
          </label>
        </Row>
      </section>

      {/* ───── About section ───── */}
      <section class="mt-10">
        <h2 class="text-headline uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-500 mb-1">About</h2>

        <Row label="App" description="Mighty Sweet Inventory Manager">
          <span class="text-callout text-gray-500 dark:text-zinc-500">web-c</span>
        </Row>
        <Row label="API base" description="Upstream Hono service">
          <span class="text-callout text-gray-500 dark:text-zinc-500">localhost:3000</span>
        </Row>
        <Row label="Reset preferences" description="Clear all locally stored settings and reload.">
          <button
            id="reset-prefs-btn"
            type="button"
            class="px-3 py-1.5 rounded-full text-button-sm bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-950/60 transition-colors"
          >
            Reset
          </button>
        </Row>
      </section>
    </div>

    <script dangerouslySetInnerHTML={{ __html: settingsScript }} />
  </Layout>
)
