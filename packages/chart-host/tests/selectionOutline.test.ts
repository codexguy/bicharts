import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { createChartHost, type ChartHostConfig } from "../src/host";
import { MARK_CLASS, ROW_IDX_ATTR, MARK_SELECTED_CLASS } from "../src/contract";
import { rgbToLab } from "../src/deltaE";
import { SELECTION_GLYPH_CLASS } from "../src/selection";

// The outline layer's class, as a literal: this suite runs against code that predates the module naming it.
const SELECTION_OUTLINE_CLASS = "lch-sel-outline";

// WHAT MARKS A SELECTION BEYOND THE DIM, ON A PLAIN HOST.
//
// A selection dims every mark outside it and leaves the selected mark's paint alone. A diverging colour ramp's centre
// is a neutral just off the canvas, and the dim pulls every other mark toward the canvas too, so on a diverging
// choropleth a selected region near the centre and a dimmed region at either end converge on one pale colour. On a
// real dashboard (a World choropleth of attainment) the selected country and a dimmed one measured CIE76 deltaE 2.1
// apart: the selection had disappeared.
//
// A REGION MAP (rows carrying the host's region join column) is outlined by default; every other chart takes the
// general setting, whose default "auto" outlines only a chart declaring a neutral-centre ramp and leaves every other
// chart exactly as it was.
//
// THE FIXTURE is synthesized: eight regions tiled in a row, coloured on a diverging ramp about 1.0 (low #b35806, a
// neutral centre just off the canvas, high #2166ac, interpolated in RGB as d3's linear scale does), with China just
// above the centre. jsdom has no layout, so each mark reports the screen matrix a browser would (identity).

const SVG_NS = "http://www.w3.org/2000/svg";
const LOW = "#b35806", HIGH = "#2166ac";
const VALUES: [string, number][] = [
    ["CHN", 1.1], ["BRA", 1.6], ["FRA", 1.45], ["NLD", 1.3], ["USA", 0.5], ["IND", 0.7], ["DEU", 1.15], ["ZAF", 0.92],
];
const THEMES = {
    light: { bg: "#ffffff", fg: "#252423", mid: "#f7f7f7" },
    dark: { bg: "#252423", fg: "#ffffff", mid: "#3b3a39" },
    hc: { bg: "#000000", fg: "#ffff00", mid: "#1a1a1a" },
} as const;
type Theme = keyof typeof THEMES;

const hexRgb = (h: string): [number, number, number] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as any;
const rgbHex = (c: number[]) => "#" + c.map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
function rampColour(v: number, mid: string): string {
    const t = Math.min(1, Math.abs(v - 1) / 0.6);
    return rgbHex(lerp(hexRgb(mid), hexRgb(v >= 1 ? HIGH : LOW), t));
}
/** CIE76, the measure the dashboard was read with. */
function dE76(a: number[], b: number[]): number {
    const A = rgbToLab(a[0], a[1], a[2]), B = rgbToLab(b[0], b[1], b[2]);
    return Math.hypot(A.L - B.L, A.a - B.a, A.b - B.b);
}
const over = (c: number[], alpha: number, bg: number[]) => c.map((v, i) => v * alpha + bg[i] * (1 - alpha));

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** A region map's data: the region join column marks it as one. `region` false drops it (a point map's rows). */
function data(region = true) {
    return {
        columns: [{ name: "Country" }, { name: "Attainment" }, { name: "__rowIdx__" }, ...(region ? [{ name: "__geoIso__" }] : [{ name: "__geoLat__" }])],
        rows: VALUES.map(([iso, v], i) => [iso, v, i, region ? iso : 0]),
    };
}

/** Chart code: one square path per row (a region), coloured from the ramp. `ramp` draws the diverging legend the
 *  shared value ramp declares; `shape` swaps the regions for other marks (a line, points). */
