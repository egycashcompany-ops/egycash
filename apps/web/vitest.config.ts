import { defineConfig } from 'vitest/config';

// The web suite covers the cache layer — what a server response does to the query cache — which is
// plain data manipulation over a real QueryClient and needs no DOM. Components stay out of scope
// here on purpose: a jsdom render would test React, not the contract this app has with the API.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    reporters: ['default', 'hanging-process'],
  },
});
