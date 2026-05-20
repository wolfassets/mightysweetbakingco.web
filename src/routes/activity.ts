/**
 * /activity router + /stream-events SSE bridge.
 *
 * Two endpoints:
 *
 *   GET /activity
 *     - Full page render on initial GET.
 *     - htmx target-aware: when the htmx form submits with hx-target="activity-results"
 *       (or the request includes the HX-Request header and targets the results
 *       container), we return the inner block only — no <Layout/> wrapper.
 *
 *   GET /stream-events
 *     - Long-lived SSE response that bridges from the api's /stream upstream.
 *     - On any upstream event (flavor.updated / event.updated / delivery.updated / etc.)
 *       we re-fetch /audit-log?limit=1 and emit the freshest entry as an
 *       `audit` event whose `data:` is a pre-rendered single-line HTML fragment.
 *     - Initial ping ("connected") so the client knows the stream is alive.
 *     - Heartbeat comment lines every 25 s to keep proxies from idling out.
 */

import { Hono } from 'hono'
import { api } from '../lib/api.js'
import type { HtmlEscapedString } from 'hono/utils/html'
import {
  ActivityPage,
  ActivityResults,
  applyFilters,
  renderAuditEntryHtml,
  type ActivityFilters,
  type AuditRow,
} from '../views/Activity.js'

// hono/jsx's JSX.Element resolves to HtmlEscapedString | Promise<HtmlEscapedString>
// but the import-time alias 'JSX' resolves to a partial namespace. Using
// HtmlEscapedString directly here sidesteps the cosmetic TS error that
// appears across this codebase (see index.tsx, routes/settings.tsx, etc.).
type RenderedElement = HtmlEscapedString | Promise<HtmlEscapedString>

const activityRoutes = new Hono()

// ───── Helpers ─────
function parseFilters(c: { req: { query: (k: string) => string | undefined } }): ActivityFilters {
  const q = (k: string) => c.req.query(k)
  return {
    entityType: q('entityType') || undefined,
    action: q('action') || undefined,
    search: q('search') || undefined,
    from: q('from') || undefined,
    to: q('to') || undefined,
  }
}

// ───── GET /activity ─────
activityRoutes.get('/activity', async (c) => {
  const filters = parseFilters(c)
  // Pull a generous slice (limit 500) so total-count and filtered-list
  // come from a single upstream call. The api supports server-side
  // filtering but we filter in-memory here so the "search" param (which
  // the api doesn't index) and the unfiltered total-count are both
  // available from one request.
  const rows = await api.get<AuditRow[]>('/audit-log?limit=500')
  const filtered = applyFilters(rows, filters)

  // htmx swap: return only the results block when the form-submit targets
  // the inner results container.
  const hxTarget = c.req.header('hx-target')
  const isPartial = c.req.header('hx-request') === 'true' && hxTarget === 'activity-results'

  // We invoke the JSX FCs as plain functions so this file can stay .ts
  // (matches the pattern in routes/event-detail.ts).
  if (isPartial) {
    const partial = ActivityResults({
      rows,
      totalCount: rows.length,
      filtered,
    }) as unknown as RenderedElement
    return c.html(partial)
  }

  const page = ActivityPage({ rows, filters }) as unknown as RenderedElement
  return c.html('<!DOCTYPE html>' + (page as { toString: () => string }).toString())
})