function code(theme: Theme, opts: { ramp?: boolean; shape?: "region" | "rect" | "line" | "circle"; control?: boolean } = {}) {
    const colours = VALUES.map(([, v]) => rampColour(v, THEMES[theme].mid));
    const shape = opts.shape ?? "region";
    return `
function render(container, data, options) {
  var doc = container.ownerDocument, NS = '${SVG_NS}';
  var svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('width', '800'); svg.setAttribute('height', '200');
  container.appendChild(svg);
  var colours = ${JSON.stringify(colours)};
  data.rows.forEach(function (r, i) {
    var m;
    if ('${shape}' === 'region') { m = doc.createElementNS(NS, 'path'); m.setAttribute('d', 'M' + (i * 100) + ',0h100v100h-100Z'); m.setAttribute('fill', colours[i]); }
    else if ('${shape}' === 'rect') { m = doc.createElementNS(NS, 'rect'); m.setAttribute('x', String(i * 100)); m.setAttribute('y', '0'); m.setAttribute('width', '100'); m.setAttribute('height', '100'); m.setAttribute('fill', colours[i]); }
    else if ('${shape}' === 'line') { m = doc.createElementNS(NS, 'path'); m.setAttribute('d', 'M' + (i * 100) + ',50l100,10'); m.setAttribute('fill', 'none'); m.setAttribute('stroke', colours[i]); }
    else { m = doc.createElementNS(NS, 'circle'); m.setAttribute('cx', String(i * 100 + 50)); m.setAttribute('cy', '50'); m.setAttribute('r', '6'); m.setAttribute('fill', colours[i]); }
    m.setAttribute('class', '${MARK_CLASS}');
    m.setAttribute('${ROW_IDX_ATTR}', String(r[2]));
    m.setAttribute('stroke-width', '0.5');
    m.getScreenCTM = function () { return ${JSON.stringify(IDENTITY)}; };
    m.getBoundingClientRect = function () { return { left: i * 100, top: 0, width: 100, height: 100, right: i * 100 + 100, bottom: 100, x: i * 100, y: 0 }; };
    svg.appendChild(m);
  });
  ${opts.ramp ? `var g = doc.createElementNS(NS, 'g'); g.setAttribute('class', 'llm-value-ramp'); g.setAttribute('data-kind', 'diverging'); svg.appendChild(g);` : ""}
  ${opts.control ? `
  // a map's zoom pad: two buttons the chart declares controls, over the top of the second region (x 100-200)
  [[150, 4], [172, 4]].forEach(function (p) {
    var c = doc.createElementNS(NS, 'g'); c.setAttribute('class', 'llm-zoom-btn lch-control');
    c.getBoundingClientRect = function () { return { left: p[0], top: p[1], width: 18, height: 18, right: p[0] + 18, bottom: p[1] + 18, x: p[0], y: p[1] }; };
    svg.appendChild(c);
  });` : ""}
}`;
}

let dom: JSDOM;
let container: HTMLElement;

beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body><div id='c'></div></body></html>");
    (globalThis as any).MouseEvent = dom.window.MouseEvent;
    container = dom.window.document.getElementById("c") as unknown as HTMLElement;
});

type Report = Parameters<NonNullable<ChartHostConfig["onSelectionGlyphs"]>>[0];

function host(theme: Theme, options: Record<string, unknown> = {}, opts: { ramp?: boolean; shape?: "region" | "rect" | "line" | "circle"; region?: boolean; control?: boolean } = {}) {
    const reports: Report[] = [];
    const t = THEMES[theme];
    const h = createChartHost(container, {
        code: code(theme, opts), data: data(opts.region ?? true) as any, d3: {},
        options: { themeBg: t.bg, themeFg: t.fg, isHighContrast: theme === "hc", dimOpacity: 0.22, ...options },
        onSelectionGlyphs: r => reports.push(r),
    });
    h.render();
    return { h, reports };
}
const marks = () => Array.from(container.querySelectorAll(`.${MARK_CLASS}`));
const click = (el: Element) => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
const outlineLayer = () => container.querySelector(`.${SELECTION_OUTLINE_CLASS}`);
const outlines = () => Array.from(container.querySelectorAll(`.${SELECTION_OUTLINE_CLASS} path, .${SELECTION_OUTLINE_CLASS} rect, .${SELECTION_OUTLINE_CLASS} polygon`))
    .filter(e => !e.closest("mask"));      // a mask's rects are its holes, not outlines
