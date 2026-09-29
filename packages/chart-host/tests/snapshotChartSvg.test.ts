// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { captureSvgSnapshot, chartSvgOf } from "../src/snapshot";
import { SNAPSHOT_SVG_ATTR } from "../src/contract";

// A CHART WITH SEVERAL SVGS IS PICTURED BY THE ONE IT STAMPS (the rotating carousel). A carousel draws its front
// face between two faces peeking at each side, one <svg> each, and the first in document order is the
// PEEK on the left: measured through chart-host in headless Chromium, the stored thumbnail was that
// peek. The fixture is the carousel's DOM - a scene div, a ring, three faces - with the front in the
// middle, which is where it sits.

const SVG_NS = "http://www.w3.org/2000/svg";

function decode(url: string): string {
    const bin = atob(url.slice(url.indexOf(",") + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

function carousel(stampFront: boolean): HTMLElement {
    const container = document.createElement("div");
    const scene = document.createElement("div");
    scene.className = "lch-carousel-scene";
    const ring = document.createElement("div");
    ring.className = "lch-carousel-ring";
    for (const [seat, name] of [["prev", "West"], ["front", "East"], ["next", "Pacific"]]) {
        const face = document.createElement("div");
        face.className = "lch-carousel-face";
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("width", seat === "front" ? "408" : "300");
        svg.setAttribute("height", "312");
        if (seat === "front" && stampFront) svg.setAttribute(SNAPSHOT_SVG_ATTR, "");
        const t = document.createElementNS(SVG_NS, "text");
        t.textContent = name;
        svg.appendChild(t);
        face.appendChild(svg);
        ring.appendChild(face);
    }
    scene.appendChild(ring);
    container.appendChild(scene);
    document.body.appendChild(container);
    return container;
}

describe("the chart's own svg", () => {
    it("is the stamped one when the chart stamps it", () => {
        expect(chartSvgOf(carousel(true))?.textContent).toBe("East");
    });

    it("is the first, as it always was, when nothing is stamped", () => {
        expect(chartSvgOf(carousel(false))?.textContent).toBe("West");
        const one = document.createElement("div");
        one.innerHTML = `<svg width="10" height="10"><text>only</text></svg>`;
        expect(chartSvgOf(one)?.textContent).toBe("only");
        expect(chartSvgOf(null)).toBeNull();
        expect(chartSvgOf(document.createElement("div"))).toBeNull();
    });

    it("is what the thumbnail captures - the front face, not the peek appended first", async () => {
        const out = await captureSvgSnapshot(carousel(true), { timeoutMs: 30 });
        expect(out).not.toBeNull();
        const svg = decode(out!);
        expect(svg).toContain(">East<");
        expect(svg).not.toContain(">West<");
    });
});
