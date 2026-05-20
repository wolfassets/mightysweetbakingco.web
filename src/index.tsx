import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'

import { statSync } from 'node:fs'
import flavorsRoutes from './routes/flavors.js'
import eventsRoutes from './routes/events.js'
import eventDetailRoutes from './routes/event-detail.js'
import deliveriesRoutes from './routes/deliveries.js'
import deliveryDetailRoutes from './routes/delivery-detail.js'
import dashboardRoutes from './routes/dashboard.js'
import activityRoutes from './routes/activity.js'
import donationsRoutes from './routes/donations.js'
import settingsRoutes from './routes/settings.js'
import mapRoutes from './routes/map.js'
import modalsRoutes from './routes/modals.js'
import experimentalRoutes from './routes/experimental.js'

const PORT = Number(process.env.PORT ?? 4002)
const API_BASE = process.env.API_BASE ?? 'http://localhost:3000'

export const app = new Hono()

// Static assets (compiled Tailwind CSS, fonts). cwd = apps/web-c during dev.
app.use(
  '/static/*',
  serveStatic({
    root: './public/',
    rewriteRequestPath: (p) => p.replace(/^\/static/, ''),
  }),
)

// Mount all feature routers.
app.route('/', dashboardRoutes)
app.route('/', flavorsRoutes)
app.route('/', eventsRoutes)
app.route('/', eventDetailRoutes)
app.route('/', deliveriesRoutes)
app.route('/', deliveryDetailRoutes)
app.route('/', activityRoutes)
app.route('/', donationsRoutes)
app.route('/', settingsRoutes)
app.route('/', mapRoutes)
app.route('/', modalsRoutes)
app.route('/', experimentalRoutes)

// Health
app.get('/_health', (c) => c.text('ok'))

// Live-reload SSE — in dev, holds a long-lived connection. The browser script
// in Layout opens it on page load. When tsx watch restarts the server (after
// any TSX edit), this stream dies → client sees the disconnect → on reconnect
// it sees a fresh boot ID and triggers location.reload(). Also watches
// public/style.css mtime for CSS-only updates and emits "css" events to
// hot-swap the stylesheet without a full reload.
if (process.env.NODE_ENV !== 'production') {
  const BOOT_ID = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  app.get('/__livereload', (c) => {
    c.header('Content-Type', 'text/event-stream')
    c.header('Cache-Control', 'no-cache')
    c.header('Connection', 'keep-alive')
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder()
        controller.enqueue(enc.encode(`event: hello\ndata: ${BOOT_ID}\n\n`))
        let lastCssMtime = 0
        const ping = setInterval(() => {
          try {
            controller.enqueue(enc.encode(': ping\n\n'))
          } catch {
            clearInterval(ping)
            clearInterval(cssWatch)
          }
        }, 15000)
        // Poll public/style.css mtime; if it changes, fire a 'css' SSE event.
        const cssWatch = setInterval(() => {
          try {
            const st = statSync('./public/style.css')
            const m = st.mtimeMs
            if (lastCssMtime === 0) lastCssMtime = m
            else if (m !== lastCssMtime) {
              lastCssMtime = m
              controller.enqueue(enc.encode(`event: css\ndata: ${m}\n\n`))
            }
          } catch {}
        }, 500)
      },
    })
    return c.body(stream)
  })
}

// Local dev only — Vercel imports `app` and wraps it in a serverless handler
// (see api/index.ts), so we must NOT start a long-lived server there.
if (!process.env.VERCEL) {
  serve({ fetch: app.fetch, port: PORT })
  console.log(`web-c listening on http://localhost:${PORT}`)
  console.log(`fetching api from ${API_BASE}`)
}
