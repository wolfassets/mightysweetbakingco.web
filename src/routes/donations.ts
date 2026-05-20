/**
 * Hono router for the `/donations` UI page.
 *
 * Mounted by agent #12 at the app root (no prefix). The donations page is a
 * filtered view over the upstream /events list — we keep events that either
 * have totalGiveaway > 0 OR produced zero revenue despite cookies prepared
 * (cost-only / charity drops). The filter rule lives in the view (so it
 * stays adjacent to the markup that uses it); this router just hands off the
 * raw, non-archived events list.
 *
 * This file is .ts (not .tsx) per the agent brief; we invoke the JSX FC as
 * a plain function (matches the pattern in routes/activity.ts).
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import { api } from '../lib/api.js'
import { DonationsPage, type DonationEvent } from '../views/Donations.js'

const donationsRoutes = new Hono()

// Always prepend doctype so the browser doesn't fall into quirks mode
// (Chart.js sizing, dark-mode CSS, etc. depend on standards mode). Hono
// FCs return HtmlEscapedString | Promise<HtmlEscapedString> | null; we
// await + stringify ourselves so callers get a sync Response.
async function page(c: Context, jsx: unknown): Promise<Response> {
  const resolved = await (jsx as Promise<unknown> | unknown)
  return c.html('<!DOCTYPE html>' + String(resolved ?? ''))
}

// ───── GET /donations — full page ─────
donationsRoutes.get('/donations', async (c) => {
  // The upstream /events endpoint excludes soft-archived events by default;
  // we filter explicitly here too in case the api ever flips that default.
  const events = await api.get<DonationEvent[]>('/events')
  const live = events.filter((e) => !e.deletedAt)
  return page(c, DonationsPage({ events: live }))
})

export default donationsRoutes
export { donationsRoutes }
