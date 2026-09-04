import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { applyLabelContrast, LABEL_CONTRAST_DONE_ATTR } from "../src/labelContrastDom";
import { createChartHost } from "../src/host";
import { DARK_TEXT, LIGHT_TEXT } from "../src/labelContrast";

/*
    THE LABELS ON THE MARKS CAN BE READ, IN EVERY HOST.

    Ported from the Power BI visual when the pass moved into this package, plus the cases only
    the shared entry point can have. The defect these exist for is not a Power BI defect: a
    generated chart colours an in-mark label from the mark's NOMINAL hue, the mark's ACTUAL
    rendered fill is something else, and only a post-render read of the real DOM knows it. Until
    this moved, the Excel add-in and a React page shipped every such label unreadable.

    jsdom has no layout engine: every box is zero and there is no isPointInFill. So the DOM tests
    below stub getBoundingClientRect on the shapes and texts directly, and where a case needs
    the GEOMETRIC backing (a ring's hole, the majority rule) they stub isPointInFill too. That is
    honest for what is being tested - the resolution and the decisions - not the browser's
    layout. The real-Chromium control set lives beside the visual and is re-run there.
*/

let dom: JSDOM;
let doc: Document;
let container: any;

const box = (x: number, y: number, w: number, h: number) =>
    ({ x, y, width: w, height: h, top: y, left: x, right: x + w, bottom: y + h }) as DOMRect;

function svg(tag: string, attrs: Record<string, string> = {}, rect?: DOMRect) {
    const el = doc.createElementNS("http://www.w3.org/2000/svg", tag) as any;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (rect) el.getBoundingClientRect = () => rect;
    return el;
}

function text(content: string, attrs: Record<string, string>, rect: DOMRect) {
    const t = svg("text", attrs, rect);
    t.textContent = content;
    return t;
}

beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body><div id='c'><svg id='s'></svg></div></body></html>");
    doc = dom.window.document as any;
    container = doc.getElementById("c");
    // jsdom's <svg> has no createSVGPoint; the geometric cases below need one on the REAL owner
    // element, because ownerSVGElement is a getter and cannot be stubbed on the shapes.
    (doc.getElementById("s") as any).createSVGPoint = () =>
        ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
});

const root = () => doc.getElementById("s")!;

