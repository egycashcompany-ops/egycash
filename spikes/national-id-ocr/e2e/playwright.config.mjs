// Serves the page with the repo's own test-page server (tools/test_ui.py). No OCR service is
// needed: the specs drive each panel's state directly, and /types falls back to the built-in list.
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.READERS_PORT || 8131);

export default defineConfig({
  testDir: ".",
  outputDir: "../build/e2e/results",
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    video: process.env.RECORD ? "on" : "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "python ../tools/test_ui.py",
    env: { TEST_UI_PORT: String(PORT), OCR_SIDECAR: "http://127.0.0.1:9" },
    url: `http://127.0.0.1:${PORT}/readers`,
    reuseExistingServer: true,
  },
});
