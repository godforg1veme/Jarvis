import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: '../renderer/orbital',
    emptyOutDir: true,
    lib: { entry: fileURLToPath(new URL('./src/desktop-scene.tsx', import.meta.url)), name: 'JarvisDesktopScene', formats: ['iife'], fileName: () => 'scene.js', cssFileName: 'scene' },
  },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
});