describe("applyLabelContrast - the decisions the visual made, now shared", () => {
    it("recolours a dark label sitting wholly on a dark tile to white", () => {
        root().appendChild(svg("rect", { fill: "#12239e" }, box(0, 0, 300, 200)));
        const t = text("Qingdao", { fill: "#252423" }, box(120, 90, 60, 20));
        root().appendChild(t);
        const r = applyLabelContrast(container);
        expect(r.scanned).toBe(1);
        expect(r.fixed).toBe(1);
        expect(t.getAttribute("fill")).toBe(LIGHT_TEXT);
        expect(t.getAttribute(LABEL_CONTRAST_DONE_ATTR)).toBe("1");
    });

    it("composites a low-opacity band over the page - the pale header that started the pass", () => {
        // A header band at fill-opacity 0.18 over white READS pale; the code picked white text
        // from the nominal dark hue. Against the composite, white fails and black is chosen.
        root().appendChild(svg("rect", { fill: "#12239e", "fill-opacity": "0.18" }, box(0, 0, 300, 40)));
        const t = text("Channel", { fill: "#ffffff" }, box(10, 10, 80, 20));
        root().appendChild(t);
        const r = applyLabelContrast(container);
        expect(r.fixed).toBe(1);
        expect(t.getAttribute("fill")).toBe(DARK_TEXT);
    });

    it("leaves a label that is on no shape alone - axis, legend, title, caption", () => {
        root().appendChild(svg("rect", { fill: "#12239e" }, box(0, 0, 100, 100)));
        const t = text("Axis title", { fill: "#252423" }, box(150, 150, 60, 20));
        root().appendChild(t);
        const r = applyLabelContrast(container);
        expect(r.scanned).toBe(0);
        expect(r.fixed).toBe(0);
        expect(t.getAttribute("fill")).toBe("#252423");
    });

    it("boosts a translucent pill above the tile and judges against the boosted stack", () => {
        root().appendChild(svg("rect", { fill: "#e66c37" }, box(0, 0, 300, 200)));
        const pill = svg("rect", { fill: "#ffffff", "fill-opacity": "0.18" }, box(100, 80, 100, 40));
        root().appendChild(pill);
        const t = text("42.0", { fill: "#252423" }, box(130, 90, 40, 20));
        root().appendChild(t);
        const r = applyLabelContrast(container);
        expect(r.pillsBoosted).toBe(1);
        expect(pill.getAttribute("fill-opacity")).toBe("0.9");
        expect(t.getAttribute("fill")).toBe(DARK_TEXT);
    });

    it("never adopts an alpha-0 hit target as a backdrop - the black-box legend incident", () => {
        root().appendChild(svg("path", { fill: "#1f77b4" }, box(0, 0, 300, 200)));
        const hit = svg("rect", { fill: "transparent" }, box(100, 80, 100, 40));
        root().appendChild(hit);
        const t = text("Canada", { fill: "#252423" }, box(120, 90, 60, 20));
        root().appendChild(t);
        const r = applyLabelContrast(container);
        expect(r.pillsBoosted).toBe(0);
        expect(hit.getAttribute("fill")).toBe("transparent");
        expect(t.getAttribute("fill")).toBe(LIGHT_TEXT);
    });

    it("keeps an author colour that already reads on a deck PANEL, and still rescues an illegible one", () => {
        root().appendChild(svg("rect", { fill: "#f4f4f4", class: "lch-deck-panel" }, box(0, 0, 300, 200)));
        const good = text("+12%", { fill: "#0b6e4f" }, box(20, 20, 60, 20));    // teal on near-white: reads
        const bad = text("vs median", { fill: "#eeeeee" }, box(20, 60, 80, 20)); // pale on near-white: not
        root().appendChild(good); root().appendChild(bad);
        const r = applyLabelContrast(container);
        expect(good.getAttribute("fill")).toBe("#0b6e4f");
        expect(bad.getAttribute("fill")).toBe(DARK_TEXT);
        expect(r.fixed).toBe(1);
    });

    it("is idempotent within a render", () => {
        root().appendChild(svg("rect", { fill: "#12239e" }, box(0, 0, 300, 200)));
        const t = text("Qingdao", { fill: "#252423" }, box(120, 90, 60, 20));
        root().appendChild(t);
        expect(applyLabelContrast(container).fixed).toBe(1);
        expect(applyLabelContrast(container).fixed).toBe(0);
        expect(t.getAttribute("fill")).toBe(LIGHT_TEXT);
    });

    it("measures against the host's page background, not white, when one is named", () => {
        // A dark canvas: a dark label on a mid-tone tile reads there where white would not.
        root().appendChild(svg("rect", { fill: "#444444", "fill-opacity": "0.5" }, box(0, 0, 300, 200)));
        const t = text("Q3", { fill: "#ffffff" }, box(120, 90, 30, 20));
        root().appendChild(t);
        applyLabelContrast(container, { pageBg: "#101010" });
        expect(t.getAttribute("fill")).toBe("#ffffff"); // composite is dark; white already reads
    });

    it("declines, and says why, on a container with too many shapes", () => {
        for (let i = 0; i < 20; i++) root().appendChild(svg("rect", { fill: "#12239e" }, box(i, 0, 10, 10)));
        root().appendChild(text("x", { fill: "#000" }, box(0, 0, 10, 10)));
        const r = applyLabelContrast(container, { cap: 10 });
        expect(r.skipped).toBe("too-many-shapes");
        expect(r.fixed).toBe(0);
    });

    it("returns an empty report rather than throwing on a missing container", () => {
        const r = applyLabelContrast(null);
        expect(r.skipped).toBe("no-container");
        expect(r.scanned).toBe(0);
    });
});

