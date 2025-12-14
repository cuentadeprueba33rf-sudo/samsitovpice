import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // This ensures process.env is handled correctly in the browser build if needed,
    // although Vercel injects it, this prevents reference errors.
    'process.env': process.env
  }
});