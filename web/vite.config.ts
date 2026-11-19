import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { CONFIG_PATH, FEEDBACK_PATH } from './src/models.js';

const API_DEV_ORIGIN = 'http://localhost:3000';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: {
    proxy: {
      [FEEDBACK_PATH]: API_DEV_ORIGIN,
      [CONFIG_PATH]: API_DEV_ORIGIN,
    },
  },
});
