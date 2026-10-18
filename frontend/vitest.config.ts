import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// QA-owned config — deliberately SEPARATE from vite.config.ts (Mortada's
// file) so tests never alter the dev/build behavior of the app.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
  },
})
