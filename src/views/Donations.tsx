import type { FC } from 'hono/jsx'
import { Layout } from './Layout.js'
import { Card, PageHeader } from './components.js'
import { usd, date } from '../lib/format.js'

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface DonationEvent {
  id: number
  name: string
  eventDate: string
  location: string | null
  totalPrepared: number
  totalSold: number
  totalGiveaway: number
  totalRevenue: number
  totalCost?: number
  netProfit?: number
  deletedAt?: string | null
}

// Same filter rule the web-b /donations stub would have once it grew up: an
// "event" is a donation when at least one cookie was given away, OR the event
// produced zero revenue despite having prepared > 0 (cost-only / charity).
export function isDonationEvent(e: DonationEvent): boolean {
  return e.totalGiveaway > 0 || (e.totalRevenue === 0 && e.totalPrepared > 0)
}

// ────────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────────

export const DonationsPage: FC<{ events: DonationEvent[] }> = ({ events }) => {
  // The reference page in web-b is a placeholder ("Donations dashboard coming
  // soon.") so we keep the headline copy + container chrome identical, but
  // render the data inside the same rounded-3xl card.
  const donations = events.filter(isDonationEvent)
  const totalGiven = donations.reduce((s, e) => s + (e.totalGiveaway || e.totalPrepared), 0)
  const totalCostBorne = donations.reduce((s, e) => s + (e.totalCost ?? 0), 0)
  const totalRevenue = donations.reduce((s, e) => s + e.totalRevenue, 0)

  return (
    <Layout title="Donations" active="donations">
      {/* Outer rounded card mirrors web-b's placeholder shell exactly so the
          page header + dark background match pixel-for-pixel even when the
          data list is empty. */}
      <div class="bg-white dark:bg-[#0a0a0a] rounded-3xl p-8">
        <h1 class="text-title-1 text-gray-900 dark:text-zinc-100">Donations</h1>
        <p class="text-callout text-gray-500 dark:text-zinc-400 mt-2">
          {donations.length === 0
            ? 'Donations dashboard coming soon.'
            : `${donations.length} donation events · ${totalGiven.toLocaleString()} cookies given · ${usd(totalCostBorne)} cost`}
        </p>

        {donations.length > 0 && (
          <>
            {/* Summary stats row */}
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
              <Card class="p-4">
                <p class="text-caption uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-500">Events</p>
                <p class="text-title-2 text-gray-900 dark:text-zinc-100 mt-1 tabular-nums">{donations.length}</p>
              </Card>
              <Card class="p-4">
                <p class="text-caption uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-500">Cookies Given</p>
                <p class="text-title-2 text-gray-900 dark:text-zinc-100 mt-1 tabular-nums">{totalGiven.toLocaleString()}</p>
              </Card>
              <Card class="p-4">
                <p class="text-caption uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-500">Revenue Recovered</p>
                <p class="text-title-2 text-gray-900 dark:text-zinc-100 mt-1 tabular-nums">{usd(totalRevenue)}</p>
              </Card>
            </div>

            {/* Donations table */}
            <Card class="overflow-hidden mt-6">
              <table class="w-full text-left">
                <thead class="bg-gray-50 dark:bg-[#0f0f0f] text-caption uppercase tracking-[0.08em] text-gray-500 dark:text-zinc-500">
                  <tr>
                    <th class="px-4 py-2.5 w-16">ID</th>
                    <th class="px-4 py-2.5">Event</th>
                    <th class="px-4 py-2.5 w-32">Date</th>
                    <th class="px-4 py-2.5 w-24 text-right">Given</th>
                    <th class="px-4 py-2.5 w-24 text-right">Sold</th>
                    <th class="px-4 py-2.5 w-28 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {donations.map((e) => (
                    <tr class="border-t border-gray-100 dark:border-[#1f1f1f]">
                      <td class="px-4 py-3 text-callout text-gray-400 dark:text-zinc-500">#{e.id}</td>
                      <td class="px-4 py-3 text-button text-gray-900 dark:text-zinc-100">
                        <a href={`/events/${e.id}`} class="hover:text-pink-600 dark:hover:text-pink-400">{e.name}</a>
                        {e.location && (
                          <p class="text-caption text-gray-400 dark:text-zinc-500 mt-0.5">{e.location}</p>
                        )}
                      </td>
                      <td class="px-4 py-3 text-callout text-gray-600 dark:text-zinc-400">{date(e.eventDate)}</td>
                      <td class="px-4 py-3 text-callout text-right text-gray-900 dark:text-zinc-100">
                        {(e.totalGiveaway || e.totalPrepared).toLocaleString()}
                      </td>
                      <td class="px-4 py-3 text-callout text-right text-gray-500 dark:text-zinc-400">
                        {e.totalSold.toLocaleString()}
                      </td>
                      <td class="px-4 py-3 text-callout text-right text-gray-900 dark:text-zinc-100">{usd(e.totalRevenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </div>
    </Layout>
  )
}
