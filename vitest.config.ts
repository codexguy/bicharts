import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// One runner for both packages. `@bicharts/shape-core` resolves to SOURCE here so a change
// in one package is typechecked and tested against the other without a build step between
// them — the workspace symlink would reach package.json's `main`, which points at dist.
export default defineConfig({
    resolve: {
        alias: {
            "@bicharts/shape-core": resolve(__dirname, "packages/shape-core/src/index.ts"),
        },
    },
    test: {
        // Root `tests/` holds repo-level concerns that belong to neither package
        // (licensing consistency across both, for one).
        include: ["packages/*/tests/**/*.test.ts", "packages/*/tests/**/*.test.tsx", "tests/**/*.test.ts"],
        environment: "node",
    },
});
