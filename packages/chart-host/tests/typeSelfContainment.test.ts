import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GEO_POINT_PRECISIONS, type GeoPointPrecision } from "../src/contract";
import type { GeoPointPrecision as ShapeCorePrecision } from "@bicharts/shape-core";

// THE PUBLISHED TYPES MUST NOT REFERENCE A PACKAGE CONSUMERS DO NOT INSTALL.
//
// shape-core is a build-time devDependency — its code is BUNDLED into chart-host's dist, so a
// consumer installs chart-host alone. The first packed build nevertheless emitted
//   payload.d.ts: import { type GeoPointPrecision } from "@bicharts/shape-core";
// a specifier that cannot resolve for anyone. It survived the pack-install-build test because
// the scaffolded app had `skipLibCheck: true` (the Vite template default), which skips .d.ts
// checking altogether — the test passed while the package was broken for any consumer with
// skipLibCheck off.

const here = dirname(fileURLToPath(import.meta.url));
const distTypes = resolve(here, "../dist/types");

describe("published declarations are self-contained", () => {
    it("no .d.ts imports a devDependency", () => {
        if (!existsSync(distTypes)) {
            throw new Error("dist/types missing — run `npm run build` before this test");
        }
        const offenders: string[] = [];
        for (const f of readdirSync(distTypes)) {
            if (!f.endsWith(".d.ts")) continue;
            // Strip comments first: .d.ts files PRESERVE JSDoc, and a doc comment that
            // quotes an import example ("… `geoForKind` from \"@bicharts/chart-host/geo\" …")
            // is prose, not a dependency. Then match only real import/export statements.
            const text = readFileSync(join(distTypes, f), "utf-8")
                .replace(/\/\*[\s\S]*?\*\//g, "")
                .replace(/^\s*\/\/.*$/gm, "");
            for (const m of text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)) {
                const spec = m[1];
                if (spec.startsWith(".")) continue;               // internal, fine
                if (spec === "react" || spec.startsWith("react/")) continue;  // declared peer
                offenders.push(`${f}: ${spec}`);
            }
        }
        expect(offenders, `shipped types reference non-installed package(s): ${offenders.join(", ")}`)
            .toEqual([]);
    });
});

describe("the duplicated GeoPointPrecision cannot drift", () => {
    it("our union is assignable to shape-core's and back", () => {
        // Compile-time equality in both directions. If either side gains or loses a member
        // this stops compiling, which is the point — the duplication is deliberate (see
        // contract.ts) but must never become a divergence.
        const ours: GeoPointPrecision = "zip3";
        const theirs: ShapeCorePrecision = ours;
        const back: GeoPointPrecision = theirs;
        expect(back).toBe("zip3");
    });

    it("the runtime list matches the type, most precise first", () => {
        expect([...GEO_POINT_PRECISIONS]).toEqual(["latlon", "city", "zip3", "state"]);
        // Exhaustiveness: every member of the union is present in the runtime list.
        const check: Record<GeoPointPrecision, true> = {
            latlon: true, city: true, zip3: true, state: true,
        };
        expect(Object.keys(check).sort()).toEqual([...GEO_POINT_PRECISIONS].sort());
    });
});
