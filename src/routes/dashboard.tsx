import { Hono } from 'hono'
import { api } from '../lib/api.js'
import { DashboardPage } from '../views/Dashboard.js'
import { Layout } from '../views/Layout.js'
import type { Event } from '../views/Events.js'
import type { Delivery } from '../views/Deliveries.js'

interface FlavorItem {
  flavorName: string
  prepared: number | null
}

const dashboardRoutes = new Hono()

// ───── GET / — full dashboard page ─────
dashboardRoutes.get('/', async (c) => {
  try {
    const [events, deliveries, eventItems, deliveryItems] = await Promise.all([
      api.get<Event[]>('/events'),
      api.get<Delivery[]>('/deliveries'),
      api.get<FlavorItem[]>('/event-items'),
      api.get<FlavorItem[]>('/delivery-items'),
    ])
    const html =
      '<!DOCTYPE html>' +
      (
        <DashboardPage
          events={events}
          deliveries={deliveries}
          eventItems={eventItems}
          deliveryItems={deliveryItems}
        />
      ).toString()
    return c.html(html)
  } catch (e) {
    return c.html(
      <Layout title="Dashboard" active="home">
        <div class="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">
          Failed to load dashboard: {String(e)}
        </div>
      </Layout>,
    )
  }
})

export default dashboardRoutes
export { dashboardRoutes }
