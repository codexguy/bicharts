// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { captureSvgSnapshot, svgToDataUrl, svgNaturalSize, rasterizeSvgToPngDataUrl } from "../src/snapshot";

// jsdom has no real canvas or image decoding, and that is an asset here rather than a gap:
// the FALLBACK path — "rasterizing failed, hand back the SVG data URL" — is exactly what runs
// in a constrained host, and it is the path a naive implementation gets wrong by returning
// null (dropping a perfectly good vector snapshot) or by rejecting (breaking the caller that
// only wanted a side-channel capture).

const SVG_NS = "http://www.w3.org/2000/svg";

function makeSvg(withLabel = "Revenue"): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    const text = document.createElementNS(SVG_NS, "text");
    text.textContent = withLabel;
    svg.appendChild(text);
    document.body.appendChild(svg);
    return svg;
}

function decodeDataUrl(url: string): string {
    const b64 = url.slice(url.indexOf(",") + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

describe("svgToDataUrl", () => {
    it("inlines intrinsic width/height so a later Image() load is never 0x0", () => {
        const svg = makeSvg();
        const decoded = decodeDataUrl(svgToDataUrl(svg));
        expect(decoded).toMatch(/width="\d+"/);
        expect(decoded).toMatch(/height="\d+"/);
        expect(decoded).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    it("survives non-latin1 labels — the btoa trap", () => {
        // btoa() throws on anything outside latin1; axis labels are routinely outside it.
        const svg = makeSvg("Ventas por Año — 日本");
        const url = svgToDataUrl(svg);
        expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
        expect(decodeDataUrl(url)).toContain("Año");
    });

    it("does not mutate the SVG on the page", () => {
        const svg = makeSvg();
        svgToDataUrl(svg);
        expect(svg.getAttribute("width")).toBeNull();
    });

    it("falls back to a sane size when the element reports none", () => {
        const { width, height } = svgNaturalSize(makeSvg());
        expect(width).toBeGreaterThan(0);
        expect(height).toBeGreaterThan(0);
    });
});

describe("captureSvgSnapshot", () => {
    it("returns the SVG data URL when rasterizing is unavailable — a vector snapshot is a snapshot", async () => {
        const svg = makeSvg();
        const out = await captureSvgSnapshot(svg, { timeoutMs: 50 });
        expect(out).not.toBeNull();
        expect(out!.startsWith("data:image/svg+xml;base64,")).toBe(true);
    });

    it("finds the svg under a container element", async () => {
        const div = document.createElement("div");
        const svg = document.createElementNS(SVG_NS, "svg");
        div.appendChild(svg);
        document.body.appendChild(div);
        const out = await captureSvgSnapshot(div, { timeoutMs: 50 });
        expect(out).not.toBeNull();
    });

    it("null only when there is genuinely nothing to capture", async () => {
        expect(await captureSvgSnapshot(null)).toBeNull();
        expect(await captureSvgSnapshot(undefined)).toBeNull();
        expect(await captureSvgSnapshot(document.createElement("div"))).toBeNull();
    });

    it("reports the fallback through onWarn instead of failing", async () => {
        const events: string[] = [];
        const svg = makeSvg();
        await captureSvgSnapshot(svg, { timeoutMs: 50, onWarn: (e) => events.push(e) });
        // jsdom never fires Image onload, so the raster path must have said WHY it fell back.
        expect(events.length).toBeGreaterThan(0);
    });
});

describe("rasterizeSvgToPngDataUrl", () => {
    it("resolves null on a decode that never completes — never hangs, never rejects", async () => {
        const out = await rasterizeSvgToPngDataUrl("data:image/svg+xml;base64,PHN2Zy8+", 100, 100, { timeoutMs: 40 });
        expect(out).toBeNull();
    });
});
