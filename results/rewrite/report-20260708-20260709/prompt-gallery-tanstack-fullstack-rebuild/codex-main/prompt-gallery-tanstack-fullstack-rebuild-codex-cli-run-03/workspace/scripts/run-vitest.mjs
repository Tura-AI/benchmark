import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { ensureEsbuildPath } from './esbuild-path.mjs'
import { patchTanStackStartPackageScope } from './patch-tanstack-start.mjs'

patchTanStackStartPackageScope()
ensureEsbuildPath([path.join(process.cwd(), 'node_modules', 'vitest', 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe')])
const vitestBin = path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs')
const result = spawnSync(process.execPath, [vitestBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
})
process.exit(result.status ?? 1)
