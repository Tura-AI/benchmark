import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// react-start-rsc 0.1.27 ships an RSC entry containing this package import but
// omits the matching `imports` map. Keep the upstream virtual id intact so the
// Start Vite plugin can replace it during builds; this fallback only makes the
// plugin itself importable in Node while loading vite.config.ts.
const packagePath = join(process.cwd(), 'node_modules/@tanstack/react-start-rsc/package.json')
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
pkg.imports = {
  ...(pkg.imports ?? {}),
  '#tanstack-start-server-fn-resolver': '../start-server-core/dist/esm/fake-start-server-fn-resolver.js',
}
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)

const corePackagePath = join(process.cwd(), 'node_modules/@tanstack/start-server-core/package.json')
const core = JSON.parse(readFileSync(corePackagePath, 'utf8'))
core.imports = {
  '#tanstack-start-server-fn-resolver': './dist/esm/fake-start-server-fn-resolver.js',
  '#tanstack-start-plugin-adapters': './dist/esm/empty-plugin-adapters.js',
}
writeFileSync(corePackagePath, `${JSON.stringify(core, null, 2)}\n`)

const resolverFile = join(process.cwd(), 'node_modules/@tanstack/start-server-core/dist/esm/getServerFnById.js')
writeFileSync(resolverFile, readFileSync(resolverFile, 'utf8').replace('"./fake-start-server-fn-resolver.js"', '"#tanstack-start-server-fn-resolver"'))
const rscResolverFile = join(process.cwd(), 'node_modules/@tanstack/react-start-rsc/dist/esm/entry/rsc.js')
writeFileSync(rscResolverFile, readFileSync(rscResolverFile, 'utf8').replace('"../../../../start-server-core/dist/esm/fake-start-server-fn-resolver.js"', '"#tanstack-start-server-fn-resolver"'))

const pluginCore = join(process.cwd(), 'node_modules/@tanstack/start-plugin-core/dist/esm')
const directImports = [
  ['post-build.js', '../../../start-server-core/dist/esm/constants.js'],
  ['vite/serialization-adapters-plugin.js', '../../../../start-server-core/dist/esm/virtual-modules.js'],
  ['vite/start-compiler-plugin/plugin.js', '../../../../../start-server-core/dist/esm/virtual-modules.js'],
  ['vite/start-manifest-plugin/plugin.js', '../../../../../start-server-core/dist/esm/virtual-modules.js'],
]
for (const [file, target] of directImports) {
  const path = join(pluginCore, file)
  writeFileSync(path, readFileSync(path, 'utf8').replace('from "@tanstack/start-server-core"', `from "${target}"`))
}