const glyphs = () => Array.from(container.querySelectorAll(`.${SELECTION_GLYPH_CLASS}`));

/**
 * What the reader sees of the selection: for the selected region and each dimmed one, the colours each puts on
 * screen. The selected region shows its fill at full strength, plus the ink of any outline drawn on its own shape;
 * a dimmed region shows its fill at the dim over the canvas. Returns how far the selected region's most distinct
 * colour stands from the dimmed region nearest it, and the noise floor: the largest difference among the dimmed
 * regions themselves. A selection the reader can pick out stands further from every dimmed region than the dimmed
 * regions stand from each other.
 */
function separation(theme: Theme) {
    const t = THEMES[theme];
    const bg = hexRgb(t.bg);
    const dim = parseFloat(container.style.getPropertyValue("--lch-dim-opacity"));
    expect(dim, "the host wrote the dim level on the container").toBeCloseTo(0.22, 5);
    const all = marks();
    const sel = all.filter(m => m.classList.contains(MARK_SELECTED_CLASS));
    expect(sel, "one region is selected").toHaveLength(1);
    const dimmed = all.filter(m => !m.classList.contains(MARK_SELECTED_CLASS))
        .map(m => over(hexRgb(m.getAttribute("fill")!), dim, bg));
    const shown: number[][] = [hexRgb(sel[0].getAttribute("fill")!)];
    for (const o of outlines()) {
        if (o.getAttribute("d") === sel[0].getAttribute("d")) shown.push(hexRgb(o.getAttribute("stroke")!));
    }
    let noise = 0;
    for (const a of dimmed) for (const b of dimmed) noise = Math.max(noise, dE76(a, b));
    const nearest = (c: number[]) => Math.min(...dimmed.map(d => dE76(c, d)));
    const apart = Math.max(...shown.map(nearest));
    return { apart, noise, fillApart: nearest(shown[0]) };
}

