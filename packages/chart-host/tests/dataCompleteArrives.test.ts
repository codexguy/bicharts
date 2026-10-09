// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createChartHost } from "../src/host";

// THE VALUE ARRIVES (contract 1.15.0). A knob's declaration, default and pass-through can all be tested
// and still never prove the chart SEES the value: resolveOptions is a whitelist that returns a new
// object, and a field it does not name is dropped between the host that passes it and the chart that
// reads it, with no error. So this runs the real host and reads the options inside a generated render().

const CODE = `function render(container, data, options) {
  window.__seen = {
    dataComplete: options.dataComplete, rowsWithheld: options.rowsWithheld, rowsFilteredOut: options.rowsFilteredOut,
    hasKeys: ["dataComplete", "rowsWithheld", "rowsFilteredOut"].map(k => k in options),
  };
}`;

function seenBy(options: Record<string, unknown> | undefined) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    (window as any).__seen = "unset";
    createChartHost(container, { data: { columns: [{ name: "c" }], rows: [["a", 0]] }, code: CODE, d3: {}, ...(options ? { options } : {}) }).render();
    container.remove();
    return (window as any).__seen;
}

afterEach(() => { delete (window as any).__seen; });

describe("the completeness facts reach a chart's options", () => {
    it("a cut the host reports is what the chart reads", () => {
        const seen = seenBy({ dataComplete: false, rowsWithheld: 25, rowsFilteredOut: 3 });
        expect(seen.dataComplete).toBe(false);
        expect(seen.rowsWithheld).toBe(25);
        expect(seen.rowsFilteredOut).toBe(3);
    });

    it("a whole load reads as true", () => {
        expect(seenBy({ dataComplete: true }).dataComplete).toBe(true);
    });

    it("a host that says nothing leaves them undefined for the chart: unknown is not true", () => {
        const seen = seenBy(undefined);
        expect(seen.dataComplete).toBeUndefined();
        expect(seen.rowsWithheld).toBeUndefined();
        expect(seen.rowsFilteredOut).toBeUndefined();
        expect(seen.hasKeys).toEqual([true, true, true]);
    });
});
