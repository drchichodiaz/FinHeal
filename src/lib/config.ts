// Plantilla generica. El plan real de cada usuario vive en Supabase (tabla `plans`)
// y se edita desde la pantalla "Plan" o se carga con `npm run seed-plan`.
// No pongas datos personales en este archivo: el repo es publico.

export type Category = {
  id: string
  label: string
  icon: string
  budget: number // por quincena; 0 = sin sobre
}

export type GoalType = 'deuda' | 'ahorro' | 'cobrar'

export type Goal = {
  kind: string
  label: string
  icon: string
  type: GoalType // deuda = lo que debo, ahorro = lo que junto, cobrar = lo que me deben
  initial: number
  target: number
  hint: string
  reducedBySource?: string // si llega un ingreso con esta fuente, el saldo baja solo
}

export type Plan = {
  categories: Category[]
  debtTargetPerQuincena: number
  methods: string[]
  incomeSources: string[]
  goals: Goal[]
  rules: string[]
}

// Categoria fija para abonos a deudas: no cuenta contra los sobres
export const DEBT_CATEGORY: Category = { id: 'deuda', label: 'Pago a deudas', icon: '💳', budget: 0 }

export const DEFAULT_PLAN: Plan = {
  categories: [
    { id: 'super', label: 'Súper', icon: '🛒', budget: 0 },
    { id: 'salidas', label: 'Comida fuera / social', icon: '🍔', budget: 0 },
    { id: 'transporte', label: 'Transporte', icon: '⛽', budget: 0 },
    { id: 'servicios', label: 'Servicios', icon: '💡', budget: 0 },
    { id: 'celular', label: 'Celular', icon: '📱', budget: 0 },
    { id: 'suscripciones', label: 'Suscripciones', icon: '🔁', budget: 0 },
    { id: 'imprevistos', label: 'Imprevistos', icon: '🧰', budget: 0 },
  ],
  debtTargetPerQuincena: 0,
  methods: ['Efectivo', 'Débito', 'Transferencia'],
  incomeSources: ['Salario', 'Extra', 'Otro'],
  goals: [
    { kind: 'tarjeta', label: 'Tarjeta de crédito', icon: '💳', type: 'deuda', initial: 0, target: 0, hint: '' },
    { kind: 'colchon', label: 'Fondo de emergencia', icon: '🛟', type: 'ahorro', initial: 0, target: 0, hint: '' },
  ],
  rules: [],
}

export function allCategories(plan: Plan): Category[] {
  return [...plan.categories, DEBT_CATEGORY]
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}
