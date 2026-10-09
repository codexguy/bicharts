import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import * as main from "../src/index";
import * as legendFit from "../src/legendFit/index";
import * as pure from "../src/legendFit/legendReconcile";
import * as frameGeometry from "../src/legendFit/frameFit";
import * as legendDom from "../src/legendFit/legendReconcileDom";
import * as frameDom from "../src/legendFit/frameFitDom";

// THE LEGEND-AND-FRAME PASSES LIVE BEHIND THEIR OWN ENTRY, NOT THE MAIN ONE.
//
// The main entry's eager closure is budgeted (scripts/checkEagerSize.mjs): every host loads it, and it
// sits within a few KB of its ceiling. Only a host that runs the post-render passes needs them, so they
// are published as "@bicharts/chart-host/legend-fit", the way "/card" and "/view-state" are. These checks
// keep that true: the main entry must not re-grow them, no runtime module may import them (which would put
// them back in the eager closure), the subpath must stay built and exported (a missing entry would not fail
// any in-repo import, only a consumer's), and its export list is a contract that a host re-exports by name.

const pkgRoot = resolve(__dirname, "..");
const srcRoot = resolve(pkgRoot, "src");

/** Every runtime export of the entry, which is what a host's re-export lists name. */
const EXPECTED_EXPORTS = [
    // pure geometry, legend and content fit
    "AXIS_THIN_GAP", "AXIS_THIN_MIN_TICKS", "BOTTOM_TEXT_MIN_TICK_HITS", "COLORBAR_ON_PLOT_COVER", "FIT_PAD",
    "LABEL_ROW_MIN_TEXTS", "LABEL_ROW_TRACK_COVER", "LABEL_ROW_TRACK_REACH", "LABEL_ROW_Y_TOLERANCE",
    "LEGIBILITY_GRACE_PX", "MAX_FIT_FRACTION", "MAX_GUTTER_FRACTION", "MIN_LEGIBLE_PX", "MIN_OVERLAP",
    "SIGNATURE_MIN_PAIRS", "SWATCH_LABEL_GAP_PX", "SWATCH_MAX_PX",
    "axisLabelsAreNominal", "bottommostOverlappingPlotEdge", "colorbarOnPlot", "colorbarProbePoints",
    "colorbarReconcileSide", "colorbarSitsOnMarks", "groupLabelRows", "isDateLikeLabelText", "isLegendSignature",
    "isNumericLabelText", "isOrderedAxisLabelText", "labelRowHasTrack", "nominalLabelRooms", "planAxisTickThin",
    "planBottomTextPush", "planContentFit", "planLegendReconcile", "rightmostOverlappingPlotEdge", "swatchPairs",
    // pure geometry, frame fit
    "FIT_SHRINK_FLOOR", "FIT_TYPE_FLOOR", "FRAME_PAD", "MAX_EXTEND_FRACTION",
    "cutToFit", "labelFitDecision", "labelRoom", "planFrameFit", "viewBoxAttr",
    // DOM passes
    "FRAME_FIT_TEXT_CAP", "findColorbarFurniture", "findSignatureLegendGroups", "fitDeferredLabels",
    "fitLabelToRoom", "fitTextToFrame", "isClippedOrScrolled", "reconcileLegendInSvg",
    "smallestRenderedTextPx", "styleDeclaresScroll",
];

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) sourceFiles(p, out);
        else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
}

describe("the legend-fit entry", () => {
    it("the main entry does not export any of its symbols (the eager closure is budgeted)", () => {
        const leaked = Object.keys(legendFit).filter(name => name in main);
        expect(leaked).toEqual([]);
    });

    it("no module outside the entry imports it, so the main entry's closure cannot reach it", () => {
        const offenders = sourceFiles(srcRoot)
            .filter(f => !relative(srcRoot, f).split("\\").join("/").startsWith("legendFit/"))
            .filter(f => /from\s+["'][^"']*legendFit[^"']*["']|import\(\s*["'][^"']*legendFit/.test(readFileSync(f, "utf8")))
            .map(f => relative(srcRoot, f));
        expect(offenders).toEqual([]);
    });

    it("package.json exports ./legend-fit and build.mjs builds it", () => {
        const pkg = JSON.parse(readFileSync(resolve(pkgRoot, "package.json"), "utf8"));
        expect(pkg.exports["./legend-fit"]).toEqual({
            types: "./dist/types/legendFit/index.d.ts",
            import: "./dist/legend-fit.mjs",
            default: "./dist/legend-fit.mjs",
        });
        const build = readFileSync(resolve(pkgRoot, "build.mjs"), "utf8");
        expect(build).toMatch(/"legend-fit":\s*join\(here,\s*"src\/legendFit\/index\.ts"\)/);
    });

    it("exports exactly the names a host re-exports (the list is a contract)", () => {
        expect(Object.keys(legendFit).sort()).toEqual([...EXPECTED_EXPORTS].sort());
    });

    it("every runtime export of the four modules is reachable from the entry", () => {
        for (const m of [pure, frameGeometry, legendDom, frameDom]) {
            for (const name of Object.keys(m)) expect(name in legendFit, name).toBe(true);
        }
    });

    it("the shared scroll-fit helpers stay in the main entry and are not duplicated here", () => {
        for (const name of ["FIT_CONTENT_SELECTOR", "PHANTOM_FRACTION", "isPhantomBox", "ctmScaleOf", "svgInkReach"]) {
            expect(name in main, name).toBe(true);
            expect(name in legendFit, name).toBe(false);
        }
    });

    it("no pass picks an svg by tag: a scene with several svgs (a carousel's peeks) has one chart svg, and chartSvgOf names it", () => {
        const FIRST_SVG = /querySelector(?:All)?\s*(?:<[^>]+>)?\s*\(\s*["'`]svg\b|getElementsByTagName\s*\(\s*["'`]svg\b|\.select\s*\(\s*["'`]svg\b/;
        const offenders: string[] = [];
        for (const f of sourceFiles(resolve(srcRoot, "legendFit"))) {
            readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => {
                if (/^\s*(\/\/|\*)/.test(line)) return;
                if (FIRST_SVG.test(line)) offenders.push(`${relative(srcRoot, f)}:${i + 1}: ${line.trim()}`);
            });
        }
        expect(offenders).toEqual([]);
        expect(readFileSync(resolve(srcRoot, "legendFit/frameFitDom.ts"), "utf8")).toMatch(/const svg = chartSvgOf\(host\)/);
    });

    it("the moved code reads the shared helpers from the package, never from a host's private module", () => {
        for (const f of sourceFiles(resolve(srcRoot, "legendFit"))) {
            const imports = [...readFileSync(f, "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map(m => m[1]);
            for (const spec of imports) expect(spec.startsWith("."), `${relative(srcRoot, f)} imports ${spec}`).toBe(true);
        }
    });
});
