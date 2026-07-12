import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';

export default defineConfig({
  plugins: [tanstackStart(), react()],
  resolve: { tsconfigPaths: true },
  server: { port: 3000 },
  test: { environment: 'node', globals: true }
});