// ───── GET /stream-events ─────
// Bridges the api's /stream → htmx-sse-compatible `audit` events.
//
// Design:
//   • A long-lived ReadableStream emits SSE chunks to the htmx client.
//   • Two background loops run concurrently, both kept alive until the client
//     disconnects (signaled via the ReadableStream's cancel() callback):
//       1. Upstream loop: opens `${api.base}/stream`, reads chunks. On any
//          non-keepalive upstream event, calls flushNew() to push fresh audit
//          rows. If upstream drops, sleeps 2 s and reconnects.
//       2. Poll loop: every 5 s, calls flushNew() unconditionally. This is the
//          fallback for when upstream is silent (e.g. api Redis sub not boot-ed).
//   • flushNew() is idempotent: it tracks `lastAuditId` and only emits rows
//     with a higher id than what we've already seen.
//   • Heartbeat: every 25 s, emit an SSE comment line to keep proxies happy.
activityRoutes.get('/stream-events', (c) => {
  c.header('Content-Type', 'text/event-stream')
  c.header('Cache-Control', 'no-cache, no-transform')
  c.header('Connection', 'keep-alive')
  c.header('X-Accel-Buffering', 'no')

  // Shared mutable state — closures below capture these.
  let closed = false
  let lastAuditId: number | null = null
  const timers: NodeJS.Timeout[] = []

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      const safeEnqueue = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(enc.encode(chunk))
        } catch {
          closed = true
        }
      }

      // Initial "connected" event so the client knows the pipe is open.
      safeEnqueue(`event: connected\ndata: ${new Date().toISOString()}\n\n`)

      // Heartbeat (SSE comment lines) every 25 s.
      timers.push(
        setInterval(() => {
          if (closed) return
          safeEnqueue(`: ping ${Date.now()}\n\n`)
        }, 25_000),
      )

      // Seed lastAuditId from current state so we don't re-emit history.
      try {
        const seed = await api.get<AuditRow[]>('/audit-log?limit=50')
        const maxId = seed.reduce((m, r) => (r.id > m ? r.id : m), 0)
        if (maxId > 0) lastAuditId = maxId
      } catch {
        // ignore; we'll catch up on first event
      }

      // flushNew: pull recent audit rows, emit any with id > lastAuditId.
      // We sort by id (DESC) because the api's createdAt-based sort doesn't
      // help when legacy rows have literal 'CURRENT_TIMESTAMP' strings.
      const flushNew = async () => {
        if (closed) return
        try {
          const recent = await api.get<AuditRow[]>('/audit-log?limit=50')
          const sorted = [...recent].sort((a, b) => b.id - a.id)
          const fresh = sorted.filter((r) => lastAuditId === null || r.id > lastAuditId)
          if (fresh.length === 0) return
          // Emit oldest-first so the truly-newest ends up on top of the feed
          // (afterbegin swap on the client puts each emit at index 0).
          for (let i = fresh.length - 1; i >= 0; i--) {
            const row = fresh[i]
            const html = renderAuditEntryHtml(row)
            const wrapper = `<div class="space-y-2 fade-in">${html}</div>`
            const safe = wrapper.replace(/\r?\n/g, '')
            safeEnqueue(`event: audit\ndata: ${safe}\n\n`)
          }
          lastAuditId = fresh[0].id
        } catch {
          // swallow — keep stream open
        }
      }

      // Poll loop (fallback): fires every 5 s. Runs alongside the upstream
      // bridge below so a broken upstream doesn't kill near-realtime updates.
      timers.push(
        setInterval(() => {
          void flushNew()
        }, 5_000),
      )

      // Upstream loop: opens api's /stream, reads chunks, calls flushNew on
      // any non-keepalive event. Reconnects on disconnect.
      void (async () => {
        while (!closed) {
          try {
            const upstream = await fetch(`${api.base}/stream`, {
              headers: { accept: 'text/event-stream' },
            })
            if (!upstream.ok || !upstream.body) {
              throw new Error(`upstream ${upstream.status}`)
            }
            const reader = upstream.body.getReader()
            const dec = new TextDecoder()
            let buf = ''
            while (!closed) {
              const { done, value } = await reader.read()
              if (done) break
              buf += dec.decode(value, { stream: true })
              let nl: number
              while ((nl = buf.indexOf('\n\n')) >= 0) {
                const block = buf.slice(0, nl)
                buf = buf.slice(nl + 2)
                const isKeepalive =
                  block.includes('event: ping') ||
                  block.startsWith(':') ||
                  block.includes('event: connected')
                if (isKeepalive) continue
                await flushNew()
              }
            }
            try {
              reader.releaseLock()
            } catch {
              /* noop */
            }
          } catch {
            // Upstream failed; back off and retry. The poll loop continues to
            // deliver events in the meantime.
          }
          if (closed) break
          // Brief back-off before reconnecting.
          await new Promise<void>((r) => {
            const t = setTimeout(r, 2_000)
            timers.push(t)
          })
        }
      })()
    },
    cancel() {
      // Client disconnected. Stop all timers + flag closed so background loops
      // exit on their next iteration.
      closed = true
      for (const t of timers) {
        try {
          clearInterval(t as unknown as NodeJS.Timeout)
          clearTimeout(t as unknown as NodeJS.Timeout)
        } catch {
          /* noop */
        }
      }
    },
  })

  return c.body(stream)
})

export default activityRoutes
export { activityRoutes }
