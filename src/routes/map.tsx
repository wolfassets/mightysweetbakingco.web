import { Hono } from 'hono'
import { api } from '../lib/api.js'
import { MapPage } from '../views/Map.js'
import type { Event } from '../views/Events.js'
import type { Delivery } from '../views/Deliveries.js'

// ────────────────────────────────────────────────────────────────────────────
// Map router — GET /map renders a full-screen Apple MapKit JS view with pins
// for every event + delivery that has a non-empty `location` string.
//
// Filename note: the spec calls this file `map.ts`, but the handler needs to
// return JSX (`<MapPage … />`) so the file is `.tsx`. The existing routes
// folder follows the same convention (events.tsx, flavors.tsx).
//
// Token sourcing: web-b uses NEXT_PUBLIC_MAPKIT_TOKEN (build-time, frozen
// into the client bundle). web-c is server-rendered with Hono, so we read
// process.env.MAPKIT_TOKEN at request time and pass it as a prop. The
// MapPage view inlines it into the page via a <script id="map-token"> tag.
// ────────────────────────────────────────────────────────────────────────────

const mapRoutes = new Hono()

mapRoutes.get('/map', async (c) => {
  const mapkitToken = process.env.MAPKIT_TOKEN ?? ''

  let events: Event[] = []
  let deliveries: Delivery[] = []
  try {
    ;[events, deliveries] = await Promise.all([
      api.get<Event[]>('/events'),
      api.get<Delivery[]>('/deliveries'),
    ])
  } catch (e) {
    // Render the page anyway so the user sees a useful empty state instead
    // of a 500. The inline init script handles the "no markers" case.
    console.error('[map] failed to load events/deliveries:', e)
  }

  const html = '<!DOCTYPE html>' + (
    <MapPage events={events} deliveries={deliveries} mapkitToken={mapkitToken} />
  ).toString()
  return c.html(html)
})

export default mapRoutes
export { mapRoutes }
