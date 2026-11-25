// Carga tu plan personal (JSON fuera del repo) a Supabase.
// Uso: npm run seed-plan -- ../plan.json [correo]
// Requiere app/.env.local con VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
config({ path: join(root, '.env.local'), quiet: true })

const [file = '../plan.json', email] = process.argv.slice(2)
const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Falta VITE_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en app/.env.local')
  process.exit(1)
}

const plan = JSON.parse(readFileSync(resolve(root, file), 'utf8'))
const db = createClient(url, key, { auth: { persistSession: false } })

const { data: list, error: uErr } = await db.auth.admin.listUsers()
if (uErr) throw uErr
const users = email ? list.users.filter((u) => u.email === email) : list.users
if (users.length !== 1) {
  console.error(`Encontré ${users.length} usuarios. Pasa el correo como segundo argumento.`)
  process.exit(1)
}

// Los pagos programados se manejan desde la app: si el JSON no trae, se conservan los guardados
if (!Array.isArray(plan.bills)) {
  const { data: cur } = await db.from('plans').select('data').eq('user_id', users[0].id).maybeSingle()
  plan.bills = cur?.data?.bills ?? []
}

const { error } = await db.from('plans').upsert({ user_id: users[0].id, data: plan, updated_at: new Date().toISOString() })
if (error) throw error
console.log(`Plan cargado para ${users[0].email}: ${plan.categories.length} sobres, ${plan.goals.length} metas.`)
