import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from https://<user>.github.io/sandoq/ in CI, from / locally.
const base = process.env.GITHUB_ACTIONS ? '/sandoq/' : '/';

export default defineConfig({
  base,
  plugins: [react()],
});
