import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configMissing = !url || !anonKey

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
})

export type Expense = {
  id: string
  spent_on: string
  amount: number
  category: string
  method: string
  note: string | null
  created_at: string
}

export type Income = {
  id: string
  received_on: string
  amount: number
  source: string
  note: string | null
  created_at: string
}

export type Balance = {
  id: string
  kind: string
  amount: number
  recorded_on: string
  note: string | null
  created_at: string
}

// Postgres numeric llega como string; lo convertimos a number
export function num<T extends { amount: unknown }>(rows: T[] | null): (T & { amount: number })[] {
  return (rows ?? []).map((r) => ({ ...r, amount: Number(r.amount) }))
}
