import { existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'

const mode = process.argv[2] || 'dev'
const extraArgs = process.argv.slice(3)
const root = process.cwd()
let cwd = root
let drive = ''

// Current TanStack Start packages use package-import maps while loading the
// Vite plugin. Node on Windows can lose that package scope beyond MAX_PATH.
// A temporary drive mapping keeps every command inside this same workspace.
if (process.platform === 'win32' && root.length > 180 && mode === 'build') {
  drive = ['R:', 'Q:', 'P:', 'O:'].find((candidate) => !existsSync(`${candidate}\\`)) || ''
  if (!drive) throw new Error('No free drive letter is available for the local TanStack launcher')
  const result = spawnSync('subst.exe', [drive, root], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error('Unable to create the local short-path mapping')
  cwd = `${drive}\\`
}

const targets = {
  dev: [join(cwd, 'node_modules/vite/bin/vite.js'), 'dev'],
  build: [join(cwd, 'node_modules/vite/bin/vite.js'), 'build'],
  preview: [join(cwd, 'node_modules/vite/bin/vite.js'), 'preview'],
  start: [join(cwd, '.output/server/index.mjs')],
}
const target = targets[mode]
if (!target) throw new Error(`Unknown launcher mode: ${mode}`)

const child = spawn(process.execPath, [...target, ...extraArgs], { cwd, stdio: 'inherit', env: process.env })
const cleanup = () => { if (drive) spawnSync('subst.exe', [drive, '/d'], { stdio: 'ignore' }) }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code) => { cleanup(); process.exitCode = code ?? 1 })
child.on('error', (error) => { cleanup(); throw error })
