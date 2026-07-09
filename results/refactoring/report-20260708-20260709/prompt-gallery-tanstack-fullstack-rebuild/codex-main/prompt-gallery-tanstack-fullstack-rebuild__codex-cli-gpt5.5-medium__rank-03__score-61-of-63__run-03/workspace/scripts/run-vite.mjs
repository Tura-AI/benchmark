import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { ensureEsbuildPath } from './esbuild-path.mjs'
import { patchTanStackStartPackageScope } from './patch-tanstack-start.mjs'

patchTanStackStartPackageScope()
ensureEsbuildPath()
const viteBin = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js')
const result = spawnSync(process.execPath, [viteBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
})
process.exit(result.status ?? 1)
