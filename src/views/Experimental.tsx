import type { FC } from 'hono/jsx'
import { Layout } from './Layout.js'
import type { Event } from './Events.js'
import type { Delivery } from './Deliveries.js'

// ─────────────────────────────────────────────────────────────────────────────
// Shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface EventItem {
  id: number
  eventId: number
  flavorName: string
  prepared: number | null
  sold: number | null
  giveaway: number | null
  unitPrice: number | null
  unitCost: number | null
}

export interface DeliveryItem {
  id: number
  deliveryId: number
  flavorName: string
  prepared: number
  unsold: number
  unitPrice: number
  unitCost: number
  revenue: number
  cogs: number
  profit: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregations (server-rendered, fed to ApexCharts as JSON)
// ─────────────────────────────────────────────────────────────────────────────

interface FlavorAgg {
  name: string
  sold: number
  prepared: number
  unsold: number
  revenue: number
  cost: number
  profit: number
  margin: number
  sellThrough: number
}

function aggregateByFlavor(eventItems: EventItem[], deliveryItems: DeliveryItem[]): FlavorAgg[] {
  const m = new Map<string, FlavorAgg>()
  const ensure = (name: string) => {
    if (!m.has(name)) m.set(name, { name, sold: 0, prepared: 0, unsold: 0, revenue: 0, cost: 0, profit: 0, margin: 0, sellThrough: 0 })
    return m.get(name)!
  }
  for (const it of eventItems) {
    const a = ensure(it.flavorName)
    const sold = it.sold ?? 0
    const prepared = it.prepared ?? 0
    const price = it.unitPrice ?? 0
    const cost = it.unitCost ?? 0
    a.sold += sold
    a.prepared += prepared
    a.unsold += Math.max(0, prepared - sold - (it.giveaway ?? 0))
    a.revenue += sold * price
    a.cost += prepared * cost
  }
  for (const it of deliveryItems) {
    const a = ensure(it.flavorName)
    a.sold += it.prepared - it.unsold
    a.prepared += it.prepared
    a.unsold += it.unsold
    a.revenue += it.revenue
    a.cost += it.cogs
  }
  for (const a of m.values()) {
    a.profit = a.revenue - a.cost
    a.margin = a.revenue > 0 ? (a.profit / a.revenue) * 100 : 0
    a.sellThrough = a.prepared > 0 ? ((a.prepared - a.unsold) / a.prepared) * 100 : 0
  }
  return [...m.values()]
}

interface ParetoPoint { name: string; revenue: number; cumPct: number }
function paretoByFlavor(flavors: FlavorAgg[]): ParetoPoint[] {
  const sorted = [...flavors].sort((a, b) => b.revenue - a.revenue)
  const total = sorted.reduce((s, f) => s + f.revenue, 0)
  let running = 0
  return sorted.map((f) => {
    running += f.revenue
    return { name: f.name, revenue: f.revenue, cumPct: total > 0 ? (running / total) * 100 : 0 }
  })
}

interface StoreShare { name: string; revenue: number; pct: number }
function concentrationByStore(deliveries: Delivery[]): { stores: StoreShare[]; top1: number; top3: number; top5: number } {
  const m = new Map<string, number>()
  for (const d of deliveries) {
    if (d.deletedAt) continue
    const k = d.storeName.trim()
    m.set(k, (m.get(k) ?? 0) + d.totalRevenue)
  }
  const total = [...m.values()].reduce((s, v) => s + v, 0)
  const stores = [...m.entries()]
    .map(([name, revenue]) => ({ name, revenue, pct: total > 0 ? (revenue / total) * 100 : 0 }))
    .sort((a, b) => b.revenue - a.revenue)
  const top1 = stores[0]?.pct ?? 0
  const top3 = stores.slice(0, 3).reduce((s, x) => s + x.pct, 0)
  const top5 = stores.slice(0, 5).reduce((s, x) => s + x.pct, 0)
  return { stores: stores.slice(0, 12), top1, top3, top5 }
}

interface HeatmapCell { x: string; y: number }
interface HeatmapSeries { name: string; data: HeatmapCell[] }
function dayMonthHeatmap(events: Event[], deliveries: Delivery[]): HeatmapSeries[] {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const cells: Record<string, Record<string, { sum: number; count: number }>> = {}
  for (const day of days) cells[day] = Object.fromEntries(months.map((m) => [m, { sum: 0, count: 0 }]))
  const add = (dateStr: string, revenue: number) => {
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'))
    if (isNaN(d.getTime())) return
    const day = days[d.getDay()]
    const month = months[d.getMonth()]
    cells[day][month].sum += revenue
    cells[day][month].count += 1
  }
  for (const e of events) {
    if (e.deletedAt) continue
    if (e.totalRevenue > 0) add(e.eventDate, e.totalRevenue)
  }
  for (const d of deliveries) {
    if (d.deletedAt) continue
    if (d.totalRevenue > 0) add(d.dropoffDate || d.datePrepared, d.totalRevenue)
  }
  // ApexCharts heatmap: series[].data[].{x, y}. One series per row (day-of-week).
  return days
    .slice()
    .reverse() // ApexCharts shows series top-to-bottom in order; reverse so Sat is top, Sun bottom (typical)
    .map((day) => ({
      name: day,
      data: months.map((m) => ({
        x: m,
        y: cells[day][m].count > 0 ? Math.round(cells[day][m].sum / cells[day][m].count) : 0,
      })),
    }))
}

interface AovPoint { period: string; eventAov: number; deliveryAov: number; date: number }
function aovTrend(events: Event[], deliveries: Delivery[]): AovPoint[] {
  const buckets = new Map<string, { eventRev: number; eventCount: number; delRev: number; delCount: number; date: number }>()
  const bucket = (dateStr: string) => {
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'))
    if (isNaN(d.getTime())) return null
    const m = d.toLocaleDateString('en-US', { month: 'short' }) + " '" + d.getFullYear().toString().slice(-2)
    if (!buckets.has(m)) buckets.set(m, { eventRev: 0, eventCount: 0, delRev: 0, delCount: 0, date: new Date(d.getFullYear(), d.getMonth(), 1).getTime() })
    return buckets.get(m)!
  }
  for (const e of events) {
    if (e.deletedAt || e.totalRevenue <= 0) continue
    const b = bucket(e.eventDate)
    if (b) { b.eventRev += e.totalRevenue; b.eventCount += 1 }
  }
  for (const d of deliveries) {
    if (d.deletedAt || d.totalRevenue <= 0) continue
    const b = bucket(d.dropoffDate || d.datePrepared)
    if (b) { b.delRev += d.totalRevenue; b.delCount += 1 }
  }
  return [...buckets.entries()]
    .map(([period, v]) => ({
      period,
      eventAov: v.eventCount > 0 ? v.eventRev / v.eventCount : 0,
      deliveryAov: v.delCount > 0 ? v.delRev / v.delCount : 0,
      date: v.date,
    }))
    .sort((a, b) => a.date - b.date)
}

interface CogsPoint { period: string; cogsPct: number; date: number }
function cogsTrend(events: Event[], deliveries: Delivery[]): CogsPoint[] {
  const buckets = new Map<string, { rev: number; cost: number; date: number }>()
  const bucket = (dateStr: string) => {
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'))
    if (isNaN(d.getTime())) return null
    const m = d.toLocaleDateString('en-US', { month: 'short' }) + " '" + d.getFullYear().toString().slice(-2)
    if (!buckets.has(m)) buckets.set(m, { rev: 0, cost: 0, date: new Date(d.getFullYear(), d.getMonth(), 1).getTime() })
    return buckets.get(m)!
  }
  for (const e of events) {
    if (e.deletedAt) continue
    const b = bucket(e.eventDate)
    if (b) { b.rev += e.totalRevenue; b.cost += e.totalCost }
  }
  for (const d of deliveries) {
    if (d.deletedAt) continue
    const b = bucket(d.dropoffDate || d.datePrepared)
    if (b) { b.rev += d.totalRevenue; b.cost += d.totalCogs }
  }
  return [...buckets.entries()]
    .map(([period, v]) => ({ period, cogsPct: v.rev > 0 ? (v.cost / v.rev) * 100 : 0, date: v.date }))
    .sort((a, b) => a.date - b.date)
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export const ExperimentalPage: FC<{
  events: Event[]
  deliveries: Delivery[]
  eventItems: EventItem[]
  deliveryItems: DeliveryItem[]
}> = ({ events, deliveries, eventItems, deliveryItems }) => {
  const flavors = aggregateByFlavor(eventItems, deliveryItems)
  const pareto = paretoByFlavor(flavors)
  const concentration = concentrationByStore(deliveries)
  const heatmap = dayMonthHeatmap(events, deliveries)
  const aov = aovTrend(events, deliveries)
  const cogs = cogsTrend(events, deliveries)

  // Quadrant scatter — split into 4 series so legend shows the matrix
  const medianMargin = flavors.length > 0 ? [...flavors].map((f) => f.margin).sort((a, b) => a - b)[Math.floor(flavors.length / 2)] : 0
  const medianVolume = flavors.length > 0 ? [...flavors].map((f) => f.sold).sort((a, b) => a - b)[Math.floor(flavors.length / 2)] : 0
  const quad = {
    stars: flavors.filter((f) => f.sold >= medianVolume && f.margin >= medianMargin).map((f) => ({ x: f.sold, y: Math.round(f.margin * 10) / 10, name: f.name })),
    cows: flavors.filter((f) => f.sold >= medianVolume && f.margin < medianMargin).map((f) => ({ x: f.sold, y: Math.round(f.margin * 10) / 10, name: f.name })),
    questions: flavors.filter((f) => f.sold < medianVolume && f.margin >= medianMargin).map((f) => ({ x: f.sold, y: Math.round(f.margin * 10) / 10, name: f.name })),
    dogs: flavors.filter((f) => f.sold < medianVolume && f.margin < medianMargin).map((f) => ({ x: f.sold, y: Math.round(f.margin * 10) / 10, name: f.name })),
  }

  const sellThrough = [...flavors].filter((f) => f.prepared > 0).sort((a, b) => a.sellThrough - b.sellThrough).slice(0, 15)

  const dataJson = JSON.stringify({
    quad, medianMargin, medianVolume,
    pareto: pareto.slice(0, 15),
    concentration,
    heatmap,
    aov,
    cogs,
    sellThrough: sellThrough.map((f) => ({ name: f.name, sellThrough: Math.round(f.sellThrough * 10) / 10, unsold: f.unsold, prepared: f.prepared })),
  })

  return (
    <Layout title="Experimental" active="experimental">
      <div class="space-y-6">
        <div>
          <h2 class="text-title-1 text-gray-900 dark:text-zinc-100">Experimental Analytics</h2>
          <p class="text-body text-gray-700 dark:text-zinc-300">Research-backed views for decision-making. Toggle / drill in.</p>
        </div>

        {/* Risk band */}
        <div class="grid grid-cols-3 gap-4" data-stagger>
          <ConcentrationCard label="Top Customer Share" pct={concentration.top1} risk={concentration.top1 > 25} />
          <ConcentrationCard label="Top 3 Customer Share" pct={concentration.top3} risk={concentration.top3 > 60} />
          <ConcentrationCard label="Top 5 Customer Share" pct={concentration.top5} risk={concentration.top5 > 80} />
        </div>

        {/* Row 1 — Flavor Quadrant + Pareto */}
        <div class="grid grid-cols-12 gap-4">
          <ChartCard
            class="col-span-7"
            title="Flavor Profitability Quadrant"
            subtitle={`Volume vs. margin. Median margin: ${medianMargin.toFixed(1)}%. Median volume: ${medianVolume}.`}
          >
            <div id="exp-quadrant" style="height: 360px;" />
          </ChartCard>
          <ChartCard
            class="col-span-5"
            title="Pareto Revenue Curve (80/20)"
            subtitle="Sorted desc. Vertical line marks 80% cumulative revenue."
          >
            <div id="exp-pareto" style="height: 360px;" />
          </ChartCard>
        </div>

        {/* Row 2 — Sell-through + Concentration */}
        <div class="grid grid-cols-12 gap-4">
          <ChartCard
            class="col-span-7"
            title="Lowest Sell-through (Highest Waste)"
            subtitle="% of prepared that actually sold. Bakery industry food-waste target: under 6%."
          >
            <div id="exp-sellthrough" style="height: 360px;" />
          </ChartCard>
          <ChartCard
            class="col-span-5"
            title="Customer Concentration"
            subtitle="Revenue share by store. Top 12 shown."
          >
            <div id="exp-concentration" style="height: 360px;" />
          </ChartCard>
        </div>

        {/* Row 3 — Heatmap */}
        <ChartCard title="Day-of-Week × Month Revenue Heatmap" subtitle="Average revenue per source. Identifies seasonal patterns and best-performing weekdays.">
          <div id="exp-heatmap" style="height: 280px;" />
        </ChartCard>

        {/* Row 4 — AOV + COGS */}
        <div class="grid grid-cols-12 gap-4">
          <ChartCard class="col-span-7" title="Average Order Value Trend" subtitle="Per-event AOV vs. per-delivery AOV over time.">
            <div id="exp-aov" style="height: 320px;" />
          </ChartCard>
          <ChartCard class="col-span-5" title="COGS % of Revenue" subtitle="Industry benchmark: keep under 85% (red zone).">
            <div id="exp-cogs" style="height: 320px;" />
          </ChartCard>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/apexcharts@5.12.0/dist/apexcharts.min.js"></script>
      <script id="experimental-data" type="application/json" dangerouslySetInnerHTML={{ __html: dataJson }} />
      <script dangerouslySetInnerHTML={{ __html: EXPERIMENTAL_SCRIPT }} />
    </Layout>
  )
}

const ChartCard: FC<{ title: string; subtitle?: string; class?: string; children?: unknown }> = ({ title, subtitle, class: cls = '', children }) => (
  <div class={`bg-white dark:bg-[#0a0a0a] rounded-3xl p-5 ${cls}`}>
    <div class="mb-3">
      <p class="text-headline text-gray-900 dark:text-zinc-100">{title}</p>
      {subtitle && <p class="text-caption text-gray-500 dark:text-zinc-500 mt-0.5">{subtitle}</p>}
    </div>
    {children as any}
  </div>
)

const ConcentrationCard: FC<{ label: string; pct: number; risk: boolean }> = ({ label, pct, risk }) => (
  <div class={`p-4 rounded-3xl border ${risk ? 'bg-red-50 border-red-100 dark:bg-red-950/40 dark:border-red-900/50' : 'bg-green-50 border-green-100 dark:bg-green-950/40 dark:border-green-900/50'}`}>
    <p class={`text-headline ${risk ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>{label}</p>
    <p class={`text-title-1 mt-1 count-up ${risk ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`} data-target={pct.toFixed(1)} data-format="percent" data-digits="1">0%</p>
    <p class={`text-callout mt-1 ${risk ? 'text-red-500 dark:text-red-400' : 'text-green-500 dark:text-green-400'}`}>
      {risk ? 'Concentration risk — diversify' : 'Healthy spread'}
    </p>
  </div>
)

// ─────────────────────────────────────────────────────────────────────────────
// Client script — instantiates all ApexCharts. Detects dark mode for theming.
// ─────────────────────────────────────────────────────────────────────────────

const EXPERIMENTAL_SCRIPT = `
(function(){
  var d = JSON.parse(document.getElementById('experimental-data').textContent);
  var isDark = function(){ return document.documentElement.classList.contains('dark'); };
  var pink = '#ec4899'; var green = '#22c55e'; var amber = '#f59e0b'; var red = '#ef4444'; var blue = '#3b82f6';
  var grid = function(){ return isDark() ? '#1f1f1f' : '#e5e7eb'; };
  var label = function(){ return isDark() ? '#ededed' : '#0a0a0a'; };

  var common = function(){
    return {
      chart: {
        toolbar: { show: false },
        zoom: { enabled: false },
        background: 'transparent',
        animations: { enabled: true, speed: 400 },
        fontFamily: 'Geist Variable, system-ui, sans-serif',
      },
      theme: { mode: isDark() ? 'dark' : 'light' },
      grid: { borderColor: grid(), strokeDashArray: 3 },
      tooltip: { theme: isDark() ? 'dark' : 'light' },
      xaxis: { labels: { style: { colors: label() } } },
      yaxis: { labels: { style: { colors: label() } } },
    };
  };

  // ─── Quadrant scatter ───────────────────────────────────────────────────
  var quadOptions = Object.assign({}, common(), {
    chart: Object.assign({ type: 'scatter', height: 360 }, common().chart),
    series: [
      { name: '⭐ Stars (high vol + margin)', data: d.quad.stars },
      { name: '🐮 Cash Cows (high vol, low margin)', data: d.quad.cows },
      { name: '❓ Question Marks (low vol, high margin)', data: d.quad.questions },
      { name: '🐶 Dogs (low vol + margin)', data: d.quad.dogs },
    ],
    colors: [green, blue, amber, red],
    markers: { size: 8, strokeColors: 'transparent', hover: { size: 11 } },
    xaxis: Object.assign({}, common().xaxis, {
      type: 'numeric',
      title: { text: 'Units Sold', style: { color: label() } },
      tickAmount: 6,
    }),
    yaxis: Object.assign({}, common().yaxis, {
      title: { text: 'Profit Margin %', style: { color: label() } },
      labels: { style: { colors: label() }, formatter: function(v){ return v.toFixed(0) + '%'; } },
    }),
    tooltip: Object.assign({}, common().tooltip, {
      custom: function(o){
        var p = o.w.config.series[o.seriesIndex].data[o.dataPointIndex];
        return '<div style="padding:8px 12px;font-family:inherit"><strong>' + (p.name||'') + '</strong><br/>' + p.x + ' sold · ' + p.y + '% margin</div>';
      },
    }),
    annotations: {
      xaxis: [{ x: d.medianVolume, borderColor: grid(), strokeDashArray: 4 }],
      yaxis: [{ y: d.medianMargin, borderColor: grid(), strokeDashArray: 4 }],
    },
    legend: { position: 'top', horizontalAlign: 'left', labels: { colors: label() } },
  });
  new ApexCharts(document.getElementById('exp-quadrant'), quadOptions).render();

  // ─── Pareto ────────────────────────────────────────────────────────────
  var paretoOpts = Object.assign({}, common(), {
    chart: Object.assign({ type: 'line', height: 360 }, common().chart),
    series: [
      { name: 'Revenue', type: 'column', data: d.pareto.map(function(p){return p.revenue;}) },
      { name: 'Cumulative %', type: 'line', data: d.pareto.map(function(p){return Math.round(p.cumPct);}) },
    ],
    colors: [pink, blue],
    stroke: { width: [0, 3], curve: 'straight' },
    plotOptions: { bar: { borderRadius: 4, columnWidth: '60%' } },
    xaxis: Object.assign({}, common().xaxis, {
      categories: d.pareto.map(function(p){return p.name;}),
      labels: { style: { colors: label(), fontSize: '10px' }, rotate: -45, hideOverlappingLabels: false },
    }),
    yaxis: [
      Object.assign({}, common().yaxis, { title: { text: 'Revenue ($)', style: { color: label() } }, labels: { style: { colors: label() }, formatter: function(v){ return '$' + Math.round(v); } } }),
      Object.assign({}, common().yaxis, { opposite: true, max: 100, min: 0, title: { text: 'Cumulative %', style: { color: label() } }, labels: { style: { colors: label() }, formatter: function(v){ return v + '%'; } } }),
    ],
    annotations: { yaxis: [{ y: 80, yAxisIndex: 1, borderColor: red, strokeDashArray: 4, label: { borderColor: red, style: { color: '#fff', background: red }, text: '80%' } }] },
    legend: { labels: { colors: label() } },
  });
  new ApexCharts(document.getElementById('exp-pareto'), paretoOpts).render();

  // ─── Sell-through (lowest = worst) ─────────────────────────────────────
  var stOpts = Object.assign({}, common(), {
    chart: Object.assign({ type: 'bar', height: 360 }, common().chart),
    series: [{ name: 'Sell-through %', data: d.sellThrough.map(function(f){ return f.sellThrough; }) }],
    colors: [function(o){ var v = o.value; return v < 50 ? red : v < 75 ? amber : v < 90 ? blue : green; }],
    plotOptions: { bar: { horizontal: true, borderRadius: 6, distributed: false, dataLabels: { position: 'top' } } },
    dataLabels: {
      enabled: true,
      formatter: function(v){ return v.toFixed(0) + '%'; },
      offsetX: 30,
      style: { colors: [label()], fontWeight: 500 },
    },
    xaxis: Object.assign({}, common().xaxis, {
      categories: d.sellThrough.map(function(f){return f.name;}),
      max: 100,
      labels: { style: { colors: label() }, formatter: function(v){ return v + '%'; } },
    }),
    yaxis: Object.assign({}, common().yaxis, { labels: { style: { colors: label(), fontSize: '11px' } } }),
    tooltip: Object.assign({}, common().tooltip, {
      custom: function(o){
        var f = d.sellThrough[o.dataPointIndex];
        return '<div style="padding:8px 12px"><strong>' + f.name + '</strong><br/>' + f.sellThrough + '% sell-through<br/>' + f.unsold + ' unsold of ' + f.prepared + '</div>';
      },
    }),
  });
  new ApexCharts(document.getElementById('exp-sellthrough'), stOpts).render();

  // ─── Concentration ─────────────────────────────────────────────────────
  var concOpts = Object.assign({}, common(), {
    chart: Object.assign({ type: 'bar', height: 360 }, common().chart),
    series: [{ name: 'Revenue Share', data: d.concentration.stores.map(function(s){ return Math.round(s.pct * 10) / 10; }) }],
    colors: [pink],
    plotOptions: { bar: { horizontal: true, borderRadius: 6 } },
    dataLabels: { enabled: true, formatter: function(v){ return v + '%'; }, offsetX: 30, style: { colors: [label()] } },
    xaxis: Object.assign({}, common().xaxis, {
      categories: d.concentration.stores.map(function(s){ return s.name; }),
      labels: { style: { colors: label() }, formatter: function(v){ return v + '%'; } },
    }),
    yaxis: Object.assign({}, common().yaxis, { labels: { style: { colors: label(), fontSize: '11px' } } }),
  });
  new ApexCharts(document.getElementById('exp-concentration'), concOpts).render();

  // ─── Heatmap ───────────────────────────────────────────────────────────
  var hmOpts = Object.assign({}, common(), {
    chart: Object.assign({ type: 'heatmap', height: 280 }, common().chart),
    series: d.heatmap,
    colors: [pink],
    plotOptions: { heatmap: { radius: 4, enableShades: true, shadeIntensity: 0.6, useFillColorAsStroke: false, colorScale: { ranges: [
      { from: 0, to: 0, name: 'no data', color: isDark() ? '#171717' : '#f3f4f6' },
      { from: 1, to: 100, name: 'low', color: '#fce7f3' },
      { from: 101, to: 300, name: 'mid', color: '#f9a8d4' },
      { from: 301, to: 600, name: 'high', color: '#ec4899' },
      { from: 601, to: 10000, name: 'very high', color: '#9d174d' },
    ] } } },
    dataLabels: { enabled: false },
    tooltip: Object.assign({}, common().tooltip, {
      y: { formatter: function(v){ return v === 0 ? 'no data' : '$' + v + ' avg'; } },
    }),
  });
  new ApexCharts(document.getElementById('exp-heatmap'), hmOpts).render();

  // ─── AOV ───────────────────────────────────────────────────────────────
  var aovOpts = Object.assign({}, common(), {
    chart: Object.assign({ type: 'line', height: 320 }, common().chart),
    series: [
      { name: 'Event AOV', data: d.aov.map(function(p){ return Math.round(p.eventAov); }) },
      { name: 'Delivery AOV', data: d.aov.map(function(p){ return Math.round(p.deliveryAov); }) },
    ],
    colors: [pink, green],
    stroke: { curve: 'smooth', width: 3 },
    markers: { size: 4 },
    xaxis: Object.assign({}, common().xaxis, { categories: d.aov.map(function(p){return p.period;}) }),
    yaxis: Object.assign({}, common().yaxis, { labels: { style: { colors: label() }, formatter: function(v){ return '$' + v; } } }),
    legend: { labels: { colors: label() } },
  });
  new ApexCharts(document.getElementById('exp-aov'), aovOpts).render();

  // ─── COGS ──────────────────────────────────────────────────────────────
  var cogsOpts = Object.assign({}, common(), {
    chart: Object.assign({ type: 'area', height: 320 }, common().chart),
    series: [{ name: 'COGS %', data: d.cogs.map(function(p){ return Math.round(p.cogsPct * 10) / 10; }) }],
    colors: [amber],
    stroke: { curve: 'smooth', width: 3 },
    fill: { type: 'gradient', gradient: { shadeIntensity: 0.4, opacityFrom: 0.4, opacityTo: 0 } },
    xaxis: Object.assign({}, common().xaxis, { categories: d.cogs.map(function(p){return p.period;}) }),
    yaxis: Object.assign({}, common().yaxis, { labels: { style: { colors: label() }, formatter: function(v){ return v + '%'; } } }),
    annotations: { yaxis: [{ y: 85, borderColor: red, strokeDashArray: 4, label: { borderColor: red, style: { color: '#fff', background: red }, text: 'Danger 85%' } }] },
  });
  new ApexCharts(document.getElementById('exp-cogs'), cogsOpts).render();
})();
`
