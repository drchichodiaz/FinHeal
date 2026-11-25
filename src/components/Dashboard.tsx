import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { debtGoals, debtSeries, dayMonth, monthYear, planAt, planLine, quincenaStat, recentQuincenas, totalDebtPaid, type DebtPoint, type PlanLine, type QuincenaStat } from '../lib/dashboard'
import { fromISO, periodFor, todayISO } from '../lib/dates'
import { money } from '../lib/format'
import { latestBalance, type Data } from '../lib/useData'
import { Card } from './ui'
import { PagosResumen } from './Pagos'

// Tokens de grafica (paleta de referencia dataviz, superficie clara)
const C = {
  accent: '#2a78d6',
  track: '#cde2fb',
  plan: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  ink2: '#52514e',
  muted: '#898781',
  good: '#0ca30c',
  warning: '#fab219',
  critical: '#d03b3b',
  surface: '#ffffff',
}
const DAY = 86400000

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(320)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

function niceScale(max: number, ticks = 4) {
  if (max <= 0) return { max: 100, step: 25 }
  const raw = max / ticks
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  return { max: Math.ceil(max / step) * step, step }
}

const compact = (n: number) => (n >= 10000 ? `$${Math.round(n / 1000)}K` : `$${n.toLocaleString('es-PA')}`)

export function Dashboard({ data, goTo }: { data: Data; goTo: (tab: 'metas' | 'quincena') => void }) {
  const series = useMemo(() => debtSeries(data), [data])
  const plan = useMemo(() => planLine(data, series), [data, series])
  const q = useMemo(() => quincenaStat(data, periodFor(todayISO())), [data])
  const history = useMemo(() => recentQuincenas(data), [data])
  const debts = debtGoals(data)
  const others = data.plan.goals.filter((g) => g.type !== 'deuda')

  const start = series[0]
  const now = series[series.length - 1]
  const drop = start && now ? Math.max(0, start.total - now.total) : 0
  const paid = start ? totalDebtPaid(data, start.date) : 0
  const daysLeft = Math.max(0, Math.round((fromISO(q.period.end).getTime() - fromISO(todayISO()).getTime()) / DAY) + 1)

  return (
    <div className="space-y-4">
      {/* Hero: la cifra que manda */}
      <Card>
        <div className="text-sm text-slate-500">Deuda total</div>
        <div className="text-5xl font-semibold tracking-tight text-slate-900">{money(now?.total ?? 0)}</div>
        <div className="mt-1 text-sm">
          {drop > 0 ? (
            <span style={{ color: '#006300' }}>▼ {money(drop)} menos desde {start && dayMonth(fromISO(start.date).getTime())}</span>
          ) : (
            <span className="text-slate-500">Sin cambios desde {start ? dayMonth(fromISO(start.date).getTime()) : 'el inicio'}</span>
          )}
          {plan?.payoff && <span className="text-slate-500"> · al ritmo del plan, libre en {monthYear(plan.payoff)}</span>}
        </div>
      </Card>

      {/* KPI de la quincena */}
      <div>
        <div className="mb-2 flex items-baseline justify-between px-1">
          <h2 className="font-semibold text-slate-900">{q.period.label}</h2>
          <button onClick={() => goTo('quincena')} className="text-sm font-medium text-emerald-700">
            Ver sobres →
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Tile label="Queda en cuenta" value={money(q.left)} tone={q.left < 0 ? 'critical' : undefined} sub={`${daysLeft} días restantes`} />
          <Tile label="Ingresos" value={money(q.income)} sub="esta quincena" />
          <MeterTile label="Gastado en sobres" value={q.spent} max={q.budget} kind="spend" />
          <MeterTile label="Abono a deudas" value={q.debt} max={data.plan.debtTargetPerQuincena} kind="goal" />
        </div>
      </div>

      <PagosResumen data={data} onOpen={() => goTo('metas')} />

      {/* Tendencia de deuda */}
      <Card>
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="font-semibold text-slate-900">¿Va bajando la deuda?</h2>
          <span className="text-xs text-slate-500">Abonado: {money(paid)}</span>
        </div>
        <Legend items={[{ color: C.accent, label: 'Deuda real' }, ...(plan ? [{ color: C.plan, label: 'Ritmo del plan' }] : [])]} />
        <DebtChart series={series} plan={plan} />
        {series.length < 2 && (
          <p className="mt-2 text-xs text-slate-500">
            La línea crece cada vez que anotas un pago a deudas o actualizas un saldo en Metas (después de cada corte).
          </p>
        )}
        <DataTable
          head={['Fecha', 'Deuda real', 'Plan']}
          rows={series.map((p) => [dayMonth(fromISO(p.date).getTime()), money(p.total), plan ? money(planAt(plan, fromISO(p.date).getTime())) : '—'])}
        />
      </Card>

      {/* Cada deuda */}
      <Card>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-semibold text-slate-900">Deudas</h2>
          <button onClick={() => goTo('metas')} className="text-sm font-medium text-emerald-700">
            Actualizar →
          </button>
        </div>
        <MeterList
          rows={debts.map((g) => {
            const cur = latestBalance(data.balances, g.kind, g.initial)
            return { key: g.kind, name: `${g.icon} ${g.label}`, value: Math.max(0, g.initial - cur), max: g.initial, figure: `${money(cur)} restante`, note: g.hint }
          })}
        />
      </Card>

      {others.length > 0 && (
        <Card>
          <h2 className="mb-3 font-semibold text-slate-900">Ahorro y por cobrar</h2>
          <MeterList
            rows={others.map((g) => {
              const cur = latestBalance(data.balances, g.kind, g.initial)
              return g.type === 'ahorro'
                ? { key: g.kind, name: `${g.icon} ${g.label}`, value: cur, max: g.target, figure: `${money(cur)} de ${money(g.target)}`, note: g.hint }
                : { key: g.kind, name: `${g.icon} ${g.label}`, value: Math.max(0, g.initial - cur), max: g.initial, figure: `${money(cur)} pendiente`, note: g.hint }
            })}
          />
        </Card>
      )}

      {/* Historial de quincenas */}
      {history.length > 0 && (
        <Card>
          <h2 className="font-semibold text-slate-900">Gasto por quincena</h2>
          <p className="mb-2 text-xs text-slate-500">Sin contar abonos a deudas. La línea es tu presupuesto de sobres.</p>
          <QuincenaBars stats={history} />
          <DataTable
            head={['Quincena', 'Gastado', 'Presupuesto', 'A deudas']}
            rows={history.map((s) => [dayMonth(fromISO(s.period.start).getTime()), money(s.spent), money(s.budget), money(s.debt)])}
          />
        </Card>
      )}
    </div>
  )
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'critical' }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-semibold text-slate-900">
        {tone === 'critical' && <span style={{ color: C.critical }}>⚠ </span>}
        {value}
      </div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </Card>
  )
}

