import { Hono } from 'hono'
import { api } from '../lib/api.js'
import { ExperimentalPage, type EventItem, type DeliveryItem } from '../views/Experimental.js'
import { Layout } from '../views/Layout.js'
import type { Event } from '../views/Events.js'
import type { Delivery } from '../views/Deliveries.js'

const page = (c: { html: (s: string) => Response }, jsx: unknown) =>
  c.html('<!DOCTYPE html>' + String(jsx))

export const experimentalRoutes = new Hono()

experimentalRoutes.get('/experimental', async (c) => {
  try {
    const [events, deliveries, eventItems, deliveryItems] = await Promise.all([
      api.get<Event[]>('/events'),
      api.get<Delivery[]>('/deliveries'),
      api.get<EventItem[]>('/event-items'),
      api.get<DeliveryItem[]>('/delivery-items'),
    ])
    return page(
      c,
      <ExperimentalPage events={events} deliveries={deliveries} eventItems={eventItems} deliveryItems={deliveryItems} />,
    )
  } catch (e) {
    return page(
      c,
      <Layout title="Experimental" active="experimental">
        <div class="rounded-2xl border border-red-200 bg-red-50 p-4 text-callout text-red-800">
          Failed to load experimental dashboard: {String(e)}
        </div>
      </Layout>,
    )
  }
})

export default experimentalRoutes
