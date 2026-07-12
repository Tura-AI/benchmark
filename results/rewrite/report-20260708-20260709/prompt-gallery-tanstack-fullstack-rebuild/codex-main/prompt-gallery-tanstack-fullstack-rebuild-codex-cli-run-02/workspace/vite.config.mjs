import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(async ({ isSsrBuild }) => {
  const { tanstackStart } = await import('@tanstack/react-start/plugin/vite')

  return {
    server: { port: 3000 },
    build: {
      rollupOptions: {
        external: isSsrBuild ? [] : (id) => id.includes('/src/server/') || id.includes('\\src\\server\\'),
      },
    },
    plugins: [tanstackStart(), viteReact()],
  }
})
