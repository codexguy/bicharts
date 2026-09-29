// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { captureSvgSnapshot, tableHostOf, svgToDataUrl } from "../src/snapshot";

// AN HTML TABLE LANE'S PICTURE IS ITS FRAME, NOT ITS FIRST CELL. A table with embedded bars draws
// HTML rows with one small <svg> per cell; the snapshot took "the first <svg>" and stored a 201x36
// picture of one bar labelled "2" for an 811x552 tile. The fixture is the frame the table helper
// builds (a flex column: a header and a scrolling body, sized by inline style) holding a six-row,
// three-column table whose third column is a bar per row.

const SVG_NS = "http://www.w3.org/2000/svg";

function decode(url: string): string {
    const bin = atob(url.slice(url.indexOf(",") + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

const ROWS = [["North", "12"], ["South", "7"], ["East", "2"], ["West", "9"], ["Central", "4"], ["Coastal", "6"]];

function tabularRender(w = 811, h = 552): HTMLElement {
    const container = document.createElement("div");
    const frame = document.createElement("div");
    frame.className = "lch-table-frame";
    frame.style.cssText = `display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden;width:${w}px;height:${h}px;`;
    const header = document.createElement("div");
    header.className = "lch-table-header";
    header.textContent = "Region | Orders | Share";
    const body = document.createElement("div");
    body.className = "lch-table-body";
    body.style.cssText = "flex:1 1 auto;min-height:0;overflow-y:auto;";
    for (const [region, n] of ROWS) {
        const row = document.createElement("div");
        row.className = "d3-mark";
        const c1 = document.createElement("span"); c1.textContent = region;
        const c2 = document.createElement("span"); c2.textContent = n;
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("width", "201"); svg.setAttribute("height", "36");
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("width", String(+n * 10)); rect.setAttribute("height", "20");
        const label = document.createElementNS(SVG_NS, "text");
        label.textContent = n;
        svg.appendChild(rect); svg.appendChild(label);
        row.appendChild(c1); row.appendChild(c2); row.appendChild(svg);
        body.appendChild(row);
    }
    frame.appendChild(header);
    frame.appendChild(body);
    container.appendChild(frame);
    document.body.appendChild(container);
    return container;
}

describe("a table lane's snapshot is the frame", () => {
    it("has the tile's aspect and contains every row", async () => {
        const out = await captureSvgSnapshot(tabularRender(), { timeoutMs: 30 });
        expect(out).not.toBeNull();
        const svg = decode(out!);
        // The TILE's size - not one cell's 201x36.
        expect(svg).toMatch(/^<svg[^>]*\swidth="811"[^>]*\sheight="552"/);
        expect(svg).toContain("<foreignObject");
        for (const [region, n] of ROWS) {
            expect(svg).toContain(`>${region}<`);
            expect(svg).toContain(`>${n}<`);
        }
        expect(svg).toContain("Region | Orders | Share");
    });

    it("tableHostOf finds the frame, and leaves an SVG chart alone", () => {
        const c = tabularRender();
        expect(tableHostOf(c)?.className).toBe("lch-table-frame");

        // An SVG chart with a table beside it (a legend table after the plot) keeps its SVG snapshot.
        const svgChart = document.createElement("div");
        svgChart.innerHTML = `<svg width="400" height="300"><rect class="d3-mark"/></svg><table><tr><td>legend</td></tr></table>`;
        expect(tableHostOf(svgChart)).toBeNull();
        expect(tableHostOf(null)).toBeNull();
    });

    it("a plain <table> holding the first svg is a table host too", () => {
        const c = document.createElement("div");
        c.innerHTML = `<table style="width:500px;height:200px"><tr><td>A</td><td><svg width="80" height="20"><rect/></svg></td></tr></table>`;
        expect(tableHostOf(c)?.tagName).toBe("TABLE");
    });

    it("the page is not touched", async () => {
        const c = tabularRender();
        const before = c.innerHTML;
        await captureSvgSnapshot(c, { timeoutMs: 30 });
        expect(c.innerHTML).toBe(before);
    });
});

describe("an SVG snapshot carries its text's font", () => {
    it("inlines the computed font on text the chart left to inherit", () => {
        const host = document.createElement("div");
        host.style.fontFamily = "Segoe UI";
        const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
        const t = document.createElementNS(SVG_NS, "text");
        t.textContent = "Revenue";
        svg.appendChild(t);
        host.appendChild(svg);
        document.body.appendChild(host);
        // jsdom does not cascade fonts into SVG; a browser does. Answer as the browser would.
        const real = window.getComputedStyle.bind(window);
        const spy = vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
            if (el.tagName !== "text") return real(el);
            return { getPropertyValue: (p: string) => ({ "font-family": "\"Segoe UI\"", "font-size": "12px" } as Record<string, string>)[p] ?? "" } as any;
        });
        let out: string;
        try { out = decode(svgToDataUrl(svg)); } finally { spy.mockRestore(); }
        expect(out, out).toMatch(/<text[^>]*style="[^"]*font-family:\s*(&quot;|")?Segoe UI/);
        expect(out).toMatch(/<text[^>]*style="[^"]*font-size:\s*12px/);
        // ...on the CLONE only.
        expect(t.getAttribute("style")).toBeNull();
    });
});
