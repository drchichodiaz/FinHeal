import { useEffect, useState } from 'react'
import { newId, type Category, type Goal, type GoalType, type Plan } from '../lib/config'
import { money, round2 } from '../lib/format'
import { savePlan, type Data } from '../lib/useData'
import { Card } from './ui'

const input = 'min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-emerald-500'
const TYPE_LABEL: Record<GoalType, string> = { deuda: 'Debo', ahorro: 'Ahorro', cobrar: 'Me deben' }

const toList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

export function PlanEditor({ data, onSaved }: { data: Data; onSaved: (msg: string) => void }) {
  const [plan, setPlan] = useState<Plan>(data.plan)
  const [methods, setMethods] = useState(data.plan.methods.join(', '))
  const [sources, setSources] = useState(data.plan.incomeSources.join(', '))
  const [rules, setRules] = useState(data.plan.rules.join('\n'))
  const [busy, setBusy] = useState(false)

  // Si el plan llega desde Supabase despues de abrir la pantalla, refrescar el formulario
  useEffect(() => {
    setPlan(data.plan)
    setMethods(data.plan.methods.join(', '))
    setSources(data.plan.incomeSources.join(', '))
    setRules(data.plan.rules.join('\n'))
  }, [data.plan])

  const setCat = (i: number, patch: Partial<Category>) =>
    setPlan((p) => ({ ...p, categories: p.categories.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))
  const setGoal = (i: number, patch: Partial<Goal>) =>
    setPlan((p) => ({ ...p, goals: p.goals.map((g, j) => (j === i ? { ...g, ...patch } : g)) }))

  const totalQ = round2(plan.categories.reduce((t, c) => t + (Number(c.budget) || 0), 0))

  async function save() {
    const clean: Plan = {
      bills: data.plan.bills, // se editan en Metas; usar siempre lo ultimo guardado
      categories: plan.categories
        .filter((c) => c.label.trim())
        .map((c) => ({ ...c, label: c.label.trim(), budget: round2(Number(c.budget) || 0) })),
      debtTargetPerQuincena: round2(Number(plan.debtTargetPerQuincena) || 0),
      methods: toList(methods).length ? toList(methods) : ['Efectivo'],
      incomeSources: toList(sources).length ? toList(sources) : ['Salario'],
      goals: plan.goals
        .filter((g) => g.label.trim())
        .map((g) => ({
          ...g,
          label: g.label.trim(),
          initial: round2(Number(g.initial) || 0),
          target: round2(Number(g.target) || 0),
          reducedBySource: g.reducedBySource || undefined,
        })),
      rules: rules
        .split('\n')
        .map((r) => r.trim())
        .filter(Boolean),
    }
    setBusy(true)
    const { error } = await savePlan(clean)
    setBusy(false)
    onSaved(error ? `Error: ${error.message}` : 'Plan guardado')
  }

  return (
    <div className="space-y-4">
      {!data.hasPlan && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          Estás usando la plantilla de ejemplo. Ajusta los montos y guarda para crear tu plan.
        </p>
      )}

      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold text-slate-900">Sobres por quincena</h2>
          <span className="text-sm text-slate-500">{money(totalQ)}</span>
        </div>
        <div className="space-y-2">
          {plan.categories.map((c, i) => (
            <div key={c.id} className="grid grid-cols-[3rem_1fr_5.5rem_2rem] gap-2">
              <input className={`${input} text-center`} value={c.icon} onChange={(e) => setCat(i, { icon: e.target.value })} />
              <input className={input} value={c.label} onChange={(e) => setCat(i, { label: e.target.value })} />
              <input
                className={`${input} text-right`}
                inputMode="decimal"
                value={String(c.budget)}
                onChange={(e) => setCat(i, { budget: e.target.value as unknown as number })}
              />
              <button
                onClick={() => setPlan((p) => ({ ...p, categories: p.categories.filter((_, j) => j !== i) }))}
                className="text-slate-400"
                aria-label="Quitar"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => setPlan((p) => ({ ...p, categories: [...p.categories, { id: newId('cat'), label: '', icon: '•', budget: 0 }] }))}
          className="mt-2 text-sm font-medium text-emerald-700"
        >
          + Agregar sobre
        </button>
      </Card>

      <Card>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold text-slate-900">💳 Meta de abono a deudas por quincena</span>
          <input
            className={`${input} w-24 text-right`}
            inputMode="decimal"
            value={String(plan.debtTargetPerQuincena)}
            onChange={(e) => setPlan((p) => ({ ...p, debtTargetPerQuincena: e.target.value as unknown as number }))}
          />
        </label>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-slate-900">Metas y deudas</h2>
        <div className="space-y-3">
          {plan.goals.map((g, i) => (
            <div key={g.kind} className="space-y-2 rounded-xl bg-slate-50 p-2">
              <div className="grid grid-cols-[3rem_1fr_2rem] gap-2">
                <input className={`${input} text-center`} value={g.icon} onChange={(e) => setGoal(i, { icon: e.target.value })} />
                <input className={input} value={g.label} onChange={(e) => setGoal(i, { label: e.target.value })} />
                <button
                  onClick={() => setPlan((p) => ({ ...p, goals: p.goals.filter((_, j) => j !== i) }))}
                  className="text-slate-400"
                  aria-label="Quitar"
                >
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-slate-500">
                <label className="space-y-1">
                  <span>Tipo</span>
                  <select className={`${input} w-full`} value={g.type} onChange={(e) => setGoal(i, { type: e.target.value as GoalType })}>
                    {(Object.keys(TYPE_LABEL) as GoalType[]).map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span>Inicial</span>
                  <input
                    className={`${input} w-full text-right`}
                    inputMode="decimal"
                    value={String(g.initial)}
                    onChange={(e) => setGoal(i, { initial: e.target.value as unknown as number })}
                  />
                </label>
                <label className="space-y-1">
                  <span>Meta</span>
                  <input
                    className={`${input} w-full text-right`}
                    inputMode="decimal"
                    value={String(g.target)}
                    onChange={(e) => setGoal(i, { target: e.target.value as unknown as number })}
                  />
                </label>
              </div>
              <input className={`${input} w-full`} placeholder="Nota (ej. fecha meta)" value={g.hint} onChange={(e) => setGoal(i, { hint: e.target.value })} />
              {g.type === 'cobrar' && (
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="shrink-0">Baja sola con ingresos de:</span>
                  <select
                    className={`${input} w-full`}
                    value={g.reducedBySource ?? ''}
                    onChange={(e) => setGoal(i, { reducedBySource: e.target.value })}
                  >
                    <option value="">—</option>
                    {toList(sources).map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={() =>
            setPlan((p) => ({ ...p, goals: [...p.goals, { kind: newId('meta'), label: '', icon: '🎯', type: 'ahorro', initial: 0, target: 0, hint: '' }] }))
          }
          className="mt-2 text-sm font-medium text-emerald-700"
        >
          + Agregar meta
        </button>
      </Card>

      <Card className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span className="font-semibold text-slate-900">Métodos de pago</span>
          <input className={`${input} w-full`} value={methods} onChange={(e) => setMethods(e.target.value)} />
          <span className="text-xs text-slate-500">Separados por coma</span>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-semibold text-slate-900">Tipos de ingreso</span>
          <input className={`${input} w-full`} value={sources} onChange={(e) => setSources(e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-semibold text-slate-900">Reglas</span>
          <textarea rows={4} className={`${input} w-full`} value={rules} onChange={(e) => setRules(e.target.value)} />
          <span className="text-xs text-slate-500">Una por línea</span>
        </label>
      </Card>

      <button
        onClick={save}
        disabled={busy}
        className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-semibold text-white active:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? 'Guardando…' : 'Guardar plan'}
      </button>
    </div>
  )
}
