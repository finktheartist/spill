import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Geometry searches need more than the default five seconds on shared machines.
// Test configuration does not load local credentials or attach API middleware.
export default defineConfig({
  plugins: [react()],
  test: { maxWorkers: 4, testTimeout: 30_000, hookTimeout: 30_000 },
});
