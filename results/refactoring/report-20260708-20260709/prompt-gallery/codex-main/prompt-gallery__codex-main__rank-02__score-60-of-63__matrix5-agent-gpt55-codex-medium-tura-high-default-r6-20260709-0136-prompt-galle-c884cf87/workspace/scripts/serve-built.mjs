import http from 'node:http'
import { Readable } from 'node:stream'

const portArg = process.argv.find((arg) => arg.startsWith('--port='))
const port = Number(portArg?.split('=')[1] ?? process.env.PORT ?? 3000)
process.env.POWERPROMPT_ORIGIN = `http://127.0.0.1:${port}`

const { default: entry } = await import('../dist/server/server.js')

const server = http.createServer(async (req, res) => {
  const url = `http://${req.headers.host}${req.url}`
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req)
  const request = new Request(url, { method: req.method, headers: req.headers, body, duplex: body ? 'half' : undefined })
  const response = await entry.fetch(request)
  res.writeHead(response.status, Object.fromEntries(response.headers))
  if (!response.body) return res.end()
  Readable.fromWeb(response.body).pipe(res)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`POWERPROMPT listening on http://127.0.0.1:${port}`)
})
