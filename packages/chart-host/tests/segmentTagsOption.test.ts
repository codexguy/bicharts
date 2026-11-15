import { describe, it, expect } from "vitest";
import { resolveOptions } from "../src/defaults";
import { HOST_CONTRACT_VERSION } from "../src/contract";

// A SEGMENT'S TAGS REACH THE CHART (contract 1.27.0). A page keeps campaign tags on its customer segments, keyed by the
// segment's NAME, and passes them so the chart draws the newest tag and its owner on that segment's card. resolveOptions is a
// whitelist that returns a NEW object, and segmentTags was not on it: the chart's read always took its empty fallback and no
// tag ever reached a card. It is cleaned, never invented: a name maps to a list of { tag, owner?, at? } with a non-empty tag.

describe("resolveOptions delivers segmentTags", () => {
    it("is a field resolveOptions returns, absent when the page sends none", () => {
        const o = resolveOptions({});
        expect("segmentTags" in o).toBe(true);
        expect(o.segmentTags).toBeUndefined();
        expect(HOST_CONTRACT_VERSION).toBe("1.27.0");
    });

    it("passes a page's tags through, keyed by segment name", () => {
        const tags = { "Best customers": [{ tag: "Spring push", owner: "Ana", at: "2025-12-01T10:00:00Z" }], "Lapsed": [{ tag: "Win-back" }] };
        expect(resolveOptions({ segmentTags: tags } as any).segmentTags).toEqual(tags);
    });

    it("cleans what it cannot trust: no tag text, the wrong types, a poisoned key", () => {
        const junk: any = {
            "Best customers": [{ tag: "" }, { tag: 7 }, null, "x", { tag: "Kept", owner: 3, at: {} }],
            "Lapsed": "not a list",
            "__proto__": [{ tag: "evil" }],
        };
        expect(resolveOptions({ segmentTags: junk } as any).segmentTags).toEqual({ "Best customers": [{ tag: "Kept" }] });
        expect(resolveOptions({ segmentTags: [] } as any).segmentTags).toBeUndefined();
        expect(resolveOptions({ segmentTags: "x" } as any).segmentTags).toBeUndefined();
        expect(resolveOptions({ segmentTags: { A: [{ tag: "" }] } } as any).segmentTags).toBeUndefined();
    });
});
