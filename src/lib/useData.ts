import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_PLAN, type Plan } from './config'
import { supabase, num, type Balance, type Expense, type Income } from './supabase'

export type Data = {
  expenses: Expense[]
  incomes: Income[]
  balances: Balance[]
  plan: Plan
  hasPlan: boolean // false = usando la plantilla generica
}

const EMPTY: Data = { expenses: [], incomes: [], balances: [], plan: DEFAULT_PLAN, hasPlan: false }

// Completa campos faltantes por si el JSON guardado es de una version anterior
function normalizePlan(raw: Partial<Plan> | null | undefined): Plan {
  return {
    categories: raw?.categories ?? DEFAULT_PLAN.categories,
    debtTargetPerQuincena: Number(raw?.debtTargetPerQuincena ?? 0),
    methods: raw?.methods?.length ? raw.methods : DEFAULT_PLAN.methods,
    incomeSources: raw?.incomeSources?.length ? raw.incomeSources : DEFAULT_PLAN.incomeSources,
    goals: raw?.goals ?? DEFAULT_PLAN.goals,
    rules: raw?.rules ?? [],
  }
}

export function useData(enabled: boolean) {
  const [data, setData] = useState<Data>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    const [e, i, b, p] = await Promise.all([
      supabase.from('expenses').select('*').order('spent_on', { ascending: false }).order('created_at', { ascending: false }).range(0, 9999),
      supabase.from('incomes').select('*').order('received_on', { ascending: false }).range(0, 9999),
      supabase.from('balances').select('*').order('recorded_on', { ascending: false }).order('created_at', { ascending: false }).range(0, 9999),
      supabase.from('plans').select('data').maybeSingle(),
    ])
    const err = e.error ?? i.error ?? b.error ?? p.error
    if (err) setError(err.message)
    else
      setData({
        expenses: num(e.data),
        incomes: num(i.data),
        balances: num(b.data),
        plan: normalizePlan(p.data?.data as Partial<Plan> | undefined),
        hasPlan: !!p.data,
      })
    setLoading(false)
  }, [enabled])

  useEffect(() => {
    if (enabled) reload()
    else setData(EMPTY)
  }, [enabled, reload])

  return { data, loading, error, reload }
}

export async function savePlan(plan: Plan) {
  const { data: u } = await supabase.auth.getUser()
  return supabase.from('plans').upsert({ user_id: u.user?.id, data: plan, updated_at: new Date().toISOString() })
}

// Ultimo saldo registrado de una meta, o el valor inicial del plan
export function latestBalance(balances: Balance[], kind: string, fallback: number): number {
  const row = balances.find((b) => b.kind === kind)
  return row ? row.amount : fallback
}
