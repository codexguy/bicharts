import { describe, it, expect } from "vitest";
import {
    findZoomedNodes,
    isIdentity,
    isUsableTransform,
    isZoomStateUsable,
    parseZoomState,
    readNodeTransform,
    serializeZoomState,
    soleZoomedNode,
    transformsDiffer,
    viewportBucket,
    zoomStateKey
} from "../../src/zoomMemory/zoomMemory";

// REMEMBER ZOOM/PAN, the pure half. A remembered transform can arrive from a saved file, so every one of
// these is a hostile-input test, not a formatting test: the blob can be hand-edited, can predate the
// current chart, and can describe a viewport that no longer exists. The cost of getting it wrong is a map
// parked on empty ocean, which is an empty chart wearing a different hat.

describe("transform validation", () => {
    it("accepts an ordinary zoomed-in view", () => {
        expect(isUsableTransform({ k: 3.5, x: -120, y: -80 })).toBe(true);
    });

    it("rejects anything that is not three real numbers", () => {
        for (const bad of [
            null, undefined, "3", 3, [], {},
            { k: 1, x: 0 },                       // missing y
            { k: NaN, x: 0, y: 0 },
            { k: 1, x: Infinity, y: 0 },
            { k: 1, x: 0, y: -Infinity },
            { k: "2", x: 0, y: 0 }
        ]) {
            expect(isUsableTransform(bad), JSON.stringify(bad)).toBe(false);
        }
    });

    it("rejects a scale that would invert or collapse the chart", () => {
        // k <= 0 mirrors or annihilates the drawing. No gesture produces it, so its only source is
        // corruption or a hand-edit.
        expect(isUsableTransform({ k: 0, x: 0, y: 0 })).toBe(false);
        expect(isUsableTransform({ k: -2, x: 0, y: 0 })).toBe(false);
    });

    it("rejects absurd magnitudes that no gesture could reach", () => {
        expect(isUsableTransform({ k: 1e9, x: 0, y: 0 })).toBe(false);
        expect(isUsableTransform({ k: 1, x: 1e12, y: 0 })).toBe(false);
    });
});

describe("identity", () => {
    it("recognizes the state a freshly rendered chart is already in", () => {
        expect(isIdentity({ k: 1, x: 0, y: 0 })).toBe(true);
        expect(isIdentity({ k: 1.0001, x: 0, y: 0 })).toBe(false);
        expect(isIdentity({ k: 1, x: 4, y: 0 })).toBe(false);
    });
});

describe("change detection", () => {
    it("treats sub-pixel drift as no change", () => {
        // Without this a restore looks like a reader's edit and writes straight back to the store: a
        // persist loop driven by nothing but floating point.
        expect(transformsDiffer({ k: 2, x: 10, y: 10 }, { k: 2, x: 10.2, y: 9.8 })).toBe(false);
    });

    it("notices a real pan or zoom", () => {
        expect(transformsDiffer({ k: 2, x: 10, y: 10 }, { k: 2, x: 40, y: 10 })).toBe(true);
        expect(transformsDiffer({ k: 2, x: 10, y: 10 }, { k: 2.5, x: 10, y: 10 })).toBe(true);
    });

    it("handles a missing side without pretending they match", () => {
        expect(transformsDiffer(null, { k: 2, x: 0, y: 0 })).toBe(true);
        expect(transformsDiffer(null, null)).toBe(false);
    });
});

describe("viewport bucketing", () => {
    it("ignores reflow jitter but not a real resize", () => {
        // A 2px difference is a host settling; 200px is the reader resizing the chart.
        expect(viewportBucket(800)).toBe(viewportBucket(802));
        expect(viewportBucket(800)).not.toBe(viewportBucket(1000));
    });

    it("survives a nonsense dimension without throwing", () => {
        expect(viewportBucket(0)).toBe(0);
        expect(viewportBucket(-5)).toBe(0);
        expect(viewportBucket(NaN)).toBe(0);
    });
});

