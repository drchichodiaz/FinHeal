# FinHeal

> An app for healing your financial life.

App para anotar gastos en el momento, controlar sobres por quincena y ver cómo bajan tus deudas.
Stack: Vite + React + TypeScript + Tailwind v4 · Supabase (Postgres + Auth + RLS) · Vercel · PWA.

**Privacidad:** el código no contiene datos de nadie. Tu plan (sobres, montos, metas) y tus movimientos viven en tu propio proyecto de Supabase, protegidos con Row Level Security.

## 1. Supabase

1. Crea un proyecto en <https://supabase.com/dashboard> (elige la región más cercana).
2. **SQL Editor → New query** → pega todo [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
3. **Authentication → Users → Add user → Create new user**: tu correo y una contraseña, con **Auto Confirm User** marcado.
4. **Authentication → Sign In / Providers**: desactiva **Allow new users to sign up**.
5. **Project Settings → API Keys**: copia la URL, la *publishable/anon key* y la *secret/service_role key*.

## 2. Local

```bash
cp .env.example .env.local   # llena los 3 valores
npm install
npm run dev                  # http://localhost:5173 (también accesible desde tu Wi-Fi)
```

## 3. Tu plan

Opción A: en la app, pestaña **⚙️ Plan**: edita sobres, metas y reglas y guarda.

Opción B: carga un JSON que tengas **fuera del repo** (misma forma que `Plan` en [`src/lib/config.ts`](src/lib/config.ts)):

```bash
npm run seed-plan -- ../plan.json
```

## 4. Vercel

**Add New → Project → Import** el repo. En **Environment Variables** agrega:

| Variable | Para qué | ¿Llega al navegador? |
|---|---|---|
| `VITE_SUPABASE_URL` | App y servidor | Sí (es pública) |
| `VITE_SUPABASE_ANON_KEY` | App y servidor | Sí (es pública, la protege RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo el conector MCP (`/api`) | **No.** Vite solo expone variables `VITE_*` |
| `MCP_JWT_SECRET` | Firma los tokens OAuth del conector (≥ 32 caracteres aleatorios) | No |
| `APP_TZ` | Zona horaria para "hoy" (ej. `America/New_York`) | No |

Nunca pongas la service role key en una variable `VITE_*` ni en el repo.

## 5. En el celular

Abre la URL, inicia sesión y:
- **Android (Chrome):** menú ⋮ → *Agregar a pantalla principal*.
- **iPhone (Safari):** Compartir → *Agregar a inicio*.

## Conector para Claude (MCP + OAuth)

FinHeal incluye un servidor MCP en `/api/mcp` para usar la app desde Claude (web, escritorio y móvil).

1. En claude.ai: **Settings → Connectors → Add custom connector**.
2. URL: `https://TU-DOMINIO/api/mcp`.
3. Claude abre la pantalla de autorización de FinHeal: entra con tu correo y contraseña.

Herramientas: `resumen_quincena`, `listar_movimientos`, `anotar_gasto`, `anotar_ingreso`, `ver_metas`, `actualizar_meta`, `borrar_movimiento`, `ver_plan`, y para pagos programados `ver_pagos`, `agendar_pago`, `apartar_pago`, `pagar_programado`, `borrar_pago`.

Seguridad: OAuth 2.1 con PKCE S256 y registro dinámico de clientes (solo se aceptan callbacks de claude.ai, claude.com y localhost). Los tokens son JWT firmados con `MCP_JWT_SECRET` (access 1 h, refresh 90 días). **Rotar `MCP_JWT_SECRET` revoca todas las conexiones.** Cada consulta filtra por el usuario del token.

## Exportar datos

```bash
npm run export   # escribe ../exports/finanzas-latest.json
```

También hay un botón **Exportar (CSV)** en la pestaña Historial.
