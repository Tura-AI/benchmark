import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'node_modules', '@tanstack', 'start-server-core', 'dist', 'esm', 'getServerFnById.js')

if (fs.existsSync(target)) {
  const source = fs.readFileSync(target, 'utf8')
  const patched = source.replace(
    'from "#tanstack-start-server-fn-resolver"',
    'from "./fake-start-server-fn-resolver.js"',
  )
  if (patched !== source) fs.writeFileSync(target, patched)
}
