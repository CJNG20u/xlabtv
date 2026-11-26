import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      {
        // Sample artwork in src/assets/images and src/assets/logos is only used by the
        // development sample data (src/mock.ts): production builds get empty strings
        // instead, so those files never ship to the TV.
        name: 'drop-sample-artwork',
        apply: 'build',
        enforce: 'pre',
        load(id: string) {
          if (/[\\/]src[\\/]assets[\\/](images|logos)[\\/]/.test(id.split('?')[0])) {
            return 'export default ""';
          }
          return null;
        },
      },
    ],
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
