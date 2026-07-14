import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { Readable } from 'node:stream'
import start from '../dist/server/server.js'

const root = join(process.cwd(), 'dist', 'client')
const port = Number(process.env.PORT || 3000)
const mime = { '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.jpg':'image/jpeg', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' }

createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url || '/', `http://${incoming.headers.host || `localhost:${port}`}`)
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '')
    const file = join(root, relative)
    if (relative && file.startsWith(root) && existsSync(file) && statSync(file).isFile()) {
      outgoing.statusCode = 200
      outgoing.setHeader('content-type', mime[extname(file)] || 'application/octet-stream')
      outgoing.setHeader('cache-control', relative.startsWith('assets') ? 'public,max-age=31536000,immutable' : 'public,max-age=3600')
      createReadStream(file).pipe(outgoing)
      return
    }
    const request = new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      body: incoming.method === 'GET' || incoming.method === 'HEAD' ? undefined : Readable.toWeb(incoming),
      duplex: 'half',
    })
    const response = await start.fetch(request)
    outgoing.statusCode = response.status
    response.headers.forEach((value, key) => outgoing.setHeader(key, value))
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing)
    else outgoing.end()
  } catch (error) {
    console.error(error)
    outgoing.statusCode = 500
    outgoing.end('Internal server error')
  }
}).listen(port, '127.0.0.1', () => console.log(`POWERPROMPT ready at http://127.0.0.1:${port}`))
