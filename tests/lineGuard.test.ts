import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lineGuard } from "../scripts/lineGuard.mjs";

// THE ONE NUMBER LINE, REFUSED AT THE TAG. shape-core, chart-host and chart-mcp share one version
// line; chart-mcp can move alone, and these two then skip its number. release.yml runs the guard,
// so a tag that would reuse the number fails before anything publishes.

const npm = (published: Record<string, string[]>) => async (url: string) => {
    const vs = published[decodeURIComponent(url.replace("https://registry.npmjs.org/", ""))];
    if (!vs) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ versions: Object.fromEntries(vs.map((v) => [v, {}])) }) };
};
// chart-mcp published 0.6.46 on its own while these two were at 0.6.45.
const LINE = { "@bicharts/shape-core": ["0.6.45"], "@bicharts/chart-host": ["0.6.45"], "@bicharts/chart-mcp": ["0.6.46"] };
const HERE = { self: "@bicharts/shape-core", other: "@bicharts/chart-mcp", rule: "above" as const };

describe("the line guard for a bicharts tag", () => {
    it("refuses the number chart-mcp took, and names the next free one", async () => {
        const r = await lineGuard({ version: "0.6.46", ...HERE, fetchImpl: npm(LINE) });
        expect(r.ok).toBe(false);
        expect(r.reason).toContain("release 0.6.47");
    });
    it("accepts the next number", async () => {
        expect((await lineGuard({ version: "0.6.47", ...HERE, fetchImpl: npm(LINE) })).ok).toBe(true);
    });
    it("passes a re-run of a version already published", async () => {
        expect((await lineGuard({ version: "0.6.45", ...HERE, fetchImpl: npm(LINE) })).ok).toBe(true);
    });
    it("refuses anything that is not plain x.y.z", async () => {
        expect((await lineGuard({ version: "0.6.47-beta", ...HERE, fetchImpl: npm(LINE) })).ok).toBe(false);
    });
});

describe("release.yml runs it before publishing", () => {
    it("guards a v* tag with rule above against chart-mcp, before the publish step", () => {
        const wf = readFileSync(resolve(__dirname, "../.github/workflows/release.yml"), "utf8");
        const at = wf.indexOf("node scripts/lineGuard.mjs");
        expect(at, "release.yml never runs the line guard").toBeGreaterThan(-1);
        expect(wf.slice(at, wf.indexOf("\n", at))).toContain("--self @bicharts/shape-core --other @bicharts/chart-mcp --rule above");
        expect(at).toBeLessThan(wf.indexOf("- name: publish"));
    });
});