/*
    THE GEOMETRIC BACKING - a bounding box is not a fill.

    An annulus's box contains its hole, and the hole is canvas; every gauge, donut and progress
    ring puts its headline number there. jsdom cannot answer isPointInFill, so these stub it with
    the ring's real arithmetic and check the two halves of the rule: a label WHOLLY in the hole
    is handed back (offFill), and a label STRADDLING the hole - wider than it, both ends on the
    arc, middle over the page - is handed back too (pageMajority), because the arc holds a
    minority of it and a colour chosen for the arc vanishes over the hole.
*/
describe("applyLabelContrast - a ring's hole is canvas", () => {
    const CX = 150, CY = 100, R_OUT = 70, R_IN = 40;

    function ring(fill: string) {
        const p = svg("path", { fill }, box(CX - R_OUT, CY - R_OUT, 2 * R_OUT, 2 * R_OUT));
        p.isPointInFill = (pt: { x: number; y: number }) => {
            const d = Math.hypot(pt.x - CX, pt.y - CY);
            return d >= R_IN && d <= R_OUT;
        };
        p.getScreenCTM = () => ({ inverse: () => ({}) });
        return p;
    }

    it("hands the centre number back to the chart - wholly inside the hole", () => {
        root().appendChild(ring("#118dff"));
        const t = text("73.4%", { fill: "#252423" }, box(CX - 24, CY - 8, 48, 16));
        root().appendChild(t);
        const r = applyLabelContrast(container);
        expect(r.offFill).toBe(1);
        expect(r.scanned).toBe(0);
        expect(t.getAttribute("fill")).toBe("#252423");
    });

    it("hands a sub-label that STRADDLES the hole back too - the arc holds a minority of it", () => {
        root().appendChild(ring("#B46700"));
        // 90px wide at y = +18: the hole's chord there is ~71px, so both ends sit on the arc and
        // the middle floats over the page. Sample columns land at +-30, inside the hole at the
        // top row and on the arc lower down: a minority of the grid is on the arc.
        const t = text("180,000 of 200,000", { fill: "#252423" }, box(CX - 45, CY + 10, 90, 12));
        root().appendChild(t);
        const r = applyLabelContrast(container);
        expect(r.pageMajority + r.offFill).toBe(1);
        expect(r.fixed).toBe(0);
        expect(t.getAttribute("fill")).toBe("#252423");
    });

    it("still flips a label that overflows a small tile onto its NEIGHBOURS - the union rule", () => {
        // Three adjacent tiles; the label hangs off the middle one on both sides. No single
        // tile holds a majority, the union holds all of it, and it must still be recoloured.
        const tile = (x: number, fill: string) => {
            const r = svg("rect", { fill }, box(x, 90, 40, 16));
            r.isPointInFill = (pt: { x: number; y: number }) => pt.x >= x && pt.x <= x + 40 && pt.y >= 90 && pt.y <= 106;
            r.getScreenCTM = () => ({ inverse: () => ({}) });
            return r;
        };
        root().appendChild(tile(80, "#e66c37"));
        root().appendChild(tile(120, "#12239e"));
        root().appendChild(tile(160, "#6b007b"));
        const t = text("Qingdao", { fill: "#252423" }, box(110, 92, 60, 12));
        root().appendChild(t);
        const r = applyLabelContrast(container);
        expect(r.pageMajority).toBe(0);
        expect(r.fixed).toBe(1);
        expect(t.getAttribute("fill")).toBe(LIGHT_TEXT);
    });
});

/*
    IT REACHES A HOST THROUGH createChartHost, with no option to remember. The failure mode being
    guarded is silent, so this asserts the DOM and the report, never the absence of a throw.
*/
describe("createChartHost runs the pass after every render", () => {
    const DARK_TILE_CHART = `
function render(container, data, options) {
  var doc = container.ownerDocument;
  var NS = "http://www.w3.org/2000/svg";
  var svg = doc.createElementNS(NS, "svg");
  var r = doc.createElementNS(NS, "rect");
  r.setAttribute("fill", "#12239e"); r.setAttribute("class", "d3-mark"); r.setAttribute("data-row-idx", "0");
  r.getBoundingClientRect = function () { return { x:0, y:0, width:300, height:200, top:0, left:0, right:300, bottom:200 }; };
  var t = doc.createElementNS(NS, "text");
  t.setAttribute("fill", "#252423"); t.textContent = String(data.rows[0][0]);
  t.getBoundingClientRect = function () { return { x:120, y:90, width:60, height:20, top:90, left:120, right:180, bottom:110 }; };
  svg.appendChild(r); svg.appendChild(t); container.appendChild(svg);
}`;
    const payload = { columns: [{ name: "City" }], rows: [["Qingdao"]] };

    it("recolours by default and reports what it did", () => {
        const reports: any[] = [];
        const host = createChartHost(container, {
            data: payload, code: DARK_TILE_CHART, d3: {},
            fit: false,
            onLabelContrast: r => reports.push(r),
        });
        host.render();
        const t = container.querySelector("text")!;
        expect(t.getAttribute("fill")).toBe(LIGHT_TEXT);
        expect(reports).toHaveLength(1);
        expect(reports[0]).toMatchObject({ scanned: 1, fixed: 1 });
        host.destroy();
    });

    it("stays out of the way when the host says so", () => {
        const host = createChartHost(container, {
            data: payload, code: DARK_TILE_CHART, d3: {},
            fit: false, labelContrast: false,
        });
        host.render();
        expect(container.querySelector("text")!.getAttribute("fill")).toBe("#252423");
        host.destroy();
    });

    it("takes the page background from the resolved options when the host names none", () => {
        // On a dark themed canvas the same dark tile composites to something white text wins on
        // either way - the point is that backgroundColor REACHES the pass, proven by a colour it
        // changes: a pale tile at half opacity over black is dark, so the dark label must flip.
        const PALE = DARK_TILE_CHART.replace("#12239e", "#dddddd").replace('r.setAttribute("class"', 'r.setAttribute("fill-opacity","0.5"); r.setAttribute("class"');
        const host = createChartHost(container, {
            data: payload, code: PALE, d3: {},
            fit: false, options: { backgroundColor: "#000000" } as any,
        });
        host.render();
        expect(container.querySelector("text")!.getAttribute("fill")).toBe(LIGHT_TEXT);
        host.destroy();
    });
});
