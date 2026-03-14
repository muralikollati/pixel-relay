import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/auth':    'http://localhost:3001',
      '/worker':  'http://localhost:3001',
      '/users':   'http://localhost:3001',
      '/reports': 'http://localhost:3001',
      '/health':  'http://localhost:3001',
      '/gmail':   'http://localhost:3001',
      '/account-requests': 'http://localhost:3001',
    },
    cors: true,
  },
});
