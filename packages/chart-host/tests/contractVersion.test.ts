// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createChartHost } from "../src/host";
import { HOST_CONTRACT_VERSION } from "../src/contract";

// A generated chart is COMMITTED SOURCE — it outlives the tool that wrote it, so the host
// running it can be a different version of the grammar entirely. The MCP now stamps the
// contract version into data.sample.json; this is the half that makes the stamp useful.
// Without it, a renamed mark class fails as "nothing is clickable", which nobody traces
// back to a version number.

const CODE = `function render(container, data, options) {
  const m = container.ownerDocument.createElement("div");
  m.className = "d3-mark"; m.setAttribute("data-row-idx", "0");
  container.appendChild(m);
}`;

const bump = (v: string, by: number) => {
    const p = v.split(".");
    return [String(Number(p[0]) + by), p[1], p[2]].join(".");
};

describe("host contract version stamp", () => {
    let container: HTMLElement;
    let warn: any;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => { warn.mockRestore(); container.remove(); });

    const mount = (meta?: { hostContract?: string }) =>
        createChartHost(container, {
            data: { columns: [{ name: "c" }], rows: [["a", 0]], ...(meta ? { meta } : {}) },
            code: CODE, d3: {},
        }).render();

    it("warns on a MAJOR mismatch, naming both versions", () => {
        const other = bump(HOST_CONTRACT_VERSION, 1);   // a host older than the artifact
        mount({ hostContract: other });
        expect(warn).toHaveBeenCalledTimes(1);
        const msg = String(warn.mock.calls[0][0]);
        expect(msg).toContain(other);
        expect(msg).toContain(HOST_CONTRACT_VERSION);
        expect(msg).toMatch(/regenerate/i);          // must say what to DO about it
    });

    it("stays silent on a matching major (minor/patch drift is compatible)", () => {
        const p = HOST_CONTRACT_VERSION.split(".");
        mount({ hostContract: [p[0], String(Number(p[1]) + 3), "7"].join(".") });
        expect(warn).not.toHaveBeenCalled();
    });

    it("stays silent when the payload carries no stamp at all", () => {
        // Hand-built payloads and every artifact generated before the stamp existed must
        // keep working without a scary warning — absence is not a mismatch.
        mount();
        expect(warn).not.toHaveBeenCalled();
    });

    it("still renders the chart when the version disagrees", () => {
        // The check is ADVISORY. A loud warning that also breaks the page would be worse
        // than the silent drift it replaces.
        mount({ hostContract: bump(HOST_CONTRACT_VERSION, 1) });
        expect(container.querySelectorAll(".d3-mark")).toHaveLength(1);
    });
});
