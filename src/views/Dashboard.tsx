import type { FC } from 'hono/jsx'
import { Layout } from './Layout.js'
import type { Event } from './Events.js'
import type { Delivery } from './Deliveries.js'

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface FlavorItem {
  flavorName: string
  prepared: number | null
}

interface MonthlyTrendPoint {
  month: string
  revenue: number
  profit: number
  count: number
}

interface AggregatedEntry {
  name: string
  totalRevenue: number
  totalProfit: number
  avgRevenue: number
  avgProfit: number
  count: number
}

interface MarginEntry {
  name: string
  fullName: string
  margin: number
  count?: number
}

interface DayOfWeekEntry {
  day: string
  revenue: number
  profit: number
  avgRevenue: number
  avgProfit: number
  count: number
}

const CHART_PINK = '#ec4899'

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)

// ────────────────────────────────────────────────────────────────────────────
// DashboardPage — server-rendered, all aggregations identical to web-b
// ────────────────────────────────────────────────────────────────────────────

export const DashboardPage: FC<{
  events: Event[]
  deliveries: Delivery[]
  eventItems: FlavorItem[]
  deliveryItems: FlavorItem[]
}> = ({ events, deliveries: rawDeliveries, eventItems, deliveryItems }) => {
  // Filter out archived deliveries (mirror web-b line 125)
  const deliveries = rawDeliveries.filter((d) => !d.deletedAt)

  // Total cookies made: batch flavors count as 15, everything else as 1
  const totalCookiesMade = (() => {
    const all = [...eventItems, ...deliveryItems]
    let sum = 0
    for (const it of all) {
      const isBatch = it.flavorName.toLowerCase().includes('batch')
      sum += (it.prepared ?? 0) * (isBatch ? 15 : 1)
    }
    return sum
  })()

  // Filter events with actual sales
  const eventsWithSales = events.filter((e) => e.totalSold > 0)
  const deliveriesWithRevenue = deliveries.filter((d) => d.totalRevenue > 0)

  // Aggregate stats
  const eventRevenue = events.reduce((sum, e) => sum + e.totalRevenue, 0)
  const deliveryRevenue = deliveries.reduce((sum, d) => sum + d.totalRevenue, 0)
  const totalRevenue = eventRevenue + deliveryRevenue

  const eventProfit = events.reduce((sum, e) => sum + e.netProfit, 0)
  const deliveryProfit = deliveries.reduce((sum, d) => sum + d.grossProfit, 0)
  const totalProfit = eventProfit + deliveryProfit

  const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
  const totalSources = eventsWithSales.length + deliveriesWithRevenue.length

  // ── Monthly revenue trend ──
  const allMonthKeys = new Set<string>()
  const addToMonthly = (
    acc: Record<string, { revenue: number; profit: number; count: number }>,
    dateStr: string,
    revenue: number,
    profit: number,
  ) => {
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'))
    const month =
      d.toLocaleDateString('en-US', { month: 'short' }) +
      " '" +
      d.getFullYear().toString().slice(-2)
    allMonthKeys.add(month)
    if (!acc[month]) acc[month] = { revenue: 0, profit: 0, count: 0 }
    acc[month].revenue += revenue
    acc[month].profit += profit
    acc[month].count += 1
    return acc
  }
  const monthlyData: Record<string, { revenue: number; profit: number; count: number }> = {}
  eventsWithSales.forEach((e) => addToMonthly(monthlyData, e.eventDate, e.totalRevenue, e.netProfit))
  deliveriesWithRevenue.forEach((d) =>
    addToMonthly(monthlyData, d.dropoffDate || d.datePrepared, d.totalRevenue, d.grossProfit),
  )
  const monthOrder = [...allMonthKeys].sort((a, b) => {
    const parse = (m: string) => {
      const [mon, yr] = m.split(" '")
      return new Date(`${mon} 1, 20${yr}`).getTime()
    }
    return parse(a) - parse(b)
  })
  const monthlyTrend: MonthlyTrendPoint[] = monthOrder.map((month) => ({
    month,
    revenue: monthlyData[month]?.revenue || 0,
    profit: monthlyData[month]?.profit || 0,
    count: monthlyData[month]?.count || 0,
  }))

  // ── Aggregated events ──
  const aggregatedEvents: AggregatedEntry[] = Object.entries(
    eventsWithSales.reduce<Record<string, { totalRevenue: number; totalProfit: number; count: number }>>(
      (acc, e) => {
        if (!acc[e.name]) acc[e.name] = { totalRevenue: 0, totalProfit: 0, count: 0 }
        acc[e.name].totalRevenue += e.totalRevenue
        acc[e.name].totalProfit += e.netProfit
        acc[e.name].count += 1
        return acc
      },
      {},
    ),
  ).map(([name, data]) => ({
    name,
    totalRevenue: data.totalRevenue,
    totalProfit: data.totalProfit,
    avgRevenue: data.count > 0 ? data.totalRevenue / data.count : 0,
    avgProfit: data.count > 0 ? data.totalProfit / data.count : 0,
    count: data.count,
  }))

  // ── Aggregated stores ──
  const aggregatedStores: AggregatedEntry[] = Object.entries(
    deliveriesWithRevenue.reduce<Record<string, { totalRevenue: number; totalProfit: number; count: number }>>(
      (acc, d) => {
        if (!acc[d.storeName]) acc[d.storeName] = { totalRevenue: 0, totalProfit: 0, count: 0 }
        acc[d.storeName].totalRevenue += d.totalRevenue
        acc[d.storeName].totalProfit += d.grossProfit
        acc[d.storeName].count += 1
        return acc
      },
      {},
    ),
  ).map(([name, data]) => ({
    name,
    totalRevenue: data.totalRevenue,
    totalProfit: data.totalProfit,
    avgRevenue: data.count > 0 ? data.totalRevenue / data.count : 0,
    avgProfit: data.count > 0 ? data.totalProfit / data.count : 0,
    count: data.count,
  }))

  // ── Margin by event ──
  const marginByEvent: MarginEntry[] = Object.entries(
    eventsWithSales.reduce<Record<string, { totalRevenue: number; totalProfit: number; count: number }>>(
      (acc, e) => {
        if (!acc[e.name]) acc[e.name] = { totalRevenue: 0, totalProfit: 0, count: 0 }
        acc[e.name].totalRevenue += e.totalRevenue
        acc[e.name].totalProfit += e.netProfit
        acc[e.name].count += 1
        return acc
      },
      {},
    ),
  )
    .map(([name, data]) => ({
      name,
      fullName: name,
      margin: data.totalRevenue > 0 ? (data.totalProfit / data.totalRevenue) * 100 : 0,
      count: data.count,
    }))
    .sort((a, b) => a.margin - b.margin)

  // ── Margin by store ──
  const marginByStore: MarginEntry[] = Object.entries(
    deliveriesWithRevenue.reduce<Record<string, { totalRevenue: number; totalProfit: number }>>((acc, d) => {
      if (!acc[d.storeName]) acc[d.storeName] = { totalRevenue: 0, totalProfit: 0 }
      acc[d.storeName].totalRevenue += d.totalRevenue
      acc[d.storeName].totalProfit += d.grossProfit
      return acc
    }, {}),
  )
    .map(([name, data]) => ({
      name,
      fullName: name,
      margin: data.totalRevenue > 0 ? (data.totalProfit / data.totalRevenue) * 100 : 0,
    }))
    .sort((a, b) => a.margin - b.margin)

  const allMargins = [...marginByEvent.map((e) => e.margin), ...marginByStore.map((s) => s.margin)]
  // Snap to multiples of 5 so Chart.js draws clean tick stops (no 66.473333…%).
  const minMargin = allMargins.length > 0 ? Math.floor((Math.min(...allMargins) - 3) / 5) * 5 : 0
  const maxMargin = allMargins.length > 0 ? Math.ceil((Math.max(...allMargins) + 3) / 5) * 5 : 100

  // ── Revenue by day of week ──
  const dayOfWeekData: Record<string, { revenue: number; profit: number; count: number }> = {}
  const addToDay = (dateStr: string, revenue: number, profit: number) => {
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'))
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long' })
    if (!dayOfWeekData[dayName]) dayOfWeekData[dayName] = { revenue: 0, profit: 0, count: 0 }
    dayOfWeekData[dayName].revenue += revenue
    dayOfWeekData[dayName].profit += profit
    dayOfWeekData[dayName].count += 1
  }
  eventsWithSales.forEach((e) => addToDay(e.eventDate, e.totalRevenue, e.netProfit))
  deliveriesWithRevenue.forEach((d) =>
    addToDay(d.dropoffDate || d.datePrepared, d.totalRevenue, d.grossProfit),
  )
  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const revenueByDay: DayOfWeekEntry[] = dayOrder.map((day) => ({
    day,
    revenue: dayOfWeekData[day]?.revenue || 0,
    profit: dayOfWeekData[day]?.profit || 0,
    avgRevenue: dayOfWeekData[day] ? dayOfWeekData[day].revenue / dayOfWeekData[day].count : 0,
    avgProfit: dayOfWeekData[day] ? dayOfWeekData[day].profit / dayOfWeekData[day].count : 0,
    count: dayOfWeekData[day]?.count || 0,
  }))

  // Serialized data for client-side Chart.js
  const chartData = JSON.stringify({
    monthlyTrend,
    revenueByDay,
    marginByEvent,
    marginByStore,
    minMargin,
    maxMargin,
    aggregatedEvents,
    aggregatedStores,
  })

  return (
    <Layout title="Dashboard" active="home">
      <div class="space-y-6">
        {/* Header */}
        <div>
          <h2 class="text-title-2 text-gray-900 dark:text-zinc-100">Welcome to Your Dashboard</h2>
          <p class="text-body text-gray-700 dark:text-zinc-300">Overview of Your Business Performance</p>
        </div>

        {/* Bento Grid */}
        <div class="space-y-8">
          {/* Row 1 — Stats */}
          <div class="grid grid-cols-12 gap-4" style="height: 120px;" data-stagger>
            {/* Total Revenue */}
            <div class="col-span-5 row-span-1 bg-gradient-to-br from-pink-500 to-pink-600 rounded-3xl p-5 text-white flex items-center justify-between">
              <div>
                <p class="text-pink-100 text-headline">Total Revenue</p>
                <p class="text-title-1 num mt-1">{formatCurrency(totalRevenue)}</p>
                <p class="text-pink-200 text-callout mt-1">
                  From {eventsWithSales.length} events and {deliveriesWithRevenue.length} deliveries
                </p>
              </div>
              <div class="text-right">
                <p class="text-title-3">{formatCurrency(totalRevenue / (totalSources || 1))}</p>
                <p class="text-pink-200 text-callout">avg per source</p>
              </div>
            </div>

            {/* Total Profit */}
            <div class="col-span-3 row-span-1 bg-green-50 dark:bg-green-950/40 rounded-3xl p-4 flex flex-col justify-center">
              <p class="text-headline text-green-600 dark:text-green-400 ">Total Profit</p>
              <p class="text-title-1 num text-green-600 dark:text-green-400 mt-1">{formatCurrency(totalProfit)}</p>
              <p class="text-callout text-green-500 dark:text-green-400 mt-1">
                {formatCurrency(totalProfit / (totalSources || 1))} avg
              </p>
            </div>

            {/* Profit Margin — liquid glass */}
            <div class="col-span-2 row-span-1 bg-amber-50 dark:bg-amber-950/40 rounded-3xl p-4 flex flex-col justify-center">
              <p class="text-headline text-amber-700 dark:text-amber-400">Profit Margin</p>
              <p class="text-title-1 num text-amber-700 dark:text-amber-400 mt-1">{profitMargin.toFixed(1)}%</p>
              <p class="text-callout text-amber-600 dark:text-amber-400/70 mt-1">overall</p>
            </div>

            {/* Cookies Made */}
            <div class="col-span-2 row-span-1 bg-blue-50 dark:bg-blue-950/40 rounded-3xl p-4 flex flex-col justify-center">
              <p class="text-headline text-blue-600 dark:text-blue-400 ">Cookies Made</p>
              <p class="text-title-1 num text-blue-600 dark:text-blue-400 mt-1">
                {Math.round(totalCookiesMade).toLocaleString()}
              </p>
              <p class="text-callout text-blue-500 dark:text-blue-400 mt-1">all-time</p>
            </div>
          </div>

          {/* Row 2 — Charts & Lists */}
          <div class="flex gap-4" style="height: 280px;">
            {/* Revenue Chart - Monthly / By Day toggle */}
            <div
              class="bg-white dark:bg-[#0a0a0a] rounded-3xl p-5"
              style="width: 40%;"
            >
              <div class="flex items-center justify-between mb-3">
                <p
                  id="revenue-chart-title"
                  class="text-headline text-gray-900 dark:text-zinc-100 "
                >
                  Monthly Revenue & Profit
                </p>
                <div class="flex bg-gray-100 dark:bg-[#1f1f1f] rounded-lg p-0.5">
                  <button
                    type="button"
                    data-revenue-view="monthly"
                    class="msc-revenue-toggle relative px-3 py-1 text-button-sm rounded-md transition-colors bg-white shadow-sm dark:bg-[#0a0a0a] text-gray-900 dark:text-zinc-100"
                  >
                    <span class="relative">Monthly</span>
                  </button>
                  <button
                    type="button"
                    data-revenue-view="daily"
                    class="msc-revenue-toggle relative px-3 py-1 text-button-sm rounded-md transition-colors text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-400"
                  >
                    <span class="relative">By Day</span>
                  </button>
                </div>
              </div>
              <div class="relative" style="height: 220px;">
                <canvas id="revenue-monthly-chart" class="msc-revenue-canvas absolute inset-0 w-full h-full"></canvas>
                <canvas id="revenue-daily-chart" class="msc-revenue-canvas absolute inset-0 w-full h-full hidden"></canvas>
              </div>
            </div>

            {/* Top Events */}
            <div
              class="bg-white dark:bg-[#0a0a0a] rounded-3xl p-5 flex flex-col"
              style="width: 30%;"
            >
              <div class="flex items-center justify-between mb-3">
                <p class="text-headline text-gray-900 dark:text-zinc-100 ">Top Events</p>
                <div class="flex gap-1">
                  <div class="flex bg-gray-100 dark:bg-[#1f1f1f] rounded-lg p-0.5">
                    <button
                      type="button"
                      data-events-agg="total"
                      class="msc-events-agg relative px-2 py-1 text-button-sm rounded-md transition-colors bg-white shadow-sm dark:bg-[#0a0a0a] text-gray-900 dark:text-zinc-100"
                    >
                      <span class="relative">Total</span>
                    </button>
                    <button
                      type="button"
                      data-events-agg="average"
                      class="msc-events-agg relative px-2 py-1 text-button-sm rounded-md transition-colors text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-400"
                    >
                      <span class="relative">Average</span>
                    </button>
                  </div>
                  <div class="flex bg-gray-100 dark:bg-[#1f1f1f] rounded-lg p-0.5">
                    <button
                      type="button"
                      data-events-metric="revenue"
                      class="msc-events-metric relative px-2 py-1 text-button-sm rounded-md transition-colors bg-white shadow-sm dark:bg-[#0a0a0a] text-gray-900 dark:text-zinc-100"
                    >
                      <span class="relative">Revenue</span>
                    </button>
                    <button
                      type="button"
                      data-events-metric="profit"
                      class="msc-events-metric relative px-2 py-1 text-button-sm rounded-md transition-colors text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-400"
                    >
                      <span class="relative">Profit</span>
                    </button>
                  </div>
                </div>
              </div>
              <div id="events-list" class="space-y-3.5 mt-auto"></div>
            </div>

            {/* Top Stores */}
            <div
              class="bg-white dark:bg-[#0a0a0a] rounded-3xl p-5 flex flex-col"
              style="width: 30%;"
            >
              <div class="flex items-center justify-between mb-3">
                <p class="text-headline text-gray-900 dark:text-zinc-100 ">Top Stores</p>
                <div class="flex gap-1">
                  <div class="flex bg-gray-100 dark:bg-[#1f1f1f] rounded-lg p-0.5">
                    <button
                      type="button"
                      data-stores-agg="total"
                      class="msc-stores-agg relative px-2 py-1 text-button-sm rounded-md transition-colors bg-white shadow-sm dark:bg-[#0a0a0a] text-gray-900 dark:text-zinc-100"
                    >
                      <span class="relative">Total</span>
                    </button>
                    <button
                      type="button"
                      data-stores-agg="average"
                      class="msc-stores-agg relative px-2 py-1 text-button-sm rounded-md transition-colors text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-400"
                    >
                      <span class="relative">Average</span>
                    </button>
                  </div>
                  <div class="flex bg-gray-100 dark:bg-[#1f1f1f] rounded-lg p-0.5">
                    <button
                      type="button"
                      data-stores-metric="revenue"
                      class="msc-stores-metric relative px-2 py-1 text-button-sm rounded-md transition-colors bg-white shadow-sm dark:bg-[#0a0a0a] text-gray-900 dark:text-zinc-100"
                    >
                      <span class="relative">Revenue</span>
                    </button>
                    <button
                      type="button"
                      data-stores-metric="profit"
                      class="msc-stores-metric relative px-2 py-1 text-button-sm rounded-md transition-colors text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-400"
                    >
                      <span class="relative">Profit</span>
                    </button>
                  </div>
                </div>
              </div>
              <div id="stores-list" class="space-y-3.5 mt-auto"></div>
            </div>
          </div>

          {/* Row 3 — Profit Margins */}
          <div class="flex gap-4" style="height: 320px;">
            <div
              class="bg-white dark:bg-[#0a0a0a] rounded-3xl px-5 pt-4 pb-2"
              style="width: 50%;"
            >
              <p class="text-headline text-gray-900 dark:text-zinc-100  mb-1">
                Profit Margin by Event
              </p>
              <div style="height: 270px;">
                <canvas id="margin-event-chart"></canvas>
              </div>
            </div>
            <div
              class="bg-white dark:bg-[#0a0a0a] rounded-3xl px-5 pt-4 pb-2"
              style="width: 50%;"
            >
              <p class="text-headline text-gray-900 dark:text-zinc-100  mb-1">
                Profit Margin by Store
              </p>
              <div style="height: 270px;">
                <canvas id="margin-store-chart"></canvas>
              </div>
            </div>
          </div>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7"></script>
      <script id="dashboard-data" type="application/json" dangerouslySetInnerHTML={{ __html: chartData }} />
      <script
        dangerouslySetInnerHTML={{
          __html: `
(function(){
  var D = JSON.parse(document.getElementById('dashboard-data').textContent);
  var CHART_PINK = '${CHART_PINK}';
  var CHART_GREEN = '#22c55e';
  var fgMuted = getComputedStyle(document.documentElement).getPropertyValue('--fg-muted').trim() || '#6b7280';
  var grid = 'rgba(120,120,120,0.15)';
  var isDark = function(){ return document.documentElement.classList.contains('dark'); };

  function fmtUSD(v){
    return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
  }
  function tickFontOpts(){ return { font: { size: 11 }, color: fgMuted }; }

  // Solid (non-transparent) tooltip styling — matches the app's card surfaces.
  function tooltipStyle(){
    return {
      backgroundColor: isDark() ? '#0a0a0a' : '#ffffff',
      titleColor:      isDark() ? '#ededed' : '#0a0a0a',
      bodyColor:       isDark() ? '#ededed' : '#0a0a0a',
      borderColor:     isDark() ? '#262626' : '#e5e7eb',
      borderWidth: 1,
      cornerRadius: 8,
      padding: 10,
      titleFont: { weight: '600', size: 12 },
      bodyFont: { size: 12 },
      displayColors: true,
      boxPadding: 6,
    };
  }

  // ── Monthly chart (AreaChart equivalent: filled line + line) ──
  // Crosshair plugin — vertical dashed line at the hovered x.
  var crosshair = {
    id: 'crosshair',
    afterDatasetsDraw: function(chart){
      var active = chart.tooltip && chart.tooltip.getActiveElements && chart.tooltip.getActiveElements();
      if(!active || active.length === 0) return;
      var ctx = chart.ctx;
      var x = active[0].element.x;
      var area = chart.chartArea;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, area.top);
      ctx.lineTo(x, area.bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(236,72,153,0.55)';
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();
    }
  };
  var monthlyCanvas = document.getElementById('revenue-monthly-chart');
  monthlyCanvas.style.cursor = 'crosshair';
  new Chart(monthlyCanvas.getContext('2d'), {
    type: 'line',
    plugins: [crosshair],
    data: {
      labels: D.monthlyTrend.map(function(p){return p.month;}),
      datasets: [
        {
          label: 'Revenue',
          data: D.monthlyTrend.map(function(p){return p.revenue;}),
          borderColor: CHART_PINK,
          backgroundColor: 'rgba(236,72,153,0.18)',
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4
        },
        {
          label: 'Profit',
          data: D.monthlyTrend.map(function(p){return p.profit;}),
          borderColor: CHART_GREEN,
          backgroundColor: 'transparent',
          borderWidth: 2,
          fill: false,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: CHART_GREEN
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 4, left: 0, top: 4, bottom: 0 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: Object.assign(tooltipStyle(), {
          callbacks: {
            label: function(ctx){ return ctx.dataset.label + ': ' + fmtUSD(ctx.parsed.y); }
          }
        })
      },
      scales: {
        x: { grid: { color: grid, drawBorder: false }, ticks: tickFontOpts(), offset: false, alignToPixels: true },
        y: {
          grid: { color: grid, drawBorder: false },
          ticks: Object.assign({ callback: function(v){ return '$'+v; } }, tickFontOpts())
        }
      }
    }
  });

  // ── Daily / By-Day-of-Week (Bar chart) ──
  new Chart(document.getElementById('revenue-daily-chart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: D.revenueByDay.map(function(d){return d.day;}),
      datasets: [
        {
          label: 'Revenue',
          data: D.revenueByDay.map(function(d){return d.avgRevenue;}),
          backgroundColor: CHART_PINK,
          borderRadius: 4,
          borderSkipped: false
        },
        {
          label: 'Profit',
          data: D.revenueByDay.map(function(d){return d.avgProfit;}),
          backgroundColor: CHART_GREEN,
          borderRadius: 4,
          borderSkipped: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: Object.assign(tooltipStyle(), {
          callbacks: {
            title: function(items){
              var lbl = items[0].label;
              var d = D.revenueByDay[items[0].dataIndex];
              if (!d) return lbl;
              return lbl + ' (' + d.count + ' source' + (d.count !== 1 ? 's' : '') + ')';
            },
            label: function(ctx){ return ctx.dataset.label + ': ' + fmtUSD(ctx.parsed.y); }
          }
        })
      },
      scales: {
        x: { grid: { display: false, drawBorder: false }, ticks: tickFontOpts() },
        y: {
          grid: { color: grid, drawBorder: false },
          ticks: Object.assign({ callback: function(v){ return '$'+v; } }, tickFontOpts())
        }
      }
    }
  });

  // Word-wrap labels into multi-line arrays (Chart.js renders each inner array
  // as stacked lines). Wraps at ~10 chars/line, preserves words.
  function wrapLabel(s){
    var words = String(s).split(' '), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if ((cur + ' ' + w).trim().length > 10 && cur) { lines.push(cur.trim()); cur = w; }
      else { cur += ' ' + w; }
    }
    if (cur.trim()) lines.push(cur.trim());
    return lines.slice(0, 3); // cap at 3 lines to avoid runaway height
  }

  // ── Profit Margin by Event ──
  var marginEventCanvas = document.getElementById('margin-event-chart');
  marginEventCanvas.style.cursor = 'crosshair';
  new Chart(marginEventCanvas.getContext('2d'), {
    type: 'line',
    plugins: [crosshair],
    data: {
      labels: D.marginByEvent.map(function(e){return wrapLabel(e.name);}),
      datasets: [{
        label: 'Margin',
        data: D.marginByEvent.map(function(e){return e.margin;}),
        borderColor: CHART_PINK,
        backgroundColor: 'transparent',
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: CHART_PINK,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: Object.assign(tooltipStyle(), {
          callbacks: {
            title: function(items){
              var lbl = items[0].label;
              var e = D.marginByEvent[items[0].dataIndex];
              return e ? (e.fullName + ' (' + e.count + 'x)') : lbl;
            },
            label: function(ctx){ return 'Margin: ' + ctx.parsed.y.toFixed(1) + '%'; }
          }
        })
      },
      scales: {
        x: {
          grid: { color: grid, drawBorder: false },
          ticks: Object.assign({ autoSkip: false, maxRotation: 0, minRotation: 0 }, tickFontOpts())
        },
        y: {
          min: D.minMargin,
          max: D.maxMargin,
          grid: { color: grid, drawBorder: false },
          ticks: Object.assign({ callback: function(v){ return Math.round(v) + '%'; } }, tickFontOpts())
        }
      }
    }
  });

  // ── Profit Margin by Store ──
  var marginStoreCanvas = document.getElementById('margin-store-chart');
  marginStoreCanvas.style.cursor = 'crosshair';
  new Chart(marginStoreCanvas.getContext('2d'), {
    type: 'line',
    plugins: [crosshair],
    data: {
      labels: D.marginByStore.map(function(s){return wrapLabel(s.name);}),
      datasets: [{
        label: 'Margin',
        data: D.marginByStore.map(function(s){return s.margin;}),
        borderColor: CHART_GREEN,
        backgroundColor: 'transparent',
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: CHART_GREEN,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: Object.assign(tooltipStyle(), {
          callbacks: {
            label: function(ctx){ return 'Margin: ' + ctx.parsed.y.toFixed(1) + '%'; }
          }
        })
      },
      scales: {
        x: {
          grid: { color: grid, drawBorder: false },
          ticks: Object.assign({ autoSkip: false, maxRotation: 0, minRotation: 0 }, tickFontOpts())
        },
        y: {
          min: D.minMargin,
          max: D.maxMargin,
          grid: { color: grid, drawBorder: false },
          ticks: Object.assign({ callback: function(v){ return Math.round(v) + '%'; } }, tickFontOpts())
        }
      }
    }
  });

  // ──────────────────────────────────────────────────────────────
  // Toggle state + list rendering (mirror web-b useState behaviour)
  // ──────────────────────────────────────────────────────────────
  var state = {
    revenueView: 'monthly',   // 'monthly' | 'daily'
    eventsAgg: 'total',       // 'total' | 'average'
    eventsMetric: 'revenue',  // 'revenue' | 'profit'
    storesAgg: 'total',
    storesMetric: 'revenue'
  };

  var ACTIVE_CLS = 'bg-white shadow-sm dark:bg-[#0a0a0a] text-gray-900 dark:text-zinc-100';
  var INACTIVE_CLS = 'text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-400';

  function setBtnStyles(btns, attr, value){
    btns.forEach(function(b){
      var active = b.getAttribute(attr) === value;
      // strip previous combined classes
      ACTIVE_CLS.split(' ').forEach(function(c){ b.classList.remove(c); });
      INACTIVE_CLS.split(' ').forEach(function(c){ b.classList.remove(c); });
      (active ? ACTIVE_CLS : INACTIVE_CLS).split(' ').forEach(function(c){ b.classList.add(c); });
    });
  }

  function refreshRevenueView(){
    document.getElementById('revenue-chart-title').textContent =
      state.revenueView === 'monthly' ? 'Monthly Revenue & Profit' : 'Daily Revenue & Profit';
    var m = document.getElementById('revenue-monthly-chart');
    var d = document.getElementById('revenue-daily-chart');
    if (state.revenueView === 'monthly') { m.classList.remove('hidden'); d.classList.add('hidden'); }
    else { d.classList.remove('hidden'); m.classList.add('hidden'); }
  }

  function getEventValue(e){
    if (state.eventsAgg === 'total') return state.eventsMetric === 'revenue' ? e.totalRevenue : e.totalProfit;
    return state.eventsMetric === 'revenue' ? e.avgRevenue : e.avgProfit;
  }
  function getStoreValue(s){
    if (state.storesAgg === 'total') return state.storesMetric === 'revenue' ? s.totalRevenue : s.totalProfit;
    return state.storesMetric === 'revenue' ? s.avgRevenue : s.avgProfit;
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  function renderList(containerId, items, getValue, metric, emptyText){
    var c = document.getElementById(containerId);
    if (!items.length) {
      c.innerHTML = '<p class="text-callout text-gray-400 dark:text-zinc-500 text-center mt-8">' + emptyText + '</p>';
      return;
    }
    var sorted = items.slice().sort(function(a,b){ return getValue(b) - getValue(a); }).slice(0, 5);
    var html = sorted.map(function(it, i){
      var firstBg = i === 0
        ? (metric === 'profit' ? 'bg-green-500 text-white' : 'bg-pink-500 text-white')
        : 'bg-gray-100 text-gray-500 dark:bg-[#1f1f1f] dark:text-zinc-400';
      var valueCls = metric === 'profit'
        ? 'text-green-600 dark:text-green-400'
        : 'text-pink-600 dark:text-pink-400';
      return ''
        + '<div class="flex items-center justify-between">'
        +   '<div class="flex items-center gap-2.5">'
        +     '<span class="w-6 h-6 rounded-full flex items-center justify-center text-caption ' + firstBg + '">' + (i+1) + '</span>'
        +     '<span class="text-callout text-gray-700 dark:text-zinc-300 truncate max-w-[200px]" title="' + escapeHtml(it.name) + '">' + escapeHtml(it.name) + '</span>'
        +   '</div>'
        +   '<span class="text-callout ' + valueCls + '">' + fmtUSD(getValue(it)) + '</span>'
        + '</div>';
    }).join('');
    c.innerHTML = html;
  }

  function refreshEvents(){
    renderList('events-list', D.aggregatedEvents, getEventValue, state.eventsMetric, 'No event data yet');
  }
  function refreshStores(){
    renderList('stores-list', D.aggregatedStores, getStoreValue, state.storesMetric, 'No store data yet');
  }

  // Wire up buttons
  var revenueBtns = document.querySelectorAll('.msc-revenue-toggle');
  revenueBtns.forEach(function(b){
    b.addEventListener('click', function(){
      state.revenueView = b.getAttribute('data-revenue-view');
      setBtnStyles(revenueBtns, 'data-revenue-view', state.revenueView);
      refreshRevenueView();
    });
  });

  var eventsAggBtns = document.querySelectorAll('.msc-events-agg');
  eventsAggBtns.forEach(function(b){
    b.addEventListener('click', function(){
      state.eventsAgg = b.getAttribute('data-events-agg');
      setBtnStyles(eventsAggBtns, 'data-events-agg', state.eventsAgg);
      refreshEvents();
    });
  });
  var eventsMetricBtns = document.querySelectorAll('.msc-events-metric');
  eventsMetricBtns.forEach(function(b){
    b.addEventListener('click', function(){
      state.eventsMetric = b.getAttribute('data-events-metric');
      setBtnStyles(eventsMetricBtns, 'data-events-metric', state.eventsMetric);
      refreshEvents();
    });
  });

  var storesAggBtns = document.querySelectorAll('.msc-stores-agg');
  storesAggBtns.forEach(function(b){
    b.addEventListener('click', function(){
      state.storesAgg = b.getAttribute('data-stores-agg');
      setBtnStyles(storesAggBtns, 'data-stores-agg', state.storesAgg);
      refreshStores();
    });
  });
  var storesMetricBtns = document.querySelectorAll('.msc-stores-metric');
  storesMetricBtns.forEach(function(b){
    b.addEventListener('click', function(){
      state.storesMetric = b.getAttribute('data-stores-metric');
      setBtnStyles(storesMetricBtns, 'data-stores-metric', state.storesMetric);
      refreshStores();
    });
  });

  refreshRevenueView();
  refreshEvents();
  refreshStores();
})();
          `,
        }}
      />
    </Layout>
  )
}
