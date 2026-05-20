/**
 * Hono router for the `/settings` UI page.
 *
 * Mounted by agent #12 at the app root. The settings page is purely
 * client-side: every preference (theme, font, show-archived, compact density,
 * disable animations) is persisted to localStorage via the inline script that
 * Settings.tsx ships. We therefore expose a single GET endpoint that renders
 * the page, with no POST/PATCH/DELETE routes — the form has nothing to send
 * to the server.
 *
 * The reference page (apps/web-b/app/settings/) is an empty directory; per
 * the agent brief we replicate the toggle surface that historically lived
 * there (theme, the deprecated Bricolage font flag, et al.). See the inline
 * comment in apps/web-b/app/globals.css for the canonical history.
 *
 * This file is .ts (not .tsx) per the agent brief; we invoke the JSX FC as
 * a plain function (matches the pattern in routes/activity.ts).
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import { SettingsPage } from '../views/Settings.js'

const settingsRoutes = new Hono()

async function page(c: Context, jsx: unknown): Promise<Response> {
  const resolved = await (jsx as Promise<unknown> | unknown)
  return c.html('<!DOCTYPE html>' + String(resolved ?? ''))
}

// ───── GET /settings — full page (no data dependencies) ─────
settingsRoutes.get('/settings', (c) => page(c, SettingsPage({})))

export default settingsRoutes
export { settingsRoutes }
