import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { Readable } from 'node:stream'
import serverEntry from '../dist/server/server.js'
import { marketApi } from '../src/server/market-api.ts'

const port = Number(process.env.PORT || 43123)
const host = process.env.HOST || '127.0.0.1'
const clientDir = path.join(process.cwd(), 'dist', 'client')

const mime = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
])

function sendStatic(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`)
  const pathname = decodeURIComponent(url.pathname)
  const target = path.normalize(path.join(clientDir, pathname))
  if (!target.startsWith(clientDir) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return false
  }
  res.writeHead(200, {
    'content-type': mime.get(path.extname(target)) || 'application/octet-stream',
    'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  fs.createReadStream(target).pipe(res)
  return true
}

async function sendFetchResponse(fetchResponse, res) {
  res.writeHead(fetchResponse.status, Object.fromEntries(fetchResponse.headers))
  if (fetchResponse.body) {
    Readable.fromWeb(fetchResponse.body).pipe(res)
  } else {
    res.end()
  }
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/marketplace' && req.method === 'GET') {
    const data = Object.fromEntries(url.searchParams)
    data.favoritesOnly = data.favoritesOnly === 'true'
    data.freeOnly = data.freeOnly === 'true'
    return sendJson(res, await marketApi.marketplace(data))
  }
  if (url.pathname.startsWith('/api/prompts/') && req.method === 'GET') {
    return sendJson(res, await marketApi.promptDetail(Number(url.pathname.split('/').pop())))
  }
  if (url.pathname === '/api/cart' && req.method === 'GET') {
    return sendJson(res, await marketApi.cart())
  }
  if (url.pathname === '/api/cart' && req.method === 'POST') {
    const body = await readJson(req)
    return sendJson(res, await marketApi.addToCart(Number(body.promptId)))
  }
  if (url.pathname === '/api/cart/remove' && req.method === 'POST') {
    const body = await readJson(req)
    return sendJson(res, await marketApi.removeFromCart(Number(body.promptId)))
  }
  if (url.pathname === '/api/favorite' && req.method === 'POST') {
    const body = await readJson(req)
    return sendJson(res, await marketApi.toggleFavorite(Number(body.promptId)))
  }
  if (url.pathname === '/api/checkout' && req.method === 'POST') {
    return sendJson(res, await marketApi.checkout())
  }
  if (url.pathname === '/api/analytics' && req.method === 'GET') {
    return sendJson(res, await marketApi.analytics())
  }
  return false
}

const server = http.createServer(async (req, res) => {
  try {
    const origin = `http://${req.headers.host || `${host}:${port}`}`
    const url = new URL(req.url || '/', origin)
    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, url)
      if (handled !== false) return
    }
    if (sendStatic(req, res)) return
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req),
      duplex: req.method === 'GET' || req.method === 'HEAD' ? undefined : 'half',
    })
    await sendFetchResponse(await serverEntry.fetch(request), res)
  } catch (error) {
    console.error(error)
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Internal Server Error')
  }
})

server.listen(port, host, () => {
  console.log(`POWERPROMPT listening on http://${host}:${port}`)
})
