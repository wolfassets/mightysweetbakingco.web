import type { FC, PropsWithChildren } from 'hono/jsx'

export const Card: FC<PropsWithChildren<{ class?: string }>> = ({ class: cls = '', children }) => (
  <div class={`bg-white dark:bg-[#0a0a0a] rounded-3xl ${cls}`}>{children}</div>
)

export const Pill: FC<PropsWithChildren<{ tone?: 'pink' | 'green' | 'red' | 'gray' | 'blue' | 'amber' }>> = ({ tone = 'gray', children }) => {
  const tones: Record<string, string> = {
    pink: 'bg-pink-50 text-pink-700 dark:bg-pink-950/40 dark:text-pink-400',
    green: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400',
    red: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
    gray: 'bg-gray-100 text-gray-700 dark:bg-[#1f1f1f] dark:text-zinc-300',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  }
  return <span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption ${tones[tone]}`}>{children}</span>
}

export const Button: FC<
  PropsWithChildren<{
    variant?: 'primary' | 'ghost' | 'danger' | 'subtle'
    type?: 'button' | 'submit'
    class?: string
    [k: string]: unknown
  }>
> = ({ variant = 'subtle', type = 'button', class: cls = '', children, ...rest }) => {
  const variants: Record<string, string> = {
    primary: 'bg-pink-500 text-white hover:bg-pink-600',
    danger: 'bg-red-500 text-white hover:bg-red-600',
    ghost: 'text-gray-600 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-[#1a1a1a]',
    subtle: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-[#1a1a1a] dark:text-zinc-300 dark:hover:bg-[#262626]',
  }
  return (
    <button type={type} class={`px-3 py-1.5 rounded-full text-button-sm transition-colors ${variants[variant]} ${cls}`} {...rest}>
      {children}
    </button>
  )
}

// Hold-to-archive button (vanilla JS)
export const HoldArchiveButton: FC<{ url: string; target?: string; class?: string }> = ({ url, target = 'closest tr', class: cls }) => {
  const handler = `(function(btn){
    if(btn.dataset.bound)return; btn.dataset.bound='1';
    var label=btn.querySelector('span'), interval=null, ready=false, progress=0;
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
  return (
    <button
      type="button"
      onmouseover={handler}
      class={cls ?? 'relative overflow-hidden rounded-full w-20 py-1 text-button-sm transition-all select-none text-center'}
      style={cls ? undefined : 'background: rgba(254,242,242,1); color: #ef4444; border: 1px solid #fecaca;'}
      hx-delete={url}
      hx-trigger="archive"
      hx-target={target}
      hx-swap="outerHTML"
      title="Hold to archive"
    >
      <span>Archive</span>
    </button>
  )
}

export const PageHeader: FC<PropsWithChildren<{ title: string; subtitle?: string }>> = ({ title, subtitle, children }) => (
  <div class="flex items-end justify-between mb-6">
    <div>
      <h2 class="text-title-1 text-gray-900 dark:text-zinc-100">{title}</h2>
      {subtitle && <p class="text-body text-gray-600 dark:text-zinc-400 mt-1">{subtitle}</p>}
    </div>
    <div class="flex items-center gap-2">{children}</div>
  </div>
)

export const Empty: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <div class="text-center py-16">
    <p class="text-headline text-gray-600 dark:text-zinc-400 uppercase tracking-[0.08em]">{title}</p>
    {children && <div class="mt-2 text-callout text-gray-400 dark:text-zinc-500">{children}</div>}
  </div>
)

export const ErrorBanner: FC<{ message: string }> = ({ message }) => (
  <div class="rounded-2xl bg-red-50 dark:bg-red-950/40 p-3 text-callout text-red-800 dark:text-red-300 mb-4">
    {message}
  </div>
)
