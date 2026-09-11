import { AsyncLocalStorage } from 'node:async_hooks'

const API_BASE = process.env.API_BASE ?? 'http://localhost:3000'
export const apiRequestContext = new AsyncLocalStorage<{ ip: string | null }>()

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  headers.delete('x-forwarded-for')
  const ip = apiRequestContext.getStore()?.ip
  if (ip) headers.set('x-forwarded-for', ip)
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API ${res.status} ${path}: ${body.slice(0, 300)}`)
  }
  const json = (await res.json()) as { data?: T }
  return (json.data ?? (json as unknown as T)) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  base: API_BASE,
}