describe("round trip", () => {
    it("preserves a transform to screen precision", () => {
        const key = zoomStateKey("abc123", 800, 600);
        const restored = parseZoomState(serializeZoomState({ k: 2.5, x: -140.25, y: 33.5 }, key));
        expect(restored).toEqual({ k: 2.5, x: -140.25, y: 33.5, key });
    });

    it("treats an unparseable or incomplete blob as simply absent", () => {
        // Same outcome as never having saved one: open at full extent. Never throw - this runs on the
        // render path.
        for (const bad of ["", null, undefined, "{", "null", "[]", '{"k":1,"x":0}', '{"k":1,"x":0,"y":0}']) {
            expect(parseZoomState(bad as any), String(bad)).toBeNull();
        }
    });

    it("refuses a blob with no key, because an unkeyed transform cannot be validated", () => {
        expect(parseZoomState('{"k":2,"x":1,"y":1,"key":""}')).toBeNull();
    });
});

describe("staleness", () => {
    const key = zoomStateKey("code-v1", 800, 600);
    const state = { k: 2, x: -50, y: -20, key };

    it("restores when the chart and viewport are the ones it was captured on", () => {
        expect(isZoomStateUsable(state, key)).toBe(true);
    });

    it("drops a transform captured against a DIFFERENT generation", () => {
        // The code hash changes on regeneration, and the new chart may be a different type entirely -
        // the old transform describes a frame that no longer exists.
        expect(isZoomStateUsable(state, zoomStateKey("code-v2", 800, 600))).toBe(false);
    });

    it("drops a transform captured at a substantially different size", () => {
        expect(isZoomStateUsable(state, zoomStateKey("code-v1", 1400, 600))).toBe(false);
    });

    it("keeps it across trivial resize jitter", () => {
        expect(isZoomStateUsable(state, zoomStateKey("code-v1", 802, 599))).toBe(true);
    });

    it("never restores from nothing", () => {
        expect(isZoomStateUsable(null, key)).toBe(false);
        expect(isZoomStateUsable(state, "")).toBe(false);
    });
});

// --- DOM discovery -------------------------------------------------------------------
//
// The whole approach rests on one fact: d3-zoom stores its transform on the node as `__zoom` (the
// documented storage `d3.zoomTransform` reads). These tests pin that it is found the way d3 would find
// it, and that the ambiguous cases are DECLINED.

function el(tag = "div"): any {
    const node: any = {
        tagName: tag.toUpperCase(),
        children: [] as any[],
        querySelectorAll(_sel: string) { return collectAll(node); }
    };
    return node;
}

function collectAll(root: any): any[] {
    const out: any[] = [];
    const walk = (n: any) => { for (const c of n.children) { out.push(c); walk(c); } };
    walk(root);
    return out;
}

describe("finding the zoomed node", () => {
    it("reads the transform d3 stored on the node", () => {
        const node = el();
        node.__zoom = { k: 4, x: -10, y: -20 };
        expect(readNodeTransform(node)).toEqual({ k: 4, x: -10, y: -20 });
    });

    it("returns null for a node d3-zoom never touched", () => {
        expect(readNodeTransform(el())).toBeNull();
        expect(readNodeTransform(null)).toBeNull();
    });

    it("rejects a corrupt stored transform rather than applying it", () => {
        const node = el();
        node.__zoom = { k: NaN, x: 0, y: 0 };
        expect(readNodeTransform(node)).toBeNull();
    });

    it("finds a zoomed descendant", () => {
        const root = el();
        const svg = el("svg");
        const rect = el("rect");
        rect.__zoom = { k: 2, x: 0, y: 0 };
        svg.children.push(rect);
        root.children.push(svg);
        expect(findZoomedNodes(root)).toEqual([rect]);
        expect(soleZoomedNode(root)).toBe(rect);
    });

    it("finds the root itself when the zoom is attached there", () => {
        const root = el();
        root.__zoom = { k: 2, x: 0, y: 0 };
        expect(soleZoomedNode(root)).toBe(root);
    });

    it("DECLINES when several nodes are independently zoomable", () => {
        // A composite chart with several zoom panels. There is no stable identity to pair saved
        // transforms back to the right panel across a re-render, and restoring them to the WRONG panels
        // is worse than not restoring at all.
        const root = el();
        const a = el(); a.__zoom = { k: 2, x: 0, y: 0 };
        const b = el(); b.__zoom = { k: 3, x: 0, y: 0 };
        root.children.push(a, b);
        expect(findZoomedNodes(root).length).toBe(2);
        expect(soleZoomedNode(root)).toBeNull();
    });

    it("declines an empty container without throwing", () => {
        expect(soleZoomedNode(el())).toBeNull();
        expect(findZoomedNodes(null)).toEqual([]);
    });
});
