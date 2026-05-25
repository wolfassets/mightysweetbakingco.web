export const usd = (n: number | null | undefined) => {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export const pct = (n: number | null | undefined, digits = 1) => {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

export const date = (s: string | null | undefined) => {
  if (!s) return '—'
  const d = new Date(s.includes('T') ? s : `${s}T00:00:00`)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export const dateLong = (s: string | null | undefined) => {
  if (!s) return '—'
  const d = new Date(s.includes('T') ? s : `${s}T00:00:00`)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export const dateShort = (s: string | null | undefined) => {
  if (!s) return '—'
  const d = new Date(s.includes('T') ? s : `${s}T00:00:00`)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export const isoDate = (s: string | null | undefined) => {
  if (!s) return ''
  return s.slice(0, 10)
}

export const relativeTime = (s: string | null | undefined) => {
  if (!s) return '—'
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
  if (isNaN(d.getTime())) return s
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export const num = (n: number | null | undefined) => {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US').format(n)
}
