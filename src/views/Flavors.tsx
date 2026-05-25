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
// Per-tier label under a flavor: 0→A, 1→B, 2→C … (wraps to AA after Z).
const tierLetter = (i: number): string => {
  let n = i
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

export function pricesFor(flavorId: number, all: FlavorPrice[]): FlavorPrice[] {
  return all
    .filter((p) => p.flavorId === flavorId)
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
// Archive / delete action buttons.
//
// Archive is a plain tap. Delete requires a short hold before firing the hard
// delete request.
// ─────────────────────────────────────────────────────────────────────────────

const ArchiveBtn: FC<{ url: string; target: string; swap?: string }> = ({
  url,
  target,
  swap = 'outerHTML',
}) => (
  <button
    type="button"
    class="relative overflow-hidden rounded-full w-24 py-1 text-button-sm transition-all select-none text-center"
    style="background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe;"
    hx-delete={url}
    hx-target={target}
    hx-swap={swap}
    title="Archive"
  >
    <span>Archive</span>
  </button>
)

const ArchivedBadge: FC = () => (
  <span
    class="inline-flex w-24 items-center justify-center rounded-full py-1 text-button-sm"
    style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd;"
  >
    Archived
  </span>
)

const UnarchiveBtn: FC<{ url: string; target: string; swap?: string }> = ({
  url,
  target,
  swap = 'outerHTML',
}) => (
  <button
    type="button"
    class="relative overflow-hidden rounded-full w-24 py-1 text-button-sm transition-all select-none text-center hover:brightness-95"
    style="background: #fffbeb; color: #d97706; border: 1px solid #fde68a;"
    hx-post={url}
    hx-target={target}
    hx-swap={swap}
    title="Unarchive"
  >
    <span>Unarchive</span>
  </button>
)

const HOLD_DELETE_HANDLER = `(function(btn){
  if(btn.dataset.holdBound) return; btn.dataset.holdBound='1';
  var interval=null, progress=0, ready=false;
  function paint(){
    btn.style.background = progress>0
      ? 'linear-gradient(90deg,#fee2e2 '+(progress*100)+'%,#fef2f2 '+(progress*100)+'%)'
      : '#fef2f2';
    btn.textContent = progress>0 ? (progress>=0.8 ? 'Release' : 'Hold...') : 'Delete';
  }
  function start(){
    if(interval) return;
    ready=false; progress=0; var t=Date.now();
    interval=setInterval(function(){
      progress=Math.min((Date.now()-t)/800,1);
      if(progress>=1){clearInterval(interval);interval=null;ready=true;}
      paint();
    },16);
  }
  function release(){
    if(interval){clearInterval(interval);interval=null;}
    if(ready){htmx.trigger(btn,'confirmdelete');}
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

const HoldDeleteBtn: FC<{ url: string; target: string; swap?: string }> = ({
  url,
  target,
  swap = 'outerHTML',
}) => (
  <button
    type="button"
    onmouseover={HOLD_DELETE_HANDLER}
    class="relative overflow-hidden rounded-full w-24 py-1 text-button-sm transition-all select-none text-center"
    style="background: #fef2f2; color: #ef4444; border: 1px solid #fecaca;"
    hx-delete={url}
    hx-trigger="confirmdelete"
    hx-target={target}
    hx-swap={swap}
    title="Hold to delete"
  >
    Delete
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
  pencilRight?: boolean
}

const DisplayCell: FC<DisplayCellProps> = ({ value, getUrl, cellId, className = '', showPencil = true, pencilRight = false }) => {
  const pencil = (
    <svg
      class="text-black dark:text-zinc-100 shrink-0"
      style="width: 0.9em; height: 0.9em;"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  )
  return (
    <div
      id={cellId}
      hx-get={getUrl}
      hx-target={`#${cellId}`}
      hx-swap="outerHTML"
      hx-trigger="click"
      class={`editable-cell cursor-text group/edit flex items-center gap-1.5 ${className}`}
    >
      {showPencil && !pencilRight && pencil}
      {value}
      {showPencil && pencilRight && pencil}
    </div>
  )
}

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

