// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as source from "../../src/legendFit/index";
import { installSvgLayout, el, makeSvg } from "./support/svgLayout";

// THE BUILT SUBPATH, NOT THE SOURCE. Every other test here imports TypeScript, so they stay green while the
// published bundle is broken (a missing chunk, an export dropped by the bundler, a dependency that did not
// get inlined). This one loads dist/legend-fit.mjs the way a consumer's "@bicharts/chart-host/legend-fit"
// import resolves, checks it carries the same names as the source entry, and drives one DOM pass through it.
// It is SKIPPED, not passed, when there is no build: CI and the release both build first.

const built = resolve(__dirname, "../../dist/legend-fit.mjs");

beforeEach(() => {
    installSvgLayout();
    document.body.innerHTML = "";
});

describe.skipIf(!existsSync(built))("the built legend-fit entry", () => {
    it("exports the same names as the source entry", async () => {
        const mod = await import(/* @vite-ignore */ pathToFileURL(built).href);
        expect(Object.keys(mod).sort()).toEqual(Object.keys(source).sort());
    });

    it("slides a legend that overlaps the plot, from the bundle", async () => {
        const mod = await import(/* @vite-ignore */ pathToFileURL(built).href);
        const svg = makeSvg(760, 430);
        const plot = el(svg, "g", { class: "plot" });
        el(plot, "rect", { class: "d3-mark", x: 60, y: 60, width: 680, height: 24 });
        const legend = el(svg, "g", { class: "legend", transform: "translate(700,60)" });
        ["Pending", "Shipped", "Delayed"].forEach((name, i) => {
            el(legend, "rect", { class: "d3-mark d3-legend-mark", x: 0, y: i * 16, width: 10, height: 10 });
            el(legend, "text", { x: 14, y: i * 16 + 9, "font-size": 10 }, name);
        });
        const res = mod.reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "reserve", source: "class" });
        expect(res.dx).toBe(48);
        expect(legend.getAttribute("transform")).toBe("translate(48,0) translate(700,60)");
    });
});
