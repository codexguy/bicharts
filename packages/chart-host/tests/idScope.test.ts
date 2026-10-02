import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { scopeChartIds, newIdScope } from "../src/idScope";
import { createChartHost } from "../src/host";

/*
    TWO SAME-SIZE CHARTS, ONE PAGE, ONE CLIP PATH ID. A world flow map beside a world choropleth of the same tile size
    both named their basemap clip 'llmgeoclip-97602' (the id is derived from the viewport, deterministic on purpose),
    the browser resolved url(#llmgeoclip-97602) to the choropleth's rectangle, and the flow map lost the top of Canada
    with nothing in the console. Every chart's ids are now scoped to its host after each render.
*/

const NS = "http://www.w3.org/2000/svg";

function chartInto(doc: Document, parent: Element, clipTop: number): Element {
    const c = doc.createElement("div");
    const svg = doc.createElementNS(NS, "svg");
    const defs = doc.createElementNS(NS, "defs");
    const cp = doc.createElementNS(NS, "clipPath");
    cp.setAttribute("id", "llmgeoclip-97602");
    const r = doc.createElementNS(NS, "rect");
    r.setAttribute("y", String(clipTop));
    cp.appendChild(r);
    const grad = doc.createElementNS(NS, "linearGradient");
    grad.setAttribute("id", "ramp");
    defs.appendChild(cp); defs.appendChild(grad); svg.appendChild(defs);
    const g = doc.createElementNS(NS, "g");
    g.setAttribute("clip-path", "url(#llmgeoclip-97602)");
    const p = doc.createElementNS(NS, "rect");
    p.setAttribute("fill", "url('#ramp')");
    p.setAttribute("style", "mask: url(#ramp)");
    g.appendChild(p);
    const use = doc.createElementNS(NS, "use");
    use.setAttribute("href", "#ramp");
    g.appendChild(use);
    svg.appendChild(g); c.appendChild(svg); parent.appendChild(c);
    return c;
}

describe("scopeChartIds", () => {
    it("gives each chart its own ids and points its references at them", () => {
        const doc = new JSDOM("<!doctype html><body></body>").window.document;
        const a = chartInto(doc, doc.body, 89), b = chartInto(doc, doc.body, 0);
        const ra = scopeChartIds(a, newIdScope()), rb = scopeChartIds(b, newIdScope());
        const ids = [...doc.querySelectorAll("[id]")].map(n => n.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const c of [a, b]) {
            const clipId = c.querySelector("clipPath")!.id, gradId = c.querySelector("linearGradient")!.id;
            expect(c.querySelector("g")!.getAttribute("clip-path")).toBe(`url(#${clipId})`);
            expect(c.querySelector("g > rect")!.getAttribute("fill")).toBe(`url('#${gradId}')`);
            expect(c.querySelector("g > rect")!.getAttribute("style")).toBe(`mask: url(#${gradId})`);
            expect(c.querySelector("use")!.getAttribute("href")).toBe(`#${gradId}`);
        }
        expect(rb.collisions).toEqual(["llmgeoclip-97602", "ramp"]);   // the second chart's ids already existed
        expect(ra.renamed).toBe(2);
    });

    it("is idempotent, and leaves the host's own bic- ids alone", () => {
        const doc = new JSDOM("<!doctype html><body></body>").window.document;
        const a = chartInto(doc, doc.body, 0);
        const own = doc.createElement("div"); own.id = "bic-review-ask-overlay"; a.appendChild(own);
        const s = newIdScope();
        scopeChartIds(a, s);
        const once = [...a.querySelectorAll("[id]")].map(n => n.id);
        const again = scopeChartIds(a, s);
        expect([...a.querySelectorAll("[id]")].map(n => n.id)).toEqual(once);
        expect(again.renamed).toBe(0);
        expect(own.id).toBe("bic-review-ask-overlay");
    });
});

describe("createChartHost scopes ids after every render", () => {
    it("two hosts drawing the same ids on one page end up with distinct ids, and warn once", () => {
        const dom = new JSDOM("<!doctype html><body></body>");
        const doc = dom.window.document;
        const warns: string[] = [];
        (dom.window as any).console = { ...console, warn: (m: string) => warns.push(String(m)) };
        const code = `function render(container, data, options) {
            var ns = 'http://www.w3.org/2000/svg';
            var svg = document.createElementNS(ns, 'svg');
            var cp = document.createElementNS(ns, 'clipPath'); cp.setAttribute('id', 'llmgeoclip-1');
            svg.appendChild(cp);
            var g = document.createElementNS(ns, 'g'); g.setAttribute('clip-path', 'url(#llmgeoclip-1)'); g.setAttribute('class', 'd3-mark');
            svg.appendChild(g); container.appendChild(svg);
        }`;
        const reports: any[] = [];
        const els = [doc.createElement("div"), doc.createElement("div")];
        for (const el of els) {
            doc.body.appendChild(el);
            const h = createChartHost(el, { code, data: { columns: [], rows: [] } as any, window: dom.window as any,
                fit: false, labelContrast: false, onIdScope: r => reports.push(r) } as any);
            h.render();
        }
        const ids = [...doc.querySelectorAll("clipPath")].map(n => n.id);
        expect(ids.length).toBe(2);
        expect(ids[0]).not.toBe(ids[1]);
        for (const el of els) {
            expect(el.querySelector("g")!.getAttribute("clip-path")).toBe(`url(#${el.querySelector("clipPath")!.id})`);
        }
        expect(reports.length).toBe(2);
        expect(reports[1].collisions).toEqual(["llmgeoclip-1"]);
    });
});