const StaticMargin: FC<{ price: number; cost: number | null }> = ({ price, cost }) => {
  if (cost == null || price <= 0) return <span class="text-slate-400 dark:text-zinc-600">{DASH}</span>
  const m = ((price - cost) / price) * 100
  return <span class="text-slate-500 dark:text-zinc-500 text-callout">{m.toFixed(0)}%</span>
}

// ─────────────────────────────────────────────────────────────────────────────
// Row fragments returned by the htmx routes
// ─────────────────────────────────────────────────────────────────────────────

// Main flavor row (Name + Add-rate + Archive + Delete). Cost/price columns
// intentionally blank — those live on each child tier row.
export const FlavorMainRow: FC<{ f: Flavor; index: number; total: number; highlight?: boolean }> = ({
  f,
  index,
  total,
  highlight,
}) => {
  const archived = f.isActive === false
  return (
    <tr
      id={`flavor-row-${f.id}`}
      class={`group transition-colors duration-1000 ${
        archived
          ? 'bg-slate-50/80 text-slate-500 dark:bg-[#111827]/40 dark:text-zinc-500'
          : highlight
            ? 'bg-pink-50 dark:bg-pink-950/40'
            : ''
      }`}
    >
      <td class="text-center">
        <span class={`min-h-[44px] flex items-center justify-center text-callout ${archived ? 'text-slate-400 dark:text-zinc-600' : 'text-pink-600 dark:text-pink-400'}`}>
          {total - index}
        </span>
      </td>
      <td>
        <div class="flex items-center gap-2">
          {archived ? (
            <span id={`flavor-${f.id}-name`} class="flex min-h-[44px] items-center rounded-lg px-4 py-3 text-headline text-slate-500 dark:text-zinc-500 cursor-default line-through decoration-slate-400 dark:decoration-zinc-600">
              {f.name}
            </span>
          ) : (
            <DisplayCell
              value={f.name}
              cellId={`flavor-${f.id}-name`}
              getUrl={`/flavors/${f.id}/cell/name`}
              className="text-headline text-gray-900 dark:text-zinc-100"
            />
          )}
        </div>
      </td>
      <td></td>
      <td></td>
      <td></td>
      <td class="w-32 px-2">
        {archived ? null : (
          <button
            type="button"
            hx-get={`/flavors/${f.id}/add-tier`}
            hx-target={`#flavor-block-${f.id}`}
            hx-swap="outerHTML"
            class="relative overflow-hidden rounded-full w-24 py-1 text-button-sm transition-all select-none text-center hover:brightness-95"
            style="background: rgba(240,253,244,1); color: #16a34a; border: 1px solid #bbf7d0;"
          >
            Add rate
          </button>
        )}
      </td>
      <td class="w-32 px-2">
        {archived ? <UnarchiveBtn url={`/flavors/${f.id}/restore`} target="#flavors-card" /> : <ArchiveBtn url={`/flavors/${f.id}`} target="#flavors-card" />}
      </td>
      <td class="w-32 px-2">
        <HoldDeleteBtn url={`/flavors/${f.id}?hard=true`} target="#flavors-card" />
      </td>
    </tr>
  )
}

