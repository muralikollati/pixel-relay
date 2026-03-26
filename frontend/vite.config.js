import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/auth':    'https://140.245.238.219.nip.io',
      '/worker':  'https://140.245.238.219.nip.io',
      '/users':   'https://140.245.238.219.nip.io',
      '/reports': 'https://140.245.238.219.nip.io',
      '/health':  'https://140.245.238.219.nip.io',
      '/gmail':   'https://140.245.238.219.nip.io',
      '/account-requests': 'https://140.245.238.219.nip.io',
    },
    cors: true,
  },
});
