// JWT HS256 minimo con Web Crypto (sin dependencias).
// Todos los artefactos OAuth (client_id, code, access, refresh) son JWT firmados con
// MCP_JWT_SECRET, asi el servidor no guarda estado. Rotar el secreto revoca todo.

const enc = new TextEncoder()
const dec = new TextDecoder()

export function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

let keyCache: { secret: string; key: CryptoKey } | null = null
async function hmacKey(secret: string): Promise<CryptoKey> {
  if (keyCache?.secret === secret) return keyCache.key
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  keyCache = { secret, key }
  return key
}

function secret(): string {
  const s = process.env.MCP_JWT_SECRET
  if (!s || s.length < 32) throw new Error('MCP_JWT_SECRET no configurado (minimo 32 caracteres)')
  return s
}

export type TokenType = 'client' | 'code' | 'access' | 'refresh'

export type Claims = { typ: TokenType; iss: string; exp: number; iat: number; [k: string]: unknown }

export async function sign(typ: TokenType, iss: string, ttlSeconds: number, payload: Record<string, unknown>): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64url(enc.encode(JSON.stringify({ ...payload, typ, iss, iat: now, exp: now + ttlSeconds })))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret()), enc.encode(`${header}.${body}`))
  return `${header}.${body}.${b64url(new Uint8Array(sig))}`
}

// Devuelve los claims solo si la firma, el tipo, el emisor y la expiracion son validos
export async function verify(token: string | null | undefined, typ: TokenType, iss: string): Promise<Claims | null> {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, b, s] = parts
  let ok = false
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(secret()), fromB64url(s), enc.encode(`${h}.${b}`))
  } catch {
    return null
  }
  if (!ok) return null
  try {
    const claims = JSON.parse(dec.decode(fromB64url(b))) as Claims
    if (claims.typ !== typ || claims.iss !== iss) return null
    if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null
    return claims
  } catch {
    return null
  }
}

export async function sha256b64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return b64url(new Uint8Array(digest))
}