// Meter: el relleno lleva el estado; el riel es un paso claro de la misma rampa
function MeterTile({ label, value, max, kind }: { label: string; value: number; max: number; kind: 'spend' | 'goal' }) {
  const pct = max > 0 ? value / max : 0
  let fill = C.accent
  let status = ''
  if (kind === 'spend') {
    if (pct > 1) [fill, status] = [C.critical, '⚠ Pasado']
    else if (pct >= 0.8) [fill, status] = [C.warning, '● Casi al límite']
  } else if (pct >= 1) [fill, status] = [C.good, '✓ Meta cumplida']
  return (
    <Card className="p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-semibold text-slate-900">{money(value)}</div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ background: C.track }} role="meter" aria-valuenow={value} aria-valuemax={max} aria-label={label}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct * 100)}%`, background: fill }} />
      </div>
      <div className="mt-1 text-xs text-slate-500">
        {status ? <span className="font-medium text-slate-700">{status} · </span> : null}de {money(max)}
      </div>
    </Card>
  )
}

function MeterList({ rows }: { rows: { key: string; name: string; value: number; max: number; figure: string; note?: string }[] }) {
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const pct = r.max > 0 ? Math.min(1, Math.max(0, r.value / r.max)) : 0
        return (
          <li key={r.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-slate-800">{r.name}</span>
              <span className="shrink-0 text-slate-600">
                {r.figure} <span className="text-slate-400">· {Math.round(pct * 100)}%</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: C.track }} role="meter" aria-valuenow={Math.round(pct * 100)} aria-valuemax={100} aria-label={r.name}>
              <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: pct >= 1 ? C.good : C.accent }} />
            </div>
            {r.note && <div className="mt-0.5 text-xs text-slate-400">{r.note}</div>}
          </li>
        )
      })}
    </ul>
  )
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  if (items.length < 2) return null
  return (
    <div className="mb-1 flex gap-4 text-xs text-slate-600">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <svg width="16" height="4" aria-hidden>
            <line x1="0" y1="2" x2="16" y2="2" stroke={i.color} strokeWidth="2" strokeLinecap="round" />
          </svg>
          {i.label}
        </span>
      ))}
    </div>
  )
}

function DataTable({ head, rows }: { head: string[]; rows: string[][] }) {
  if (!rows.length) return null
  return (
    <details className="mt-2 text-xs text-slate-500">
      <summary className="cursor-pointer select-none">Ver datos</summary>
      <table className="mt-2 w-full tabular-nums">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`py-1 font-medium ${i ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 text-slate-700">
              {r.map((c, j) => (
                <td key={j} className={`py-1 ${j ? 'text-right' : ''}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(8, x - 70), width - 148)
  return (
    <div className="pointer-events-none absolute z-10 w-36 rounded-lg bg-white px-2.5 py-1.5 text-xs shadow-lg ring-1 ring-slate-200" style={{ left, top: Math.max(0, y - 64) }}>
      {children}
    </div>
  )
}

function DebtChart({ series, plan }: { series: DebtPoint[]; plan: PlanLine | null }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const H = 200
  const m = { l: 44, r: 14, t: 18, b: 24 }
  const w = width - m.l - m.r
  const h = H - m.t - m.b

  const pts = series.map((p) => ({ t: fromISO(p.date).getTime(), v: p.total }))
  if (!pts.length) return null
  const t0 = pts[0].t
  let t1 = Math.max(pts[pts.length - 1].t, plan?.payoff ?? 0)
  if (t1 - t0 < 30 * DAY) t1 = t0 + 30 * DAY
  const { max, step } = niceScale(Math.max(...pts.map((p) => p.v), plan?.startTotal ?? 0) * 1.05)
  const x = (t: number) => m.l + ((t - t0) / (t1 - t0)) * w
  const y = (v: number) => m.t + h - (v / max) * h

  const yTicks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step)
  const months: number[] = []
  const d = new Date(t0)
  d.setDate(1)
  d.setMonth(d.getMonth() + 1)
  while (d.getTime() <= t1) {
    months.push(d.getTime())
    d.setMonth(d.getMonth() + 1)
  }
  const every = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor(w / 70))))
  const xTicks = months.filter((_, i) => i % every === 0)

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
  const area = `${line}L${x(pts[pts.length - 1].t).toFixed(1)},${y(0)}L${x(pts[0].t).toFixed(1)},${y(0)}Z`
  const last = pts[pts.length - 1]

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - box.left
    let best = 0
    for (let i = 1; i < pts.length; i++) if (Math.abs(x(pts[i].t) - px) < Math.abs(x(pts[best].t) - px)) best = i
    setHover(best)
  }
  const hp = hover !== null ? pts[hover] : null

  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={`Deuda total: ${money(last.v)} hoy${plan?.payoff ? `; según el plan, en cero en ${monthYear(plan.payoff)}` : ''}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        className="touch-pan-y"
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={width - m.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? C.axis : C.grid} strokeWidth="1" />
            <text x={m.l - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize="10" fill={C.muted} className="tabular-nums">
              {compact(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={H - 6} textAnchor="middle" fontSize="10" fill={C.muted}>
            {monthYear(t).replace(/ \d{2}(\d{2})$/, " '$1")}
          </text>
        ))}

        {plan && (
          <>
            <line
              x1={x(plan.start)}
              y1={y(plan.startTotal)}
              x2={x(Math.min(t1, plan.payoff ?? t1))}
              y2={y(planAt(plan, Math.min(t1, plan.payoff ?? t1)))}
              stroke={C.plan}
              strokeWidth="2"
              strokeLinecap="round"
            />
            {plan.payoff && plan.payoff <= t1 && (
              <text x={x(plan.payoff)} y={y(0) - 8} textAnchor="end" fontSize="10" fill={C.ink2}>
                Meta: $0 en {monthYear(plan.payoff)}
              </text>
            )}
          </>
        )}

        <path d={area} fill={C.accent} opacity="0.1" />
        <path d={line} fill="none" stroke={C.accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.t)} cy={y(last.v)} r="4" fill={C.accent} stroke={C.surface} strokeWidth="2" />
        <text x={Math.min(x(last.t) + 8, width - m.r)} y={y(last.v) - 8} textAnchor={x(last.t) + 80 > width ? 'end' : 'start'} fontSize="11" fontWeight="600" fill="#0b0b0b">
          {money(last.v)}
        </text>

        {hp && (
          <>
            <line x1={x(hp.t)} x2={x(hp.t)} y1={m.t} y2={y(0)} stroke={C.axis} strokeWidth="1" />
            <circle cx={x(hp.t)} cy={y(hp.v)} r="5" fill={C.accent} stroke={C.surface} strokeWidth="2" />
          </>
        )}
        <rect x={m.l} y={m.t} width={w} height={h} fill="transparent" />
      </svg>
      {hp && (
        <Tooltip x={x(hp.t)} y={y(hp.v)} width={width}>
          <div className="text-slate-500">{dayMonth(hp.t)}</div>
          <Row color={C.accent} value={money(hp.v)} label="real" />
          {plan && <Row color={C.plan} value={money(planAt(plan, hp.t))} label="plan" />}
        </Tooltip>
      )}
    </div>
  )
}

function Row({ color, value, label }: { color: string; value: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <svg width="10" height="4" aria-hidden>
        <line x1="0" y1="2" x2="10" y2="2" stroke={color} strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="font-semibold text-slate-900">{value}</span>
      <span className="text-slate-500">{label}</span>
    </div>
  )
}

function QuincenaBars({ stats }: { stats: QuincenaStat[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const H = 170
  const m = { l: 44, r: 10, t: 20, b: 24 }
  const w = width - m.l - m.r
  const h = H - m.t - m.b
  const budget = stats[stats.length - 1]?.budget ?? 0
  const { max, step } = niceScale(Math.max(budget, ...stats.map((s) => s.spent)) * 1.1)
  const band = w / Math.max(stats.length, 1)
  const bw = Math.min(24, band * 0.6)
  const y = (v: number) => m.t + h - (v / max) * h
  const yTicks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step)
  const r = 4

  const bar = (cx: number, v: number) => {
    const top = y(v)
    const bottom = y(0)
    const hh = bottom - top
    if (hh <= 0) return ''
    const rr = Math.min(r, hh, bw / 2)
    const xl = cx - bw / 2
    const xr = cx + bw / 2
    return `M${xl},${bottom}V${top + rr}Q${xl},${top} ${xl + rr},${top}H${xr - rr}Q${xr},${top} ${xr},${top + rr}V${bottom}Z`
  }
  const hs = hover !== null ? stats[hover] : null

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={H} role="img" aria-label="Gasto por quincena contra el presupuesto" onPointerLeave={() => setHover(null)}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={width - m.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? C.axis : C.grid} strokeWidth="1" />
            <text x={m.l - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize="10" fill={C.muted}>
              {compact(v)}
            </text>
          </g>
        ))}
        {budget > 0 && (
          <>
            <line x1={m.l} x2={width - m.r} y1={y(budget)} y2={y(budget)} stroke={C.ink2} strokeWidth="1" />
            <text x={width - m.r} y={y(budget) - 4} textAnchor="end" fontSize="10" fill={C.ink2}>
              Presupuesto {money(budget)}
            </text>
          </>
        )}
        {stats.map((s, i) => {
          const cx = m.l + band * i + band / 2
          const over = s.spent > s.budget && s.budget > 0
          return (
            <g key={s.period.start} onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${s.period.label}: ${money(s.spent)} de ${money(s.budget)}`}>
              <rect x={m.l + band * i} y={m.t} width={band} height={h} fill="transparent" />
              <path d={bar(cx, s.spent)} fill={over ? C.critical : C.accent} opacity={hover === null || hover === i ? 1 : 0.55} />
              {s.spent > 0 && (
                <text x={cx} y={y(s.spent) - 5} textAnchor="middle" fontSize="10" fill="#0b0b0b">
                  {over ? '⚠ ' : ''}
                  {compact(Math.round(s.spent))}
                </text>
              )}
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill={s.current ? '#0b0b0b' : C.muted} fontWeight={s.current ? 600 : 400}>
                {dayMonth(fromISO(s.period.start).getTime())}
              </text>
            </g>
          )
        })}
      </svg>
      {hs && hover !== null && (
        <Tooltip x={m.l + band * hover + band / 2} y={y(Math.max(hs.spent, hs.budget))} width={width}>
          <div className="text-slate-500">{hs.period.label.replace('Quincena del ', '')}</div>
          <div>
            <span className="font-semibold text-slate-900">{money(hs.spent)}</span> <span className="text-slate-500">gastado</span>
          </div>
          <div>
            <span className="font-semibold text-slate-900">{money(hs.debt)}</span> <span className="text-slate-500">a deudas</span>
          </div>
          <div>
            <span className="font-semibold text-slate-900">{money(hs.income)}</span> <span className="text-slate-500">ingresos</span>
          </div>
        </Tooltip>
      )}
    </div>
  )
}
