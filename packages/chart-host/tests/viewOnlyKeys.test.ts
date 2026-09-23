import { describe, it, expect } from "vitest";
import { VIEW_ONLY_UI_STATE_KEYS, withoutViewOnlyKeys, HOST_CONTRACT_VERSION } from "../src/index";

// VIEW-ONLY KEYS (contract 1.11.0): how the reader is LOOKING at a chart, as opposed to a setting of
// the chart. A host whose durable store sits behind a "remember my view" switch drops exactly these
// when the switch is off. One list, so every host drops the same keys.
describe("view-only view-state keys", () => {
    it("names the 3D camera and the Mermaid diagram's zoom", () => {
        expect([...VIEW_ONLY_UI_STATE_KEYS].sort()).toEqual(["camera", "llmZoom"]);
        expect(Object.isFrozen(VIEW_ONLY_UI_STATE_KEYS)).toBe(true);
    });

    it("removes only the view keys and keeps every setting of the chart", () => {
        const bag = { camera: { eye: 1 }, llmZoom: { v: 1, k: 0.5 }, focusPath: ["A"], segments: "x" };
        expect(withoutViewOnlyKeys(bag)).toEqual({ focusPath: ["A"], segments: "x" });
        expect(bag.camera).toBeDefined();          // the caller's bag is not mutated
    });

    it("returns the same object when there is nothing to remove", () => {
        const bag = { focusPath: ["A"] };
        expect(withoutViewOnlyKeys(bag)).toBe(bag);
    });

    it("is part of the contract version that announces it", () => {
        const [maj, min] = HOST_CONTRACT_VERSION.split(".").map(Number);
        expect(maj > 1 || (maj === 1 && min >= 11)).toBe(true);
    });
});
