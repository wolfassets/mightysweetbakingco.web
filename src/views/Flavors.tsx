import type { FC, PropsWithChildren } from 'hono/jsx'
import { Layout } from './Layout.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Flavor {
  id: number
  name: string
  unitPrice: number
  unitCost: number | null
  isActive: boolean
}

export interface FlavorPrice {
  id: number
  flavorId: number
  tierName: string
  price: number
  cost: number | null
  isActive: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const DASH = '—'
const CORNER = '└'

export function pricesFor(flavorId: number, all: FlavorPrice[]): FlavorPrice[] {
  return all
    .filter((p) => p.flavorId === flavorId && p.isActive !== false)
    .sort((a, b) => {
      if (a.tierName === 'Base') return -1
      if (b.tierName === 'Base') return 1
      return a.id - b.id
    })
}

export function sortFlavors(list: Flavor[]): Flavor[] {
  return [...list].sort((a, b) => b.id - a.id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Hold-to-archive button.
//
// We're _not_ importing `HoldArchiveButton` from components.tsx even though it
// implements the same 800ms hold animation. Reason: the shared component is
// `w-20`, which doesn't match web-b's archive button (`w-16`). Per the task's
// "pixel parity with web-b" rule, this view ships its own narrower copy. The
// JS payload is byte-identical to the shared one.
// ─────────────────────────────────────────────────────────────────────────────

const HOLD_HANDLER = `(function(btn){
  if(btn.dataset.bound)return; btn.dataset.bound='1';
  var label=btn.querySelector('span'); if(!label)return;
  var interval=null, ready=false, progress=0;
  function paint(){
    btn.style.background = progress>0
      ? 'linear-gradient(90deg, rgba(239,68,68,'+(0.3+progress*0.7)+') '+(progress*100)+'%, rgba(254,242,242,1) '+(progress*100)+'%)'
      : 'rgba(254,242,242,1)';
    btn.style.color = progress>0.5 ? 'white' : '#ef4444';
    btn.style.border = '1px solid '+(progress>0 ? 'rgba(239,68,68,'+(0.3+progress*0.7)+')' : '#fecaca');
    label.textContent = progress>0 ? (progress>=0.8 ? 'Release' : 'Hold...') : 'Archive';
  }
  function start(){
    ready=false; progress=0; var t=Date.now();
    interval=setInterval(function(){
      progress=Math.min((Date.now()-t)/800,1);
      if(progress>=1){clearInterval(interval);interval=null;ready=true;}
      paint();
    },16);
  }
  function release(){
    if(interval){clearInterval(interval);interval=null;}
    if(ready){htmx.trigger(btn,'archive');}
    progress=0; ready=false; paint();
  }
  function cancel(){
    if(interval){clearInterval(interval);interval=null;}
    progress=0; ready=false; paint();
  }
  btn.addEventListener('mousedown',start);
  btn.addEventListener('mouseup',release);
  btn.addEventListener('mouseleave',cancel);
  btn.addEventListener('touchstart',function(e){e.preventDefault();start();});
  btn.addEventListener('touchend',function(e){e.preventDefault();release();});
})(this)`

const HoldArchiveBtn: FC<{ url: string; target: string; swap?: string }> = ({
  url,
  target,
  swap = 'outerHTML',
}) => (
  <button
    type="button"
    onmouseover={HOLD_HANDLER}
    class="relative overflow-hidden rounded-full w-20 py-1 text-button-sm transition-all select-none text-center"
    style="background: rgba(254,242,242,1); color: #ef4444; border: 1px solid #fecaca;"
    hx-delete={url}
    hx-trigger="archive"
    hx-target={target}
    hx-swap={swap}
    title="Hold to archive"
  >
    <span>Archive</span>
  </button>
)

// ─────────────────────────────────────────────────────────────────────────────
// EditableCell — display & edit-form variants
// In display mode it shows a pencil icon + value; click triggers `hx-get` for
// the edit-form fragment. In edit mode it renders an `<input>` that submits a
// PATCH on Enter (or blur) and swaps the parent cell back to the display form.
// ─────────────────────────────────────────────────────────────────────────────

interface DisplayCellProps {
  value: string
  getUrl: string
  cellId: string
  className?: string
  showPencil?: boolean
}

const DisplayCell: FC<DisplayCellProps> = ({ value, getUrl, cellId, className = '', showPencil = true }) => (
  <div
    id={cellId}
    hx-get={getUrl}
    hx-target={`#${cellId}`}
    hx-swap="outerHTML"
    hx-trigger="click"
    class={`editable-cell cursor-text group/edit flex items-center gap-1.5 ${className}`}
  >
    {showPencil && (
      <svg
        class="text-gray-300 dark:text-zinc-700 group-hover/edit:text-gray-400 dark:group-hover/edit:text-zinc-500 shrink-0 transition-colors"
        style="width: 1em; height: 1em;"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    )}
    {value}
  </div>
)

interface EditCellProps {
  cellId: string
  patchUrl: string
  cancelUrl: string
  fieldName: string
  value: string
  className?: string
}

// Auto-focus + Enter-saves + Escape-cancels via inline JS. Submitting the form
// via Enter triggers htmx; Escape just GETs the cancel-url (the display row).
const EditCell: FC<EditCellProps> = ({ cellId, patchUrl, cancelUrl, fieldName, value, className = '' }) => {
  const onkey = `if(event.key==='Escape'){event.preventDefault();htmx.ajax('GET','${cancelUrl}',{target:'#${cellId}',swap:'outerHTML'});}`
  const autofocus = `setTimeout(function(){var el=document.getElementById('${cellId}-input');if(el){el.focus();el.select();}},0)`
  return (
    <form
      id={cellId}
      hx-patch={patchUrl}
      hx-target={`#${cellId}`}
      hx-swap="outerHTML"
      hx-trigger="submit, blur from:find input delay:120ms"
      onmouseover={autofocus}
    >
      <input
        id={`${cellId}-input`}
        name={fieldName}
        type="text"
        value={value}
        onkeydown={onkey}
        class={`editable-cell w-full bg-white border-0 focus:ring-2 focus:ring-pink-500 rounded-lg ${className}`}
      />
    </form>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Margin
// ─────────────────────────────────────────────────────────────────────────────

const Margin: FC<{ price: number; cost: number | null }> = ({ price, cost }) => {
  if (cost == null || price <= 0) return <span class="text-gray-300 dark:text-zinc-700">{DASH}</span>
  const m = ((price - cost) / price) * 100
  return <span class="text-green-600 dark:text-green-400 text-callout">{m.toFixed(0)}%</span>
}

// ─────────────────────────────────────────────────────────────────────────────
// Row fragments returned by the htmx routes
// ─────────────────────────────────────────────────────────────────────────────

// Main flavor row (Name + Add-rate + Archive). Cost/price columns intentionally
// blank — those live on each child tier row.
export const FlavorMainRow: FC<{ f: Flavor; index: number; total: number; highlight?: boolean }> = ({
  f,
  index,
  total,
  highlight,
}) => (
  <tr
    id={`flavor-row-${f.id}`}
    class={`group transition-colors duration-1000 ${highlight ? 'bg-pink-50 dark:bg-pink-950/40' : ''}`}
  >
    <td class="text-center">
      <span class="text-gray-400 dark:text-zinc-500 text-callout">{total - index}</span>
    </td>
    <td>
      <div class="flex items-center gap-2">
        <DisplayCell
          value={f.name}
          cellId={`flavor-${f.id}-name`}
          getUrl={`/flavors/${f.id}/cell/name`}
        />
      </div>
    </td>
    <td></td>
    <td></td>
    <td></td>
    <td>
      <button
        type="button"
        hx-get={`/flavors/${f.id}/add-tier`}
        hx-target={`#flavor-block-${f.id}`}
        hx-swap="outerHTML"
        class="relative overflow-hidden rounded-full w-20 py-1 text-button-sm transition-all select-none text-center hover:brightness-95"
        style="background: rgba(240,253,244,1); color: #16a34a; border: 1px solid #bbf7d0;"
      >
        Add rate
      </button>
    </td>
    <td>
      <HoldArchiveBtn url={`/flavors/${f.id}`} target={`#flavor-block-${f.id}`} />
    </td>
  </tr>
)

// Sub-row representing one flavor_prices row.
export const PriceTierRow: FC<{ price: FlavorPrice }> = ({ price }) => (
  <tr id={`price-row-${price.id}`} class="bg-gray-50/50 dark:bg-[#171717]/50">
    <td></td>
    <td>
      <div class="flex items-center gap-2 pl-6">
        <span class="text-gray-300 dark:text-zinc-700 text-callout">{CORNER}</span>
        <DisplayCell
          value={price.tierName}
          cellId={`price-${price.id}-tierName`}
          getUrl={`/flavor-prices/${price.id}/cell/tierName`}
          className="text-callout text-gray-600 dark:text-zinc-400"
        />
      </div>
    </td>
    <td>
      <DisplayCell
        value={`$${price.price.toFixed(2)}`}
        cellId={`price-${price.id}-price`}
        getUrl={`/flavor-prices/${price.id}/cell/price`}
        className="text-callout"
      />
    </td>
    <td>
      <DisplayCell
        value={price.cost != null ? `$${price.cost.toFixed(2)}` : DASH}
        cellId={`price-${price.id}-cost`}
        getUrl={`/flavor-prices/${price.id}/cell/cost`}
        className="text-callout"
      />
    </td>
    <td>
      <span class="editable-cell text-callout">
        <Margin price={price.price} cost={price.cost} />
      </span>
    </td>
    <td></td>
    <td>
      <HoldArchiveBtn url={`/flavor-prices/${price.id}`} target={`#price-row-${price.id}`} />
    </td>
  </tr>
)

// Add-tier inline row (visible when "Add rate" was clicked).
export const AddTierRow: FC<{ flavorId: number }> = ({ flavorId }) => {
  const cancelUrl = `/flavors/${flavorId}/cancel-add-tier`
  const cancelKey = `if(event.key==='Escape'){event.preventDefault();htmx.ajax('GET','${cancelUrl}',{target:'#flavor-block-${flavorId}',swap:'outerHTML'});}`
  return (
    <tr id={`add-tier-${flavorId}`} class="bg-pink-50/30 dark:bg-pink-950/20">
      <td></td>
      <td>
        <div class="flex items-center gap-2 pl-6">
          <span class="text-gray-300 dark:text-zinc-700 text-callout">{CORNER}</span>
          <form
            id={`add-tier-form-${flavorId}`}
            hx-post={`/flavor-prices?flavorId=${flavorId}`}
            hx-target={`#flavor-block-${flavorId}`}
            hx-swap="outerHTML"
            hx-include={`#add-tier-${flavorId} input`}
            class="flex-1 contents"
          >
            <input
              type="hidden"
              name="flavorId"
              value={String(flavorId)}
            />
            <input
              autofocus
              type="text"
              name="tierName"
              placeholder="Tier name..."
              onkeydown={cancelKey}
              class="editable-cell w-full bg-white border-0 focus:ring-2 focus:ring-pink-500 rounded-lg text-callout"
            />
          </form>
        </div>
      </td>
      <td>
        <input
          type="text"
          name="price"
          placeholder="$0.00"
          form={`add-tier-form-${flavorId}`}
          onkeydown={cancelKey}
          class="editable-cell w-full bg-white border-0 focus:ring-2 focus:ring-pink-500 rounded-lg text-callout"
        />
      </td>
      <td>
        <input
          type="text"
          name="cost"
          placeholder="$0.00"
          form={`add-tier-form-${flavorId}`}
          onkeydown={cancelKey}
          class="editable-cell w-full bg-white border-0 focus:ring-2 focus:ring-pink-500 rounded-lg text-callout"
        />
      </td>
      <td></td>
      <td>
        <div class="flex gap-1">
          <button
            type="submit"
            form={`add-tier-form-${flavorId}`}
            class="p-1.5 text-green-500 dark:text-green-400 hover:text-green-600 dark:hover:text-green-300"
            title="Save"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button
            type="button"
            hx-get={cancelUrl}
            hx-target={`#flavor-block-${flavorId}`}
            hx-swap="outerHTML"
            class="p-1.5 text-gray-400 dark:text-zinc-500 hover:text-gray-500 dark:hover:text-zinc-400"
            title="Cancel"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  )
}

// Wrapper fragment that groups main row + price-tier rows (+ optional add-tier
// row) for one flavor. htmx swaps this whole block when a tier is added /
// removed or when "Add rate" toggles.
export const FlavorBlock: FC<
  PropsWithChildren<{
    flavor: Flavor
    prices: FlavorPrice[]
    index: number
    total: number
    addingTier?: boolean
    highlight?: boolean
  }>
> = ({ flavor, prices, index, total, addingTier, highlight }) => {
  const tiers = pricesFor(flavor.id, prices)
  return (
    <tbody id={`flavor-block-${flavor.id}`}>
      <FlavorMainRow f={flavor} index={index} total={total} highlight={highlight} />
      {tiers.map((p) => (
        <PriceTierRow price={p} />
      ))}
      {addingTier ? <AddTierRow flavorId={flavor.id} /> : null}
    </tbody>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EditCell helpers, exposed for the route handlers
// ─────────────────────────────────────────────────────────────────────────────

export const FlavorNameEdit: FC<{ f: Flavor }> = ({ f }) => (
  <EditCell
    cellId={`flavor-${f.id}-name`}
    patchUrl={`/flavors/${f.id}/cell/name`}
    cancelUrl={`/flavors/${f.id}/cell/name/cancel`}
    fieldName="name"
    value={f.name}
  />
)

export const PriceTierNameEdit: FC<{ p: FlavorPrice }> = ({ p }) => (
  <EditCell
    cellId={`price-${p.id}-tierName`}
    patchUrl={`/flavor-prices/${p.id}/cell/tierName`}
    cancelUrl={`/flavor-prices/${p.id}/cell/tierName/cancel`}
    fieldName="tierName"
    value={p.tierName}
    className="text-callout text-gray-600 dark:text-zinc-400"
  />
)

export const PriceTierPriceEdit: FC<{ p: FlavorPrice }> = ({ p }) => (
  <EditCell
    cellId={`price-${p.id}-price`}
    patchUrl={`/flavor-prices/${p.id}/cell/price`}
    cancelUrl={`/flavor-prices/${p.id}/cell/price/cancel`}
    fieldName="price"
    value={`$${p.price.toFixed(2)}`}
    className="text-callout"
  />
)

export const PriceTierCostEdit: FC<{ p: FlavorPrice }> = ({ p }) => (
  <EditCell
    cellId={`price-${p.id}-cost`}
    patchUrl={`/flavor-prices/${p.id}/cell/cost`}
    cancelUrl={`/flavor-prices/${p.id}/cell/cost/cancel`}
    fieldName="cost"
    value={p.cost != null ? `$${p.cost.toFixed(2)}` : DASH}
    className="text-callout"
  />
)

// Display-only wrappers, returned after a successful PATCH.
export const FlavorNameCell: FC<{ f: Flavor }> = ({ f }) => (
  <DisplayCell value={f.name} cellId={`flavor-${f.id}-name`} getUrl={`/flavors/${f.id}/cell/name`} />
)

export const PriceTierNameCell: FC<{ p: FlavorPrice }> = ({ p }) => (
  <DisplayCell
    value={p.tierName}
    cellId={`price-${p.id}-tierName`}
    getUrl={`/flavor-prices/${p.id}/cell/tierName`}
    className="text-callout text-gray-600 dark:text-zinc-400"
  />
)

export const PriceTierPriceCell: FC<{ p: FlavorPrice }> = ({ p }) => (
  <DisplayCell
    value={`$${p.price.toFixed(2)}`}
    cellId={`price-${p.id}-price`}
    getUrl={`/flavor-prices/${p.id}/cell/price`}
    className="text-callout"
  />
)

export const PriceTierCostCell: FC<{ p: FlavorPrice }> = ({ p }) => (
  <DisplayCell
    value={p.cost != null ? `$${p.cost.toFixed(2)}` : DASH}
    cellId={`price-${p.id}-cost`}
    getUrl={`/flavor-prices/${p.id}/cell/cost`}
    className="text-callout"
  />
)

// ─────────────────────────────────────────────────────────────────────────────
// Whole-table fragments
// ─────────────────────────────────────────────────────────────────────────────

export interface FlavorsTableProps {
  flavors: Flavor[]
  prices: FlavorPrice[]
  newFlavorId?: number | null
  addingTierFor?: number | null
  showArchived?: boolean
}

// The reference's animated-border outline on Add Flavor + the framer-motion
// fade are intentionally retained as plain CSS animations (animated-border is
// defined in globals.css). framer-motion's row-level enter/exit transitions
// are dropped — replaced with CSS `transition-colors`.

const TableHeader: FC = () => (
  <thead>
    <tr>
      <th class="w-12 text-center">#</th>
      <th>Name / Tier</th>
      <th class="w-28">Unit Price</th>
      <th class="w-28">Unit Cost</th>
      <th class="w-24">Margin</th>
      <th colspan={2} class="w-40 text-center">Actions</th>
    </tr>
  </thead>
)

// Inner table fragment swapped in by `POST /flavors` (after adding a new
// flavor). The whole `#flavors-card` block re-renders to refresh the layout.
export const FlavorsCard: FC<FlavorsTableProps> = ({ flavors, prices, newFlavorId, addingTierFor, showArchived }) => {
  const ordered = sortFlavors(flavors)
  const archivedCount = flavors.filter((f) => !f.isActive).length
  return (
    <div
      id="flavors-card"
      class="w-full bg-white dark:bg-[#0a0a0a] rounded-3xl overflow-hidden"
    >
      <div class="flex items-center justify-between px-8 pt-8 pb-6">
        <div>
          <h2 class="text-title-2 text-gray-900 dark:text-zinc-100">Flavors</h2>
          <p class="text-callout text-gray-400 dark:text-zinc-500 mt-1">Click any cell to edit inline.</p>
        </div>
        <div class="flex items-center gap-2">
          <a
            href={`/flavors${showArchived ? '' : '?archived=1'}`}
            class={`px-5 py-2.5 border rounded-full text-button transition-all flex items-center gap-2 ${
              showArchived
                ? 'bg-gray-900 border-gray-900 text-white hover:bg-gray-800 dark:bg-zinc-100 dark:border-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200'
                : 'bg-white border-gray-200 text-gray-700 hover:bg-[#fafafa] dark:bg-[#0a0a0a] dark:border-[#262626] dark:text-zinc-300 dark:hover:bg-[#171717]'
            }`}
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            {showArchived ? 'Hide archived' : `Archived${archivedCount > 0 ? ` (${archivedCount})` : ''}`}
          </a>
          <button
            type="button"
            hx-post="/flavors"
            hx-target="#flavors-card"
            hx-swap="outerHTML"
            class="animated-border px-5 py-2.5 text-white rounded-full text-button transition-all flex items-center gap-2"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Flavor
          </button>
        </div>
      </div>

      <div class="px-4 pb-4">
        <table class="data-table">
          <TableHeader />
          {ordered.map((flavor, i) => (
            <FlavorBlock
              flavor={flavor}
              prices={prices}
              index={i}
              total={ordered.length}
              addingTier={addingTierFor === flavor.id}
              highlight={newFlavorId === flavor.id}
            />
          ))}
        </table>

        {ordered.length === 0 && (
          <div class="text-center py-12 text-callout text-gray-400 dark:text-zinc-500">
            No flavors yet. Click &quot;Add Flavor&quot; to get started.
          </div>
        )}
      </div>
    </div>
  )
}

// Whole-page wrapper.
export const FlavorsView: FC<FlavorsTableProps> = (props) => (
  <Layout title="Flavors" active="flavors">
    <div>
      <FlavorsCard {...props} />
    </div>
  </Layout>
)

// ─────────────────────────────────────────────────────────────────────────────
// Back-compat exports (used by the current src/index.tsx until agent #12
// switches the mount over to `flavorsRoutes`). They render the new layout but
// keep the existing names + prop shapes so the typechecker stays happy.
// ─────────────────────────────────────────────────────────────────────────────

export const FlavorsPage: FC<{ flavors: Flavor[]; prices: FlavorPrice[]; showArchived?: boolean }> = ({
  flavors,
  prices,
}) => <FlavorsView flavors={flavors} prices={prices} />

export const FlavorsTable: FC<{ flavors: Flavor[]; prices: FlavorPrice[]; showArchived?: boolean }> = ({
  flavors,
  prices,
}) => <FlavorsCard flavors={flavors} prices={prices} />

// Legacy single-row fragments — kept so old index.tsx imports still resolve.
// New behaviour swaps the entire FlavorBlock instead.
export const FlavorRow: FC<{ f: Flavor; prices: FlavorPrice[] }> = ({ f, prices }) => {
  const all = sortFlavors([f])
  return <FlavorBlock flavor={f} prices={prices} index={0} total={all.length} />
}

export const FlavorEditRow: FC<{ f: Flavor }> = ({ f }) => <FlavorRow f={f} prices={[]} />
