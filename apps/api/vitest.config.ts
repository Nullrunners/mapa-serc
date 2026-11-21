import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Tests run against an in-memory database and the frozen source files in test/fixtures; no network.
    env: { DATA_DIR: ':memory:', OFFLINE: '1', FIXED_TODAY: '2026-11-21', ADMIN_TOKEN: 'test-token', LINK_SECRET: 'test-secret', PUBLIC_API_URL: 'https://api.aed.example.gov.pl' },
    fileParallelism: false,
  },
})
