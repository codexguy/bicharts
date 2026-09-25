import { describe, it, expect } from "vitest";
import {
    isPickableModelCode, markDefaultModel, defaultModelFirst, reconcileModelPick, DEFAULT_MODEL_SUFFIX,
} from "../src/index";

describe("the model picker's shared rules", () => {
    it("a bring-your-own-key code, or an empty one, is never offered in the open list", () => {
        expect(isPickableModelCode("GPT4OMINI")).toBe(true);
        for (const c of ["BYOANTH", "BYOOPENAI", "", null, undefined]) expect(isPickableModelCode(c), String(c)).toBe(false);
    });

    it("the default model is marked after the rest of its label; nothing else is", () => {
        expect(DEFAULT_MODEL_SUFFIX).toBe(" — default");
        expect(markDefaultModel("Claude Sonnet (x 1.5)", "SONNET", "SONNET")).toBe("Claude Sonnet (x 1.5) — default");
        expect(markDefaultModel("GPT mini (x 1.0)", "MINI", "SONNET")).toBe("GPT mini (x 1.0)");
        expect(markDefaultModel("GPT mini", "MINI", "")).toBe("GPT mini");
        expect(markDefaultModel("GPT mini", "MINI", null)).toBe("GPT mini");
    });

    it("the default sorts first and every other row keeps its order", () => {
        const rows = [{ value: "A" }, { value: "B" }, { value: "C" }, { value: "D" }];
        expect(defaultModelFirst(rows, "C").map(r => r.value)).toEqual(["C", "A", "B", "D"]);
        expect(defaultModelFirst(rows, "A").map(r => r.value)).toEqual(["A", "B", "C", "D"]);
        expect(defaultModelFirst(rows, "").map(r => r.value)).toEqual(["A", "B", "C", "D"]);
        expect(defaultModelFirst(rows, "Z").map(r => r.value)).toEqual(["A", "B", "C", "D"]);
        expect(defaultModelFirst(rows, "C")).not.toBe(rows);   // a copy; the host's list is untouched
    });

    it("a saved pick still offered stands", () => {
        expect(reconcileModelPick("B", ["A", "B", "C"], "A")).toBe("B");
        expect(reconcileModelPick("", ["", "A", "B"], "")).toBe("");
    });

    it("a stale pick falls back to the default, never to nothing", () => {
        expect(reconcileModelPick("GONE", ["C", "A", "B"], "C")).toBe("C");
        // a host whose default is its own "service default" row (value "")
        expect(reconcileModelPick("GONE", ["", "A", "B"], "")).toBe("");
        expect(reconcileModelPick(null, ["", "A"], "")).toBe("");
    });

    it("with no default offered, the first row; with an empty list, nothing", () => {
        expect(reconcileModelPick("GONE", ["A", "B"], "C")).toBe("A");
        expect(reconcileModelPick("GONE", ["A", "B"], "")).toBe("A");
        expect(reconcileModelPick("GONE", [], "C")).toBe("");
    });
});
