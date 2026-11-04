import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { GenerationSessions } from './sessions.js'
import { createModel } from './model.js'
import { openapi } from './openapi.js'
import { ApiError, fail, publicError } from './errors.js'

const MAX_BODY = 16384
async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'JSON_REQUIRED', 'Content-Type: application/json이 필요합니다.')
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') fail(415, 'ENCODING_NOT_SUPPORTED', '압축 요청은 지원하지 않습니다.')
  if (Number(req.headers['content-length']) > MAX_BODY) fail(413, 'BODY_TOO_LARGE', '요청 본문은 16KB 이하여야 합니다.')
  const bytes = await new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    const cleanup = () => { req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onError) }
    const onError = () => { cleanup(); reject(new ApiError(400, 'INVALID_BODY', '요청 본문을 끝까지 읽지 못했습니다.')) }
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks)) }
    const onData = chunk => {
      size += chunk.length
      if (size > MAX_BODY) {
        cleanup()
        // Drain without storing the remainder; do not destroy the socket before sending 413.
        req.resume()
        reject(new ApiError(413, 'BODY_TOO_LARGE', '요청 본문은 16KB 이하여야 합니다.'))
      } else chunks.push(chunk)
    }
    req.on('data', onData); req.once('end', onEnd); req.once('error', onError); req.once('aborted', onError)
  })
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { fail(400, 'INVALID_JSON', '완성된 UTF-8 JSON 객체를 보내 주세요.') }
}

export function createApiServer({ generator = createModel({ provider: process.env.IDEA_API_PROVIDER || 'gemini',
  apiKey: process.env.IDEA_API_PROVIDER === 'openai' ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY }),
  allowedOrigins = ['http://127.0.0.1:5180', 'http://localhost:5180'], ...sessionOptions } = {}) {
  const sessions = new GenerationSessions({ generator, ...sessionOptions })
  const server = createServer(async (req, res) => {
    const requestId = randomUUID()
    const send = (status, payload, replayed = false) => {
      if (res.destroyed) return
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ...payload, meta: { requestId, replayed } }))
    }
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Request-Id', requestId)
    try {
      // Local-only prototype: reject DNS rebinding and unintended cross-origin callers.
      const address = server.address()
      if (![`127.0.0.1:${address.port}`, `localhost:${address.port}`].includes(req.headers.host)) fail(403, 'HOST_NOT_ALLOWED', '허용된 로컬 호스트가 아닙니다.')
      const origin = req.headers.origin
      if (origin && !allowedOrigins.includes(origin)) fail(403, 'ORIGIN_NOT_ALLOWED', '허용된 웹 출처가 아닙니다.')
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Vary', 'Origin')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key')
        res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id')
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
      const url = new URL(req.url, 'http://localhost')
      if (url.search) fail(400, 'QUERY_NOT_SUPPORTED', '이 API는 쿼리 매개변수를 사용하지 않습니다.')
      if (req.method === 'GET' && url.pathname === '/v1/health') {
        send(200, { data: { status: 'ok', source: generator.source, model: generator.model, persistence: 'memory' } }); return
      }
      if (req.method === 'GET' && url.pathname === '/v1/openapi.json') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(openapi)); return
      }
      if (url.pathname === '/v1/generation-sessions') {
        if (req.method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED', 'POST를 사용해 주세요.')
        send(201, { data: sessions.create(await readBody(req)) }); return
      }
      const match = /^\/v1\/generation-sessions\/([a-f0-9-]{36})(?:\/(generate|regenerate|develop|elaborate|cancel))?$/.exec(url.pathname)
      if (!match) fail(404, 'NOT_FOUND', 'API 경로를 확인해 주세요.')
      const session = sessions.authorize(match[1], req.headers.authorization)
      const action = match[2]
      if (!action && req.method === 'GET') { send(200, { data: sessions.view(session) }); return }
      if (!action || req.method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED', '이 경로의 메서드를 확인해 주세요.')
      const body = await readBody(req)
      if (action === 'cancel') { send(200, { data: sessions.cancel(session, body) }); return }
      const disconnected = new AbortController()
      const onClose = () => { if (!res.writableEnded) disconnected.abort() }
      res.on('close', onClose)
      try {
        if (res.destroyed) disconnected.abort()
        const { data, replayed } = await sessions.run(session, action, body, req.headers['idempotency-key'], disconnected.signal)
        send(200, { data }, replayed)
      } finally { res.removeListener('close', onClose) }
    } catch (error) {
      req.resume()
      const safe = publicError(error)
      if (safe.status === 429 || safe.code === 'REQUEST_IN_PROGRESS') res.setHeader('Retry-After', '5')
      send(safe.status, { error: { code: safe.code, message: safe.message } })
    }
  })
  server.requestTimeout = 15000 // incoming body only; generation has its own timeout
  server.headersTimeout = 10000
  server.maxRequestsPerSocket = 100
  server.on('close', () => sessions.close())
  return { server, sessions, close: () => { sessions.close(); server.close(); server.closeIdleConnections() } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const demo = process.argv.includes('--demo')
  const port = Number(process.env.IDEA_API_PORT || 4000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('IDEA_API_PORT must be 1..65535')
  const api = createApiServer(demo ? { generator: createModel({ provider: 'demo' }) } : {})
  api.server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'API 포트가 사용 중입니다.' : 'API 서버를 시작하지 못했습니다.'); process.exitCode = 1 })
  api.server.listen(port, '127.0.0.1', () => console.log(`Idea Assist API: http://127.0.0.1:${port}/v1/health (${demo ? 'rules demo, NOT AI' : process.env.IDEA_API_PROVIDER || 'gemini'})`))
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, api.close)
}
