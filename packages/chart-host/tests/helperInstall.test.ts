// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { compileRenderFn } from "../src/host";

// THE TRAP THIS CLOSES (2026-08-14, found rendering a beeswarm in an Excel add-in):
// a generated chart INSTALLS the shared helpers it calls. The generator prepends the source of
// any `d3.llmX` helper the code uses but does not define, so the artifact self-installs it onto
// whatever d3 the host passes and needs no client asset.
//
// `import * as d3 from "d3"` yields an ES module namespace object, which is NON-EXTENSIBLE. The
// compile is `new Function` — sloppy mode — where adding a property to a non-extensible object
// does NOT throw. The install evaporated in silence and the chart died on the very next call
// with `d3.llmTooltip is not a function`: an error that names the helper and says nothing about
// the one word in the caller's import statement that actually caused it. A host that reaches d3
// through a script tag never reproduces it, which is how it survived verification for months.
//
// This package deliberately has no d3 dependency — d3 is injected by the host — so the namespace
// is modelled with preventExtensions, which is the property that matters and the only one the
// fix turns on. The reproduction against the real `import * as d3` lives in the consumer that
// hit it, where d3 is actually installed.

function namespaceLike(): any {
    return Object.preventExtensions({ select: () => null, scaleLinear: () => null });
}

const HELPER_CHART = `
function render(container, data, options) {
  d3.llmTooltip = function (el) { return { note: "installed on " + el }; };
  const doc = container.ownerDocument;
  const el = doc.createElement("div");
  el.className = "d3-mark";
  el.textContent = d3.llmTooltip("container").note;
  container.appendChild(el);
}
`;

function draw(d3: any): string {
    const container = document.createElement("div");
    document.body.appendChild(container);
    compileRenderFn(HELPER_CHART, window, document, d3)(container, { columns: [], rows: [] } as any, {} as any);
    return container.querySelector(".d3-mark")?.textContent ?? "";
}

describe("a generated chart can install its own helpers", () => {
    it("proves the premise: sloppy mode swallows the failed install", () => {
        // Not a test of our code — a test that the hazard is real, so that if an engine ever
        // starts throwing here the comment above stops being the explanation.
        const install = new Function("d3", "d3.llmTooltip = function () {}; return typeof d3.llmTooltip;");
        expect(install(namespaceLike())).toBe("undefined");
    });

    it("installs and calls a helper when handed a namespace-like d3", () => {
        expect(draw(namespaceLike())).toBe("installed on container");
    });

    it("installs and calls a helper when handed an ordinary global d3", () => {
        expect(draw({ select: () => null })).toBe("installed on container");
    });

    it("leaves the caller's d3 alone", () => {
        const d3 = namespaceLike();
        draw(d3);
        expect(d3.llmTooltip).toBeUndefined();
    });

    it("plugins attached after the host was built are still visible", () => {
        // The counterpart risk: copying unconditionally would freeze a snapshot and lose an
        // `Object.assign(d3, { sankey })` that lands later — which is exactly the remedy this
        // package prints when a plugin is missing.
        const d3: any = { select: () => null };
        const code = `function render(c, d, o) {
            const el = c.ownerDocument.createElement("div");
            el.className = "d3-mark"; el.textContent = d3.sankey(); c.appendChild(el); }`;
        const container = document.createElement("div");
        const fn = compileRenderFn(code, window, document, d3);
        d3.sankey = () => "late plugin";
        fn(container, { columns: [], rows: [] } as any, {} as any);
        expect(container.querySelector(".d3-mark")?.textContent).toBe("late plugin");
    });

    it("a non-object d3 is passed through untouched, so the existing diagnostics still fire", () => {
        // explainRenderFailure's "no d3 was provided" branch depends on null staying null.
        const code = `function render(c, d, o) {
            const el = c.ownerDocument.createElement("div");
            el.className = "d3-mark"; el.textContent = String(d3); c.appendChild(el); }`;
        const container = document.createElement("div");
        compileRenderFn(code, window, document, null)(container, { columns: [], rows: [] } as any, {} as any);
        expect(container.querySelector(".d3-mark")?.textContent).toBe("null");
    });
});