// Sub-row representing one flavor_prices row.
export const PriceTierRow: FC<{ price: FlavorPrice; index?: number; disabled?: boolean }> = ({ price, index = 0, disabled }) => {
  const priceArchived = price.isActive === false
  const archived = disabled || priceArchived
  const staticCellClass = 'flex min-h-[44px] items-center rounded-lg px-4 py-3 text-callout text-slate-500 dark:text-zinc-500 cursor-default line-through decoration-slate-400 dark:decoration-zinc-600'
  return (
    <tr
      id={`price-row-${price.id}`}
      class={archived ? 'bg-slate-50/70 text-slate-500 dark:bg-[#111827]/30 dark:text-zinc-500' : 'bg-gray-50/50 dark:bg-[#171717]/50'}
    >
      <td></td>
      <td>
        <div class="flex items-center gap-2 pl-6">
          <span class={`min-h-[44px] flex items-center justify-center text-callout ${archived ? 'text-slate-400 dark:text-zinc-600' : 'text-pink-600 dark:text-pink-400'}`}>{tierLetter(index)}</span>
          {archived ? (
            <span id={`price-${price.id}-tierName`} class={staticCellClass}>
              {price.tierName}
            </span>
          ) : (
            <DisplayCell
              value={price.tierName}
              cellId={`price-${price.id}-tierName`}
              getUrl={`/flavor-prices/${price.id}/cell/tierName`}
              className="text-callout text-gray-900 dark:text-zinc-100"
            />
          )}
        </div>
      </td>
      <td>
        {archived ? (
          <span id={`price-${price.id}-price`} class={staticCellClass}>
            ${price.price.toFixed(2)}
          </span>
        ) : (
          <DisplayCell
            value={`$${price.price.toFixed(2)}`}
            cellId={`price-${price.id}-price`}
            getUrl={`/flavor-prices/${price.id}/cell/price`}
            className="text-callout"
          />
        )}
      </td>
      <td>
        {archived ? (
          <span id={`price-${price.id}-cost`} class={staticCellClass}>
            {price.cost != null ? `$${price.cost.toFixed(2)}` : DASH}
          </span>
        ) : (
          <DisplayCell
            value={price.cost != null ? `$${price.cost.toFixed(2)}` : DASH}
            cellId={`price-${price.id}-cost`}
            getUrl={`/flavor-prices/${price.id}/cell/cost`}
            className="text-callout"
          />
        )}
      </td>
      <td>
        {archived ? (
          <span class={staticCellClass}>
            <StaticMargin price={price.price} cost={price.cost} />
          </span>
        ) : (
          <span class="editable-cell text-callout">
            <Margin price={price.price} cost={price.cost} />
          </span>
        )}
      </td>
      <td class="w-32 px-2"></td>
      <td class="w-32 px-2">
        {priceArchived ? (
          <UnarchiveBtn url={`/flavor-prices/${price.id}/restore`} target={`#price-row-${price.id}`} />
        ) : archived ? (
          <ArchivedBadge />
        ) : (
          <ArchiveBtn url={`/flavor-prices/${price.id}`} target={`#price-row-${price.id}`} />
        )}
      </td>
      <td class="w-32 px-2">
        <HoldDeleteBtn url={`/flavor-prices/${price.id}?hard=true`} target={`#price-row-${price.id}`} />
      </td>
    </tr>
  )
}

