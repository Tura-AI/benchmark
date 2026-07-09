import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function ensureEsbuildPath(preferred = []) {
  const roots = [
    ...preferred,
    path.join(process.cwd(), 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'),
    path.join(process.cwd(), 'node_modules', 'vite', 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'),
    path.join(process.cwd(), 'node_modules', 'vitest', 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'),
  ]
  const source = roots.find((candidate) => fs.existsSync(candidate))
  if (!source) return
  const target = path.join(os.tmpdir(), `powerprompt-esbuild-${process.pid}.exe`)
  try {
    fs.copyFileSync(source, target)
    process.env.ESBUILD_BINARY_PATH = target
  } catch {
    process.env.ESBUILD_BINARY_PATH = source
  }
}
