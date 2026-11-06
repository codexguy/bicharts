import { describe, it, expect } from "vitest";
import { resolveOptions } from "../src/defaults";
import {
    SELECTION_OUTLINE_CLASS, selectionMarkerFor, readSelectionMarker, readMapSelectionMarker, isRegionMapData,
    SELECTION_MARKER_DEFAULT, MAP_SELECTION_MARKER_DEFAULT, REGION_JOIN_COLUMN, hasNeutralCentreRamp, isAreaMark, controlBoxesIn,
} from "../src/selectionMarker";
import { JSDOM } from "jsdom";

// THE SELECTION MARKER'S CHOICE, AND THE TWO TRAITS IT IS DECIDED ON. The host behaviour is in selectionOutline.test.ts.

function data(region: boolean) {
    return { columns: [{ name: "Country" }, { name: "Attainment" }, { name: "__rowIdx__" }, { name: region ? "__geoIso__" : "__geoLat__" }], rows: [] };
}

describe("the choice, resolved", () => {
    it("the general choice: auto by default; none, dot, check and outline as chosen; anything else is the default", () => {
        expect(SELECTION_MARKER_DEFAULT).toBe("auto");
        expect(resolveOptions({}).selectionMarker).toBe("auto");
        for (const v of ["none", "dot", "check", "outline", "auto"]) expect(resolveOptions({ selectionGlyph: v }).selectionMarker).toBe(v);
        for (const v of ["sparkle", "", 1, true, null, undefined]) expect(readSelectionMarker(v), String(v)).toBe("auto");
        expect(resolveOptions({ selectionGlyph: "OUTLINE" }).selectionGlyph).toBe("outline");
    });

    it("the map choice: outline by default; none, dot and check as chosen; auto and anything else is the default", () => {
        expect(MAP_SELECTION_MARKER_DEFAULT).toBe("outline");
        expect(resolveOptions({}).mapSelectionMarker).toBe("outline");
        expect(resolveOptions({}).mapSelectionGlyph).toBeUndefined();
        for (const v of ["none", "dot", "check", "outline"]) expect(resolveOptions({ mapSelectionGlyph: v }).mapSelectionMarker).toBe(v);
        for (const v of ["auto", "sparkle", "", 1, null]) expect(readMapSelectionMarker(v), String(v)).toBe("outline");
    });

    it("which marker a chart gets", () => {
        const f = (choice: unknown, mapChoice: unknown, regionMap: boolean, neutralCentreRamp: boolean) =>
            selectionMarkerFor({ choice, mapChoice, regionMap, neutralCentreRamp });
        expect(f(undefined, undefined, true, false)).toBe("outline");
        expect(f(undefined, undefined, true, true)).toBe("outline");
        expect(f("none", undefined, true, false)).toBe("outline");
        expect(f(undefined, "none", true, true)).toBe("none");
        expect(f(undefined, undefined, false, false)).toBe("none");
        expect(f(undefined, undefined, false, true)).toBe("outline");
        expect(f("none", undefined, false, true)).toBe("none");
        expect(f("dot", "none", false, true)).toBe("dot");
    });

    it("a region map is a chart whose rows carry the region join column, and nothing else is", () => {
        expect(isRegionMapData(data(true))).toBe(true);
        expect(isRegionMapData(data(false))).toBe(false);
        expect(isRegionMapData({ columns: [] })).toBe(false);
        expect(isRegionMapData(null)).toBe(false);
        expect(isRegionMapData({ columns: [null, { name: 3 }] } as any)).toBe(false);
    });
});

describe("the traits", () => {
    const doc = new JSDOM("<!doctype html><html><body></body></html>").window.document;
    const NS = "http://www.w3.org/2000/svg";
    const el = (tag: string, attrs: Record<string, string> = {}) => {
        const e = doc.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
        return e;
    };

    it("the region join column is the host's own", () => {
        expect(REGION_JOIN_COLUMN).toBe("__geoIso__");
        expect(SELECTION_OUTLINE_CLASS).toBe("lch-sel-outline");
    });

    it("a neutral-centre ramp is the diverging legend the shared value ramp declares, and no other", () => {
        const host = doc.createElement("div");
        expect(hasNeutralCentreRamp(host)).toBe(false);
        host.appendChild(el("g", { class: "llm-value-ramp", "data-kind": "linear" }));
        expect(hasNeutralCentreRamp(host)).toBe(false);
        host.appendChild(el("g", { class: "llm-value-ramp", "data-kind": "diverging" }));
        expect(hasNeutralCentreRamp(host)).toBe(true);
        expect(hasNeutralCentreRamp(null)).toBe(false);
    });

    it("an area mark is a filled path, rect or polygon; a line, a point and a group are not", () => {
        expect(isAreaMark(el("path", { d: "M0,0h1v1Z", fill: "#abc" }))).toBe(true);
        expect(isAreaMark(el("path", { d: "M0,0h1v1Z" }))).toBe(true);
        expect(isAreaMark(el("rect", { fill: "red" }))).toBe(true);
        expect(isAreaMark(el("polygon", { points: "0,0 1,0 1,1" }))).toBe(true);
        expect(isAreaMark(el("path", { d: "M0,0l1,1", fill: "none" }))).toBe(false);
        expect(isAreaMark(el("path", { d: "M0,0l1,1", fill: "transparent" }))).toBe(false);
        expect(isAreaMark(el("rect", { fill: "#abc", "fill-opacity": "0" }))).toBe(false);
        expect(isAreaMark(el("circle", { r: "3" }))).toBe(false);
        expect(isAreaMark(el("ellipse", { rx: "3" }))).toBe(false);
        expect(isAreaMark(el("g"))).toBe(false);
    });

    it("the chart's own controls are the elements it declares controls: a pad of buttons is one box, a far control its own", () => {
        const host = doc.createElement("div");
        const ctl = (x: number, y: number, w = 18, h = 18, cls = "llm-zoom-btn lch-control") => {
            const e = el("g", { class: cls });
            (e as any).getBoundingClientRect = () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y });
            host.appendChild(e);
        };
        expect(controlBoxesIn(host)).toEqual([]);
        ctl(100, 10); ctl(121, 10); ctl(100, 31);           // a pad: 3 px gaps
        ctl(400, 300);                                      // a flip arrow far away
        ctl(10, 10, 0, 0);                                  // not drawn: no box
        ctl(200, 200, 18, 18, "llm-zoom-btn");              // not declared a control: not avoided
        expect(controlBoxesIn(host)).toEqual([
            { left: 98, top: 8, right: 141, bottom: 51 },
            { left: 398, top: 298, right: 420, bottom: 320 },
        ]);
        expect(controlBoxesIn(null)).toEqual([]);
    });
});
