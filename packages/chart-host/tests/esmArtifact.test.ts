// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { compileRenderFn, stripEsmExports } from "../src/host";

// THE TRAP THIS CLOSES (2026-08-01, found building a React dashboard against the MCP):
// a chart can be delivered in two forms — the bare render() function, or the SAME code
// plus an ES-module export clause so it can be `import`ed from a file. Both are honest
// artifacts of one generator. Handing the module form to the code-string path threw a
// SyntaxError inside `new Function` before a line of chart code ran: blank page, no mark,
// no annotation, and a message ("Unexpected token 'export'") that names a token rather
// than the artifact form. Nothing in either form told the caller which host accepted it.
//
// The fix is that BOTH forms are accepted, so the two seams cannot disagree — which means
// these tests are the contract, not a regression net.

const BODY = `
function render(container, data, options) {
  const doc = container.ownerDocument;
  const el = doc.createElement("div");
  el.className = "d3-mark";
  el.setAttribute("data-row-idx", "0");
  el.textContent = String((data && data.rows && data.rows.length) || 0);
  container.appendChild(el);
}
`;

function runsAndDraws(code: string) {
    const fn = compileRenderFn(code, globalThis as any, document, {});
    const host = document.createElement("div");
    fn(host, { columns: [], rows: [[1]] } as any, {} as any);
    return host.querySelectorAll("[data-row-idx]").length;
}

describe("the module-form artifact renders identically to the plain form", () => {
    it("plain render() — the baseline", () => {
        expect(runsAndDraws(BODY)).toBe(1);
    });

    it("`export { render };` — what the generator emits for module consumers", () => {
        expect(runsAndDraws(BODY + "\nexport { render };\n")).toBe(1);
    });

    it("`export { render as default };` and `export default render;`", () => {
        expect(runsAndDraws(BODY + "\nexport { render as default };\n")).toBe(1);
        expect(runsAndDraws(BODY + "\nexport default render;\n")).toBe(1);
    });

    it("`export function render(...)` keeps the declaration, loses only the keyword", () => {
        expect(runsAndDraws(BODY.replace("function render", "export function render"))).toBe(1);
    });
});

describe("stripEsmExports is narrow on purpose", () => {
    it("leaves the word alone inside strings, comments and property names", () => {
        const code = [
            `const msg = "export { render };";`,
            `// export { render };`,
            `const o = { export: 1 };`,
            `const s = 'export default x';`,
        ].join("\n");
        expect(stripEsmExports(code)).toBe(code);
    });

    it("removes only the clause, never a line of behaviour", () => {
        const out = stripEsmExports("const a = 1;\nexport { a };\nconst b = 2;\n");
        expect(out).toContain("const a = 1;");
        expect(out).toContain("const b = 2;");
        expect(out).not.toMatch(/^\s*export\s*\{/m);
    });

    it("keeps the binding when the export is on a declaration", () => {
        expect(stripEsmExports("export const render = () => {};")).toBe("const render = () => {};");
        expect(stripEsmExports("  export class Foo {}")).toBe("  class Foo {}");
        expect(stripEsmExports("export async function f() {}")).toBe("async function f() {}");
    });
});

describe("what compile CANNOT accept, it says plainly", () => {
    it("an `import` names the artifact form instead of the token", () => {
        // A code string genuinely cannot resolve module imports. The old failure was a
        // bare "Unexpected token" with a blank chart behind it; the message must instead
        // say what was handed in and what to do about it.
        let err: any = null;
        try {
            compileRenderFn(`import * as d3 from "d3";\n` + BODY, globalThis as any, document, {});
        } catch (e) { err = e; }
        expect(err).toBeTruthy();
        expect(String(err.message)).toMatch(/could not be COMPILED/);
        expect(String(err.message)).toMatch(/ES-module syntax/);
        expect(String(err.message)).toMatch(/import/);
    });

    it("code that defines no render() is still the other, distinct failure", () => {
        expect(() => compileRenderFn("const x = 1;", globalThis as any, document, {}))
            .toThrow(/did not define render/);
    });
});
