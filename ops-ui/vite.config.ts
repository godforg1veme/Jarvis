import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: '/ops/', plugins: [react()], test: { environment: 'jsdom' } });
