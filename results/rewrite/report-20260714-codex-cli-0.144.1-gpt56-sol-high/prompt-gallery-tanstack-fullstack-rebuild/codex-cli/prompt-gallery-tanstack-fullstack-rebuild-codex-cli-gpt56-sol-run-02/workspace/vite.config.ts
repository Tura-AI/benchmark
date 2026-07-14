import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'

export default defineConfig(({ command }) => ({
  server: { port: 3000 },
  optimizeDeps: { noDiscovery: true },
  plugins: [tanstackStart(), ...(command === 'build' ? [nitro()] : []), viteReact()],
}))
