// Exporta todos los datos de Supabase a ../exports/ para la revision de quincena con Claude.
// Uso: npm run export   (requiere .env.local con VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY)
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
config({ path: join(root, '.env.local'), quiet: true })

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Falta VITE_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en app/.env.local')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })
const out = join(root, '..', 'exports')
mkdirSync(out, { recursive: true })

const result = {}
for (const [table, order] of [['expenses', 'spent_on'], ['incomes', 'received_on'], ['balances', 'recorded_on']]) {
  const { data, error } = await db.from(table).select('*').order(order, { ascending: true }).range(0, 49999)
  if (error) {
    console.error(`${table}: ${error.message}`)
    process.exit(1)
  }
  result[table] = data.map(({ user_id, ...r }) => ({ ...r, amount: Number(r.amount) }))
  console.log(`${table}: ${data.length} filas`)
}

const file = join(out, 'finanzas-latest.json')
writeFileSync(file, JSON.stringify({ exported_at: new Date().toISOString(), ...result }, null, 2))
console.log(`Guardado en ${file}`)
