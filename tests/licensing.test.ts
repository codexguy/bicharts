import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join, extname, sep } from "node:path";

// Repo-level licensing guard. This exists because a real leak got as far as npm:
// shape-core/src/indexedText.ts still carried the CLOSED-SOURCE header from the
// repository it was extracted from ("proprietary to the author… all rights are
// reserved… grants Microsoft the limited right to review"), sitting inside a package
// published under Apache-2.0. It never reached the built .mjs — but it was in the
// SOURCE MAP that ships in the tarball, and it would have been the plain text of a
// public GitHub repo. A per-file reservation of rights inside an Apache-2.0
// distribution is a contradiction a reader is entitled to resolve against us.
//
// Extraction from a proprietary repo is how this package gets written, so this class
// of mistake recurs by construction: every future file moved across carries whatever
// header it had. Hence a test rather than a fix.

const ROOT = resolve(__dirname, "..");
const PKGS = ["chart-host", "shape-core"];

// Phrases that assert rights INCOMPATIBLE with the Apache-2.0 grant. Deliberately
// narrow: "Copyright" alone is fine (Apache-2.0 expects copyright notices), and the
// LICENSE/NOTICE files legitimately discuss other licences.
const FORBIDDEN: Array<[RegExp, string]> = [
    [/all rights (are )?reserved/i, "reserves rights Apache-2.0 grants away"],
    [/considered proprietary/i, "declares the file proprietary"],
    [/may not be (used|distributed|copied)/i, "forbids use Apache-2.0 permits"],
    [/without the express written consent/i, "requires consent Apache-2.0 does not"],
    [/grants Microsoft/i, "carries the Power BI certification review grant"],
    [/confidential/i, "asserts confidentiality over published source"],
];

const ALL_RIGHTS = FORBIDDEN[0][0];

// Folders that hold a third party's template under its own licence rather than this repo's: the
// Fabric Apps example is Microsoft's MIT-licensed Rayfin data app template with charts added. Its
// LICENSE says so, and the README says which files are whose.
const THIRD_PARTY_MIT = ["examples/fabric-app-template"].map(d => d.split("/").join(sep));
const MIT_HEADER = /Copyright \(c\) Microsoft Corporation\.\s+All rights reserved\.\s*\n\s*\/\/\s*Licensed under the MIT license/;

const TEXT_EXT = new Set([".ts", ".tsx", ".mjs", ".js", ".json", ".md", ".yml", ".yaml"]);
const SKIP_DIR = new Set(["node_modules", "dist", ".git", ".vite"]);

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (SKIP_DIR.has(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (TEXT_EXT.has(extname(name)) || name === "LICENSE" || name === "NOTICE") out.push(p);
    }
    return out;
}

describe("licensing — the repo says one thing about rights, everywhere", () => {
    const files = walk(ROOT);

    it("finds files to check (a walker that silently matches nothing proves nothing)", () => {
        expect(files.length).toBeGreaterThan(40);
        // The file the leak was actually in must be in scope, by name.
        expect(files.some(f => f.endsWith("indexedText.ts"))).toBe(true);
    });

    it("no file claims rights that contradict the Apache-2.0 grant", () => {
        const hits: string[] = [];
        for (const f of files) {
            // This test file necessarily contains the forbidden phrases as patterns.
            if (f === __filename) continue;
            const txt = readFileSync(f, "utf8");
            const thirdParty = THIRD_PARTY_MIT.find(d => f.startsWith(join(ROOT, d) + sep));
            for (const [re, why] of FORBIDDEN) {
                const m = txt.match(re);
                // Microsoft's MIT header reads "All rights reserved." and then "Licensed under the MIT
                // license" - an MIT grant, not a reservation. Excused only in a folder that ships that MIT
                // licence, and only beside the MIT line; every other phrase still counts there.
                if (m && thirdParty && re === ALL_RIGHTS && MIT_HEADER.test(txt)) continue;
                if (m) hits.push(`${f.slice(ROOT.length + 1)}: "${m[0]}" — ${why}`);
            }
        }
        expect(hits, `Apache-2.0 is the licence of this repo; these files disagree:\n${hits.join("\n")}`)
            .toEqual([]);
    });

    it("a third-party template folder ships the MIT licence its headers name", () => {
        for (const d of THIRD_PARTY_MIT) {
            const license = readFileSync(join(ROOT, d, "LICENSE"), "utf8");
            expect(license, `${d}/LICENSE`).toMatch(/MIT License/);
            expect(license, `${d}/LICENSE`).toMatch(/Copyright \(c\) Microsoft Corporation/);
        }
    });

    for (const pkg of PKGS) {
        const dir = join(ROOT, "packages", pkg);
        const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));

        it(`${pkg} declares Apache-2.0 and SHIPS the licence texts`, () => {
            expect(manifest.license).toBe("Apache-2.0");
            // Present on disk...
            expect(existsSync(join(dir, "LICENSE")), `${pkg}/LICENSE missing`).toBe(true);
            expect(existsSync(join(dir, "NOTICE")), `${pkg}/NOTICE missing`).toBe(true);
            // ...AND listed in `files`, or npm packs the manifest's claim without its proof.
            expect(manifest.files).toContain("LICENSE");
            expect(manifest.files).toContain("NOTICE");
        });

        it(`${pkg} carries the GeoNames CC BY 4.0 attribution (a CONDITION, not a courtesy)`, () => {
            // Both packages embed the coordinate tables: shape-core owns them, chart-host
            // bundles shape-core. CC BY 4.0 attribution is inherited by anyone who bundles
            // either one, so it has to be in the package, not just the repo root.
            const notice = readFileSync(join(dir, "NOTICE"), "utf8");
            expect(notice).toMatch(/GeoNames/);
            expect(notice).toMatch(/CC BY 4\.0/);
            expect(notice).toMatch(/geonames\.org/);
        });
    }

    it("chart-host's build BANNER repeats the attribution, so a bundler that drops NOTICE still complies", () => {
        // A consumer bundling chart-host into their app ships our .mjs but not our NOTICE
        // file. esbuild strips comments by default — which would have silently dropped the
        // only attribution that survives into their build. legalComments + this banner are
        // what make the CC BY condition travel that last hop.
        const build = readFileSync(join(ROOT, "packages", "chart-host", "build.mjs"), "utf8");
        expect(build).toMatch(/banner/);
        expect(build).toMatch(/GeoNames/);
        expect(build).toMatch(/legalComments/);
    });

    it("chart-host still installs with NO runtime dependencies", () => {
        // The README's promise is "npm install @bicharts/chart-host d3" and you are done.
        // Adding a runtime dep is allowed — but it changes that promise and drags the dep's
        // licence into every consumer's build, so it should be a decision, not a diff.
        const manifest = JSON.parse(readFileSync(join(ROOT, "packages", "chart-host", "package.json"), "utf8"));
        expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
    });
});
