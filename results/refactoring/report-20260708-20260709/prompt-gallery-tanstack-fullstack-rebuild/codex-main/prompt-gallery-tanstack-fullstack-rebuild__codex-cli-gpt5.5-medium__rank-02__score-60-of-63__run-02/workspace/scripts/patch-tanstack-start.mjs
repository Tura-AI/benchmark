import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const target = path.join(process.cwd(), 'node_modules', '@tanstack', 'start-server-core', 'dist', 'esm', 'getServerFnById.js')

if (existsSync(target)) {
  const before = readFileSync(target, 'utf8')
  const after = before.replace(
    'from "#tanstack-start-server-fn-resolver"',
    'from "./fake-start-server-fn-resolver.js"',
  )
  if (after !== before) writeFileSync(target, after)
}
