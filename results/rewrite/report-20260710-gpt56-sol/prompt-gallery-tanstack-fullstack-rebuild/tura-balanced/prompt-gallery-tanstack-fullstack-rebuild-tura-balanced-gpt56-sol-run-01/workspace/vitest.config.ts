import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: { environment: 'node', reporters: ['default'], pool: 'forks', fileParallelism: false, exclude: ['tests/e2e/**', 'node_modules/**'] },
})
