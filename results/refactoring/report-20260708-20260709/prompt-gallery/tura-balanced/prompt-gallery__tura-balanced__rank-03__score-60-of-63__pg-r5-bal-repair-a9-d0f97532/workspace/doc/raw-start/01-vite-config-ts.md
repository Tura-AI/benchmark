# vite.config.ts

Source: https://raw.githubusercontent.com/TanStack/router/main/examples/react/start-basic/vite.config.ts

Title: 

URL Source: https://raw.githubusercontent.com/TanStack/router/main/examples/react/start-basic/vite.config.ts

Markdown Content:
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      srcDirectory: 'src',
    }),
    viteReact(),
    nitro(),
  ],
})