describe("a selected region near a diverging ramp's centre stays visible", () => {
    for (const theme of ["light", "dark", "hc"] as const) {
        it(`on a choropleth with no option set, it stands further from every dimmed region than they stand from each other (${theme})`, () => {
            host(theme);
            click(marks()[0]);                                   // China, just above the centre
            const s = separation(theme);
            // The collision itself, measured on the fixture: the selected fill alone sits inside the dimmed spread.
            expect(s.fillApart).toBeLessThan(s.noise);
            expect(s.apart, `apart ${s.apart.toFixed(1)} vs noise ${s.noise.toFixed(1)}`).toBeGreaterThan(s.noise);
        });
    }

    it("the outline is the selected region's own shape in the text colour over a halo of the canvas, never hit-tested", () => {
        const { reports } = host("light");
        click(marks()[0]);
        const layer = outlineLayer()!;
        expect(layer, "an outline layer is drawn").toBeTruthy();
        expect(layer.getAttribute("aria-hidden")).toBe("true");
        expect(layer.getAttribute("style")).toMatch(/pointer-events:\s*none/);
        const paths = outlines();
        expect(paths.map(p => p.getAttribute("d"))).toEqual(["M0,0h100v100h-100Z", "M0,0h100v100h-100Z"]);
        expect(paths.map(p => p.getAttribute("stroke"))).toEqual(["#ffffff", "#252423"]);
        expect(paths.map(p => p.getAttribute("stroke-width"))).toEqual(["4", "2"]);
        for (const p of paths) {
            expect(p.getAttribute("fill")).toBe("none");
            expect(p.getAttribute("vector-effect")).toBe("non-scaling-stroke");
        }
        expect(reports.at(-1)).toEqual({ mode: "outline", drawn: 1, total: 1, suppressed: false });
    });

    it("dark and high contrast: the ink is the theme's text colour and the halo its canvas", () => {
        host("dark");
        click(marks()[0]);
        expect(outlines().map(p => p.getAttribute("stroke"))).toEqual(["#252423", "#ffffff"]);
        container.innerHTML = "";
        host("hc");
        click(marks()[0]);
        expect(outlines().map(p => p.getAttribute("stroke"))).toEqual(["#000000", "#ffff00"]);
    });

    it("the outline sits over the chart in the host's layer, and leaves every mark as it was: same order, same paint", () => {
        host("light");
        const before = marks().map(m => m.outerHTML.replace(/ class="[^"]*"/, ""));
        click(marks()[3]);
        const after = marks().map(m => m.outerHTML.replace(/ class="[^"]*"/, ""));
        expect(after).toEqual(before);                     // no mark raised, restroked or restyled
        const svg = container.querySelector("svg")!;
        const layer = outlineLayer()!;
        // Later in the container than the chart's svg, in a layer the host positions over it: painted above every
        // neighbouring region, so a shared border is not painted over.
        expect(svg.compareDocumentPosition(layer) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect((layer.parentElement as HTMLElement).style.zIndex).toBe("1");
        expect((layer.parentElement as HTMLElement).style.pointerEvents).toBe("none");
    });

    it("a pan or zoom without a render moves the outline with its region on the next frame", async () => {
        host("light");
        click(marks()[1]);
        const ink = () => outlines().filter(p => p.getAttribute("stroke") === "#252423");
        expect(ink().map(p => p.getAttribute("transform"))).toEqual(["matrix(1 0 0 1 0 0)"]);
        // The zoom behaviour writes a transform on the layer holding the regions; each region's screen matrix follows it.
        const zoomed = { a: 2, b: 0, c: 0, d: 2, e: 50, f: 20 };
        for (const m of marks()) (m as any).getScreenCTM = () => zoomed;
        container.querySelector("svg")!.setAttribute("transform", "translate(50,20) scale(2)");
        await new Promise(r => setTimeout(r, 60));
        expect(ink().map(p => p.getAttribute("transform"))).toEqual(["matrix(2 0 0 2 50 20)"]);
        expect(ink().map(p => p.getAttribute("d"))).toEqual([marks()[1].getAttribute("d")]);
    });

    it("a region running under the chart's own controls is outlined up to them, never across: the controls are holes", () => {
        host("light", {}, { control: true });
        click(marks()[1]);
        const layer = outlineLayer()!;
        // the outline is still drawn round the whole region...
        expect(outlines().map(p => p.getAttribute("d"))).toEqual(["M100,0h100v100h-100Z", "M100,0h100v100h-100Z"]);
        // ...through a mask whose one hole is the two buttons, merged into one box and grown by 2 px
        const g = layer.querySelector("g[mask]")!;
        expect(g, "the outlines are drawn through a mask").toBeTruthy();
        const id = /url\(#([^)]+)\)/.exec(g.getAttribute("mask")!)![1];
        const mask = layer.querySelector(`mask[id="${id}"]`)!;
        expect(mask.getAttribute("maskUnits")).toBe("userSpaceOnUse");
        const holes = Array.from(mask.querySelectorAll("rect")).filter(r => r.getAttribute("fill") === "#000")
            .map(r => ["x", "y", "width", "height"].map(k => Number(r.getAttribute(k))));
        expect(holes).toEqual([[148, 2, 44, 22]]);
        expect(Array.from(g.querySelectorAll("path"))).toHaveLength(2);
    });

    it("a chart with no controls draws its outline with no mask", () => {
        host("light");
        click(marks()[1]);
        expect(outlineLayer()!.querySelector("mask, g[mask]")).toBeNull();
    });

    it("a clear removes the outline, and Ctrl-click outlines each selected region", () => {
        const { h } = host("light");
        click(marks()[0]);
        marks()[2].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, ctrlKey: true }));
        expect(outlines().filter(p => p.getAttribute("stroke") === "#252423").map(p => p.getAttribute("d")))
            .toEqual(["M0,0h100v100h-100Z", "M200,0h100v100h-100Z"]);
        h.selection.clear();
        expect(outlines()).toHaveLength(0);
    });
});

describe("the map setting and the general setting", () => {
    it("Outline is the map default: no option at all outlines a region map", () => {
        host("light");
        click(marks()[1]);
        expect(outlines()).toHaveLength(2);
        expect(glyphs()).toHaveLength(0);
    });

    it("on a region map the map setting decides: None draws nothing, Dot a glyph; the general setting never reaches it", () => {
        host("light", { mapSelectionGlyph: "none", selectionGlyph: "dot" });
        click(marks()[1]);
        expect(outlines()).toHaveLength(0);
        expect(glyphs()).toHaveLength(0);
        container.innerHTML = "";
        host("light", { mapSelectionGlyph: "dot", selectionGlyph: "outline" });
        click(marks()[1]);
        expect(glyphs()).toHaveLength(1);
        expect(outlines()).toHaveLength(0);
    });

    it("the general default is auto: a chart that is not a map and declares a neutral-centre ramp is outlined", () => {
        host("light", {}, { shape: "rect", ramp: true, region: false });
        click(marks()[0]);
        expect(outlines().map(p => p.tagName.toLowerCase())).toEqual(["rect", "rect"]);
        expect(outlines()[1].getAttribute("width")).toBe("100");
    });

    it("explicit None on that chart draws nothing; explicit Outline on a chart with no ramp outlines its area marks", () => {
        host("light", { selectionGlyph: "none" }, { shape: "rect", ramp: true, region: false });
        click(marks()[0]);
        expect(outlineLayer()).toBeNull();
        container.innerHTML = "";
        host("light", { selectionGlyph: "outline" }, { shape: "rect", region: false });
        click(marks()[0]);
        expect(outlines()).toHaveLength(2);
    });

    it("a line or a point keeps its geometry: Outline draws nothing around either", () => {
        for (const shape of ["line", "circle"] as const) {
            container.innerHTML = "";
            const { reports } = host("light", { selectionGlyph: "outline" }, { shape, region: false });
            click(marks()[0]);
            expect(outlines(), shape).toHaveLength(0);
            expect(reports.at(-1), shape).toEqual({ mode: "outline", drawn: 0, total: 0, suppressed: false });
        }
    });

    it("a point map has no region join column, so it takes the general setting: nothing by default", () => {
        const { reports } = host("light", {}, { shape: "circle", region: false });
        click(marks()[0]);
        expect(container.querySelector(".bic-selection-glyphs")).toBeNull();
        expect(reports).toEqual([]);
    });

    it("a family that never takes a marker is never outlined, and says so", () => {
        const { reports } = host("light", { suppressSelectionGlyph: true });
        click(marks()[0]);
        expect(outlines()).toHaveLength(0);
        expect(reports.at(-1)).toEqual({ mode: "outline", drawn: 0, total: 0, suppressed: true });
    });
});

// THE DEFAULT IS UNCHANGED WHERE IT HAS NOTHING TO DO. A chart that is not a region map and declares no neutral-centre
// ramp draws, under the default, exactly what it drew when the default was None: the same bytes in the container.
describe("a chart that is neither a map nor on a neutral-centre ramp is byte-identical under the default", () => {
    for (const shape of ["rect", "line", "circle"] as const) {
        it(`${shape} marks, a click and a Ctrl-click: no option renders what explicit None renders`, () => {
            const snap = (options: Record<string, unknown>) => {
                container.innerHTML = "";
                container.removeAttribute("style");
                container.removeAttribute("class");
                const { h } = host("light", options, { shape, region: false });
                const out: string[] = [container.outerHTML];
                click(marks()[2]);
                out.push(container.outerHTML);
                marks()[5].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, ctrlKey: true }));
                out.push(container.outerHTML);
                h.destroy();
                return out;
            };
            expect(snap({})).toEqual(snap({ selectionGlyph: "none" }));
        });
    }
});
