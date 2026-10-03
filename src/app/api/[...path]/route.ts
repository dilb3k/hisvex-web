import { NextRequest, NextResponse } from 'next/server'

// Server-only — never NEXT_PUBLIC_*, so these can't end up in the browser
// bundle or be visible in devtools. The real backend hosts (Railway
// primary, Render backup) now only ever get called from this Node runtime;
// the browser only ever talks to this same-origin /api/* path.
const PRIMARY_URL = process.env.BACKEND_PRIMARY_URL || 'https://hisvex-api-production.up.railway.app/api'
const BACKUP_URL = process.env.BACKEND_BACKUP_URL || 'https://hisvex-api.onrender.com/api'

const DEFAULT_TIMEOUT_MS = 10000
const HEAVY_TIMEOUT_MS = 60000
const AUTH_TIMEOUT_MS = 30000

// Serverless instances are short-lived and this can't be guaranteed to
// persist across every invocation the way a long-running process could —
// but Vercel does reuse warm instances for a stretch, so this still saves
// a wasted primary-timeout on most requests during an actual outage. Every
// request still gets a real, fresh try at primary once the cooldown lapses
// (or immediately, if this happens to land on a cold/different instance) —
// never permanently stuck on backup the way a naive "down forever" flag
// would be.
let primaryDownUntil = 0
const PRIMARY_COOLDOWN_MS = 60_000

// Gateway statuses may also carry an explicit application rejection, such
// as OTP_DELIVERY_FAILED. Preserve that known outcome instead of hiding it
// behind an outage error or treating a healthy backend as unavailable.
function isFailoverTriggeringStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504
}

async function isOtpDeliveryFailure(res: Response): Promise<boolean> {
  if (res.status !== 503) return false
  try {
    const data = await res.clone().json()
    return data?.success === false && data?.error?.code === 'OTP_DELIVERY_FAILED'
  } catch { return false }
}

function isSessionLogin(path: string): boolean {
  return ['/auth/login', '/auth/login/verify-phone', '/auth/verify-session-challenge'].includes(path)
}

// Railway's own edge router returns a plain 404 when the service itself is
// torn down / asleep / not deployed — by status code alone this is
// indistinguishable from a completely normal business 404 ("Mahsulot
// topilmadi"). Only fail over when the platform's own signature is
// actually present on the response; an ordinary app-level 404 must reach
// the client unchanged and must never be retried against backup.
const RAILWAY_NOT_FOUND_BODY_MARKER = 'Application not found'
async function readAndCheckPlatformNotFound(res: Response): Promise<{ matched: boolean; body: ArrayBuffer }> {
  const body = await res.arrayBuffer()
  try { const appBody = JSON.parse(new TextDecoder().decode(body)); if (typeof appBody?.success === 'boolean') return { matched: false, body } } catch {}
  if (res.headers.has('x-railway-router')) return { matched: true, body }
  // A real marker always appears well within the first few hundred bytes of
  // Railway's static error page — capped so a large JSON 404 body from the
  // app itself is never fully decoded just to rule this out.
  const text = new TextDecoder().decode(body.slice(0, 4096))
  return { matched: text.includes(RAILWAY_NOT_FOUND_BODY_MARKER), body }
}

function isHeavy(path: string, contentType: string | null): boolean {
  if (contentType?.includes('multipart/form-data')) return true
  return path.includes('/snapshots') || path.includes('/inventory/range') || path.includes('/stats')
}

// Headers that belong to THIS hop (client<->proxy or proxy<->backend) only
// and must never be blindly copied to the other side.
const STRIP_REQUEST_HEADERS = new Set([
  'host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive',
  'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'accept-encoding',
])
// content-encoding/content-length: fetch() already decompresses the
// response body for us, so the upstream's own "content-encoding: gzip"
// header would lie to the browser about bytes that are no longer encoded.
// content-length is recomputed fresh for whatever we actually send back.
const STRIP_RESPONSE_HEADERS = new Set([
  'content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive',
])

function forwardRequestHeaders(req: NextRequest): Headers {
  const headers = new Headers()
  req.headers.forEach((value, key) => {
    if (STRIP_REQUEST_HEADERS.has(key.toLowerCase())) return
    headers.set(key, value)
  })
  return headers
}

function forwardResponseHeaders(res: Response): Headers {
  const headers = new Headers()
  res.headers.forEach((value, key) => {
    if (STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) return
    headers.append(key, value)
  })
  return headers
}

async function attemptOnce(
  target: string,
  method: string,
  headers: Headers,
  body: ArrayBuffer | undefined,
  timeoutMs: number,
): Promise<Response | null> {
  try {
    return await fetch(target, {
      method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
      cache: 'no-store',
    })
  } catch {
    // Network failure, DNS failure, or the AbortSignal timeout firing — all
    // treated the same as "this backend didn't answer."
    return null
  }
}