// Add-tier inline row (visible when "Add rate" was clicked).
export const AddTierRow: FC<{ flavorId: number; index?: number }> = ({ flavorId, index = 0 }) => {
  const cancelUrl = `/flavors/${flavorId}/cancel-add-tier`
  const cancelKey = `if(event.key==='Escape'){event.preventDefault();htmx.ajax('GET','${cancelUrl}',{target:'#flavor-block-${flavorId}',swap:'outerHTML'});}`
  const submitGuard = `var row=document.getElementById('add-tier-${flavorId}');var form=document.getElementById('add-tier-form-${flavorId}');if(!row||!form)return;var name=form.querySelector('[name=tierName]');var price=row.querySelector('[name=price]');var cost=row.querySelector('[name=cost]');var nv=(name&&name.value||'').trim();var pv=(price&&price.value||'').trim();var cv=(cost&&cost.value||'').trim();var n=parseFloat(pv.replace(/[$,]/g,''));if(!nv&&!pv&&!cv){event.preventDefault();htmx.ajax('GET','${cancelUrl}',{target:'#flavor-block-${flavorId}',swap:'outerHTML'});return;}if(!isFinite(n)||n<=0){event.preventDefault();if(price)price.focus();}`
  const saveOnBlur = `setTimeout(function(){var row=document.getElementById('add-tier-${flavorId}');var form=document.getElementById('add-tier-form-${flavorId}');if(!row||!form||row.contains(document.activeElement)||form.dataset.submitting)return;var name=form.querySelector('[name=tierName]');var price=row.querySelector('[name=price]');var cost=row.querySelector('[name=cost]');var nv=(name&&name.value||'').trim();var pv=(price&&price.value||'').trim();var cv=(cost&&cost.value||'').trim();var n=parseFloat(pv.replace(/[$,]/g,''));if(!nv&&!pv&&!cv){form.dataset.submitting='1';htmx.ajax('GET','${cancelUrl}',{target:'#flavor-block-${flavorId}',swap:'outerHTML'});return;}if(!isFinite(n)||n<=0)return;form.dataset.submitting='1';if(form.requestSubmit)form.requestSubmit();else htmx.trigger(form,'submit');},0)`
  return (
    <tr id={`add-tier-${flavorId}`} class="bg-pink-50/30 dark:bg-pink-950/20" onfocusout={saveOnBlur}>
      <td></td>
      <td>
        <div class="flex items-center gap-2 pl-6">
          <span class="min-h-[44px] flex items-center justify-center text-pink-600 dark:text-pink-400 text-callout">{tierLetter(index)}</span>
          <form
            id={`add-tier-form-${flavorId}`}
            hx-post={`/flavor-prices?flavorId=${flavorId}`}
            hx-target={`#flavor-block-${flavorId}`}
            hx-swap="outerHTML"
            hx-include={`#add-tier-${flavorId} input`}
            class="flex-1 contents"
            onsubmit={submitGuard}
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
      <td class="w-32 px-2"></td>
      <td class="w-32 px-2"></td>
      <td class="w-32 px-2"></td>
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
      {tiers.map((p, ti) => (
        <PriceTierRow price={p} index={ti} disabled={flavor.isActive === false} />
      ))}
      {addingTier ? <AddTierRow flavorId={flavor.id} index={tiers.length} /> : null}
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
    className="text-headline text-gray-900 dark:text-zinc-100"
  />
)

export const PriceTierNameEdit: FC<{ p: FlavorPrice }> = ({ p }) => (
  <EditCell
    cellId={`price-${p.id}-tierName`}
    patchUrl={`/flavor-prices/${p.id}/cell/tierName`}
    cancelUrl={`/flavor-prices/${p.id}/cell/tierName/cancel`}
    fieldName="tierName"
    value={p.tierName}
    className="text-callout text-gray-900 dark:text-zinc-100"
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
  <DisplayCell value={f.name} cellId={`flavor-${f.id}-name`} getUrl={`/flavors/${f.id}/cell/name`} className="text-headline text-gray-900 dark:text-zinc-100" />
)

export const PriceTierNameCell: FC<{ p: FlavorPrice }> = ({ p }) => (
  <DisplayCell
    value={p.tierName}
    cellId={`price-${p.id}-tierName`}
    getUrl={`/flavor-prices/${p.id}/cell/tierName`}
    className="text-callout text-gray-900 dark:text-zinc-100"
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
      <th>Name and Rate</th>
      <th class="w-28">Unit Price</th>
      <th class="w-28">Unit Cost</th>
      <th class="w-24">Margin</th>
      <th colspan={3} class="w-96 text-center">Actions</th>
    </tr>
  </thead>
)

// Inner table fragment swapped in by `POST /flavors` (after adding a new
// flavor). The whole `#flavors-card` block re-renders to refresh the layout.
export const FlavorsCard: FC<FlavorsTableProps> = ({ flavors, prices, newFlavorId, addingTierFor }) => {
  const ordered = sortFlavors(flavors)
  return (
    <div
      id="flavors-card"
      class="w-full bg-white dark:bg-[#0a0a0a] rounded-3xl overflow-hidden"
    >
      <div class="flex items-center justify-between px-8 pt-8 pb-6">
        <div>
          <h2 class="text-title-2 text-gray-900 dark:text-zinc-100">Flavors</h2>
          <p class="text-body text-gray-700 dark:text-zinc-300 mt-1">Click any cell to edit inline.</p>
        </div>
        <div class="flex items-center gap-2">
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
