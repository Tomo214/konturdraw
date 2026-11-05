import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { benchSink } from './tests/perf/bench-sink.ts';

export default defineConfig({
  plugins: [svelte(), benchSink()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  test: { include: ['tests/**/*.test.ts'] },
});