// Best-effort, fire-and-forget — mirrors the client's old
// reportOpsFailoverEvent: tells the backend that just took over about the
// handoff. A failure here must never affect the request that triggered it.
function reportFailoverEvent(authHeader: string | null) {
  if (!authHeader) return
  void fetch(`${BACKUP_URL}/ops/failover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify({ event: 'failover', from: 'railway', to: 'render' }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {})
}

async function fetchWithFailover(
  path: string,
  method: string,
  headers: Headers,
  body: ArrayBuffer | undefined,
  timeoutMs: number,
): Promise<{ res: Response | null; usedBackup: boolean }> {
  const replaySafe = ['GET', 'HEAD', 'OPTIONS'].includes(method)
  const skipPrimary = Date.now() < primaryDownUntil

  if (!skipPrimary) {
    const res = await attemptOnce(`${PRIMARY_URL}${path}`, method, headers, body, timeoutMs)

    if (res && await isOtpDeliveryFailure(res)) {
      primaryDownUntil = 0
      return { res, usedBackup: false }
    } else if (res && res.status === 404) {
      const { matched, body: bodyBuf } = await readAndCheckPlatformNotFound(res)
      if (!matched) {
        // A real, normal 404 from the app itself — return it exactly as
        // received. body() was already consumed above to inspect it, so the
        // response is reconstructed from the buffered bytes instead of
        // re-reading the original (which would throw).
        primaryDownUntil = 0
        return { res: new Response(bodyBuf, { status: res.status, statusText: res.statusText, headers: res.headers }), usedBackup: false }
      }
      primaryDownUntil = Date.now() + PRIMARY_COOLDOWN_MS
      reportFailoverEvent(headers.get('authorization'))
      if (!replaySafe) return { res: new Response(bodyBuf, { status: res.status, statusText: res.statusText, headers: res.headers }), usedBackup: false }
    } else if (res && !isFailoverTriggeringStatus(res.status)) {
      primaryDownUntil = 0
      return { res, usedBackup: false }
    } else {
      primaryDownUntil = Date.now() + PRIMARY_COOLDOWN_MS
      if (!replaySafe) return { res, usedBackup: false }
      if (res?.body) await res.body.cancel().catch(() => {})
      primaryDownUntil = Date.now() + PRIMARY_COOLDOWN_MS
      reportFailoverEvent(headers.get('authorization'))
    }
  }

  const res = await attemptOnce(`${BACKUP_URL}${path}`, method, headers, body, timeoutMs)
  return { res, usedBackup: true }
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: pathSegments } = await ctx.params
  const path = '/' + pathSegments.map(encodeURIComponent).join('/')
  const search = req.nextUrl.search
  const method = req.method
  const contentType = req.headers.get('content-type')
  const timeoutMs = isSessionLogin(path) ? AUTH_TIMEOUT_MS : isHeavy(path, contentType) ? HEAVY_TIMEOUT_MS : DEFAULT_TIMEOUT_MS
  const unavailableMessage = isSessionLogin(path)
    ? 'Kirish so‘roviga javob olinmadi. Birozdan keyin qayta urinib ko‘ring.'
    : 'Server bilan bog‘lanib bo‘lmadi. Internetni tekshiring.'

  // Buffered once, not streamed straight through — a stream can only be
  // read once, and a failover retry needs to send the exact same bytes to
  // a second server. Fine at this app's scale (JSON payloads and single
  // product-image uploads, not large file transfers).
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const body = hasBody ? await req.arrayBuffer() : undefined

  const headers = forwardRequestHeaders(req)

  const { res, usedBackup } = await fetchWithFailover(`${path}${search}`, method, headers, body, timeoutMs)

  if (!res) {
    return NextResponse.json(
      { success: false, error: { code: ['GET', 'HEAD', 'OPTIONS'].includes(method) ? 'BOTH_BACKENDS_DOWN' : 'WRITE_OUTCOME_UNKNOWN', message: unavailableMessage } },
      { status: 503 },
    )
  }
  if (isFailoverTriggeringStatus(res.status) && usedBackup && !await isOtpDeliveryFailure(res)) {
    // Backup (or primary, retried directly when the cooldown made us skip
    // straight to it) is ALSO failing this exact request — both backends
    // are down, not just one.
    return NextResponse.json(
      { success: false, error: { code: ['GET', 'HEAD', 'OPTIONS'].includes(method) ? 'BOTH_BACKENDS_DOWN' : 'WRITE_OUTCOME_UNKNOWN', message: unavailableMessage } },
      { status: 503 },
    )
  }

  const responseBody = method === 'HEAD' || [204,205,304].includes(res.status) ? null : await res.arrayBuffer()
  const responseHeaders = forwardResponseHeaders(res)
  return new NextResponse(responseBody, { status: res.status, headers: responseHeaders })
}

export const HEAD = handle
export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
export const OPTIONS = handle

// This proxy's whole job is to forward a live request/response 1:1 — never
// cache or statically evaluate it. Also opts this route out of `output:
// 'export'`-style static analysis expectations.
export const dynamic = 'force-dynamic'

export const runtime = 'nodejs'
