import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { patchTanStackStartPackageScope } from './patch-tanstack-start.mjs'

patchTanStackStartPackageScope()

const args = process.argv.slice(2)
const portFlag = args.findIndex((arg) => arg === '--port')
const port = Number(portFlag >= 0 ? args[portFlag + 1] : process.env.PORT || 3000)
const host = '127.0.0.1'
const clientDir = path.join(process.cwd(), 'dist', 'client')
const serverFile = path.join(process.cwd(), 'dist', 'server', 'server.js')

if (!fs.existsSync(serverFile)) {
  console.error('Missing dist/server/server.js. Run npm run build first.')
  process.exit(1)
}

const entry = await import(pathToFileURL(serverFile).href)
const fetchHandler = entry.default?.fetch ?? entry.default ?? entry.fetch

const types = new Map([
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
])

function sendStatic(req, res) {
  const url = new URL(req.url ?? '/', `http://${host}:${port}`)
  const pathname = decodeURIComponent(url.pathname)
  const file = path.normalize(path.join(clientDir, pathname))
  if (!file.startsWith(clientDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false
  res.writeHead(200, { 'content-type': types.get(path.extname(file)) || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
  return true
}

function requestFromNode(req) {
  const url = `http://${req.headers.host}${req.url}`
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req)
  return new Request(url, { method: req.method, headers: req.headers, body, duplex: body ? 'half' : undefined })
}

http
  .createServer(async (req, res) => {
    try {
      if (sendStatic(req, res)) return
      const response = await fetchHandler(requestFromNode(req))
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
      if (response.body) Readable.fromWeb(response.body).pipe(res)
      else res.end()
    } catch (error) {
      console.error(error)
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Internal Server Error')
    }
  })
  .listen(port, host, () => {
    console.log(`POWERPROMPT listening at http://${host}:${port}`)
  })
