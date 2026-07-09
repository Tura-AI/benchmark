import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [tool, ...args] = process.argv.slice(2)

const bins = {
  vite: ['vite', 'bin', 'vite.js'],
  vitest: ['vitest', 'vitest.mjs'],
  playwright: ['@playwright', 'test', 'cli.js'],
}

if (!tool || !bins[tool]) {
  console.error(`Unknown tool: ${tool ?? '(missing)'}`)
  process.exit(1)
}

const fullBinary = path.join(root, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe')
let binary = fullBinary
if (process.platform === 'win32') {
  binary = path.join(root, 'esbuild.exe')
  if (fs.existsSync(fullBinary)) fs.copyFileSync(fullBinary, binary)
}
const cli = path.join(root, 'node_modules', ...bins[tool])
const child = spawn(process.execPath, [cli, ...args], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    ESBUILD_BINARY_PATH: binary,
  },
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
