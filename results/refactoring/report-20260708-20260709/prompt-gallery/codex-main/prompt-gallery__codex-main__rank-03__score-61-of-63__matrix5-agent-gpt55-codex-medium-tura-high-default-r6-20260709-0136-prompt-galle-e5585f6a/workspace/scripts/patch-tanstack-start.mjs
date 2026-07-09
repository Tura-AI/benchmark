import fs from 'node:fs'
import path from 'node:path'

export function patchTanStackStartPackageScope() {
  const dist = path.join(process.cwd(), 'node_modules', '@tanstack', 'start-server-core', 'dist')
  if (!fs.existsSync(dist)) return
  const body = {
    name: '@tanstack/start-server-core-dist-esm',
    version: '0.0.0',
    type: 'module',
    imports: {
      '#tanstack-start-server-fn-resolver': {
        default: './fake-start-server-fn-resolver.js',
      },
      '#tanstack-start-plugin-adapters': {
        default: './empty-plugin-adapters.js',
      },
    },
  }
  fs.writeFileSync(path.join(dist, 'esm', 'package.json'), `${JSON.stringify(body, null, 2)}\n`)
  const getServerFnById = path.join(dist, 'esm', 'getServerFnById.js')
  if (fs.existsSync(getServerFnById)) {
    const source = fs
      .readFileSync(getServerFnById, 'utf8')
      .replace('"#tanstack-start-server-fn-resolver"', '"./fake-start-server-fn-resolver.js"')
    fs.writeFileSync(getServerFnById, source)
  }
}
