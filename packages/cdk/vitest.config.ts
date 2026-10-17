import { defineConfig } from 'vitest/config';

// CDK synth is CPU-heavy: the first Template.fromStack in a file takes 3-5s on a
// shared CI runner (turbo runs 63 tasks in parallel), which brushes vitest's 5s default.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    // Retry on CI only so a slow runner can't fail a release; local runs stay strict.
    retry: process.env.CI ? 2 : 0,
  },
});
