import fs from 'node:fs'
import path from 'node:path'

const target = path.join(
  process.cwd(),
  'node_modules',
  '@tanstack',
  'start-server-core',
  'dist',
  'esm',
  'getServerFnById.js',
)

if (fs.existsSync(target)) {
  const current = fs.readFileSync(target, 'utf8')
  const patched = current.replace(
    'import { getServerFnById } from "#tanstack-start-server-fn-resolver";',
    'import { getServerFnById } from "./fake-start-server-fn-resolver.js";',
  )
  if (patched !== current) {
    fs.writeFileSync(target, patched)
  }
}
