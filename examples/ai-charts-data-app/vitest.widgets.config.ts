// The widget suite (npm run test:widgets): every prebuilt chart and mini-app drawn in real headless Chromium, on the
// bundled sample rows and on swapped ones, with no network. Needs Playwright's Chromium once:
// npx playwright install chromium

import { defineConfig, mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import viteConfig from "./vite.config";

export default mergeConfig(viteConfig, defineConfig({
    test: {
        include: ["src/**/*.widget.test.{ts,tsx}"],
        testTimeout: 60_000,
        browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium", viewport: { width: 1280, height: 900 } }],
        },
    },
}));
