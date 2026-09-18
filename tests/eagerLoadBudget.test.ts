import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// THE EAGER-LOAD GATE, MADE LOAD-BEARING (item 637).
//
// `scripts/checkEagerSize.mjs` has existed for months and has been correct throughout. What it
// lacked was any power to stop the thing it guards: `Release` and `CI` are separate workflows on
// the same push, and the publishing one never consulted the other. So the check went red at
// 0.5.88, was raised to 600 with the cause recorded (item 398), went red again at 0.5.103, and
// stayed red for ELEVEN consecutive runs through 0.5.113 — every one of them published anyway.
// Twice now the honest conclusion has been written down and twice the gate could not act on it.
//
// Running it HERE is what changes that, and it is deliberately not a new workflow step: `Release`
// already runs `npm test` before it publishes, and so does CI's `verify` job, and so does
// `npm run verify` on a developer's machine. One assertion in the suite reaches all three, and it
// cannot drift out of sync with the workflow file the way a copied `run:` line would.
//
// WHAT THIS ASSERTS IS THE SCRIPT'S VERDICT, NOT A NUMBER OF ITS OWN. Duplicating the limit here
// would create exactly the second source of truth this repo keeps paying for — see the header of
// checkEagerSize.mjs for the reasoning behind the ceiling, which is where it belongs.
const root = resolve(__dirname, "..");
const entry = resolve(root, "packages/chart-host/dist/index.mjs");
// A real entry whose closure legitimately IS map geometry — the positive control below.
const geoEntry = resolve(root, "packages/chart-host/dist/geo-world.mjs");

describe("eager load budget", () => {
    // SKIPPED, NOT PASSED, when there is no build. The suite can legitimately run before a build
    // in a bare checkout, and an early `return` there would report GREEN for a gate that judged
    // nothing — which is the precise failure this whole item is about, so it would be a poor place
    // to repeat it. CI and Release both build first, so neither can take this branch.
    it.skipIf(!existsSync(entry))("IS THE GATE: chart-host's eager closure passes checkEagerSize", () => {
        let out = "";
        let failed = false;
        try {
            out = execFileSync("node", ["scripts/checkEagerSize.mjs", entry], {
                cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
            });
        } catch (e: any) {
            failed = true;
            out = String(e.stdout ?? "") + String(e.stderr ?? "");
        }

        expect(failed, `checkEagerSize failed:\n${out}`).toBe(false);
        expect(out).toContain("eager-load budget");
    });

    it.skipIf(!existsSync(geoEntry))("POSITIVE CONTROL: the geometry check actually fires, and names the module", () => {
        // A guard nobody has watched fire is a hypothesis. `dist/geo-world.mjs` is a real entry
        // whose closure legitimately IS the world geometry, so running the check against it
        // exercises the exact branch that must catch a regression on the main entry — without
        // anyone having to break the build to find out whether it works.
        //
        // This caught its own first draft. That version matched GEOMETRY_STEMS against the
        // FILENAME, and esbuild emits geometry into content-hashed chunks (chunk-ABGDJ3NJ.mjs)
        // carrying no stem at all — so it matched nothing and passed 223 KB of world geometry.
        // The check now reads esbuild's own `// src/geoWorld110m.generated.ts` module comment.
        let failed = false;
        let out = "";
        try {
            // A ceiling far above the closure, so the ONLY thing that can fail is the by-name
            // check — otherwise a pass here would prove nothing about which branch fired.
            out = execFileSync("node", ["scripts/checkEagerSize.mjs", geoEntry, "5000"], {
                cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
            });
        } catch (e: any) {
            failed = true;
            out = String(e.stdout ?? "") + String(e.stderr ?? "");
        }

        expect(failed, `the geometry check did NOT fire on an entry that is pure geometry:\n${out}`).toBe(true);
        expect(out).toContain("map GEOMETRY is in the eager closure");
        expect(out, "the failure must name WHICH module, or it sends someone hunting").toContain("geoWorld110m");
    });

    it.skipIf(!existsSync(entry))("the ceiling still leaves room for the smallest map asset to trip it", () => {
        // The budget means something only while (closure + smallest geometry asset) is ABOVE it.
        // At ~625 KB of closure and a 223 KB smallest asset that is ~848 KB against a 700 KB
        // ceiling. If a future raise ever puts the ceiling above that sum, the byte check stops
        // being able to catch geometry at all and only the by-name check above would remain.
        const src = execFileSync("node", ["-e", "process.stdout.write(require('fs').readFileSync('scripts/checkEagerSize.mjs','utf8'))"], {
            cwd: root, encoding: "utf8",
        });
        const m = src.match(/const limitKB = Number\(process\.argv\[3\] \?\? (\d+)\)/);
        expect(m, "could not read the default ceiling out of checkEagerSize.mjs").toBeTruthy();
        const limitKB = Number(m![1]);

        const out = execFileSync("node", ["scripts/checkEagerSize.mjs", entry], { cwd: root, encoding: "utf8" });
        const t = out.match(/(\d+) KB\s+TOTAL/);
        expect(t, `could not read the closure total from:\n${out}`).toBeTruthy();
        const closureKB = Number(t![1]);

        const SMALLEST_GEOMETRY_KB = 223;
        expect(
            closureKB + SMALLEST_GEOMETRY_KB,
            `ceiling ${limitKB} KB is at or above closure ${closureKB} + smallest geometry ${SMALLEST_GEOMETRY_KB} KB — ` +
            "the byte check can no longer catch a statically imported map asset",
        ).toBeGreaterThan(limitKB);
    });
});
