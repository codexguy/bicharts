// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { buildRenderPayload, createChartGroup, createChartHost, type ChartGroup } from "../src/index";

// THE PAYLOAD OWNS ITS HOST COLUMNS (2026-09-25).
//
// `__rowIdx__` is the row's POSITION in the payload - the index a mark's data-row-idx carries back on a
// click. Rows built from a data.sample.json already carry one (the positions of the sample's own rows),
// and the builder appended its own beside it: two columns of one name, and generated code resolves
// `columns.findIndex(c => c.name === "__rowIdx__")`, which finds the FIRST - the stale one. In an
// unfiltered chart the two agree, so nothing showed; once a group member is filtered to a subset, its
// marks carried the sample's positions, and a click translated through the member's row map to the wrong
// source row, or to none.
//
// The builder now drops an incoming column that carries the name of a host column it appends, so the
// payload has one of each and the host's is the one read. `__geo*` columns the builder does NOT append
// this time (no binding) are the caller's to keep.

const SAMPLE_COLUMNS = [
    { name: "name", dataType: "String", isMeasure: false },
    { name: "v", dataType: "Int64", isMeasure: true },
    { name: "__rowIdx__", dataType: "Integer", isMeasure: false },
];
// As data.sample.json rows arrive: each already carries its own position in the sample.
const SAMPLE_ROWS = ["r0", "r1", "r2", "r3", "r4"].map((name, i) => ({ name, v: i * 10, __rowIdx__: i }));

const at = (payload: { columns: any[] }, name: string) => payload.columns.findIndex(c => c.name === name);
const count = (payload: { columns: any[] }, name: string) => payload.columns.filter(c => c.name === name).length;

describe("buildRenderPayload owns __rowIdx__", () => {
    it("THE CASE: an incoming __rowIdx__ is dropped - one column, holding the payload's own positions", () => {
        const subset = [SAMPLE_ROWS[4], SAMPLE_ROWS[1]];   // a filtered member's rows
        const p = buildRenderPayload(SAMPLE_COLUMNS, subset);
        expect(count(p, "__rowIdx__")).toBe(1);
        expect(p.rows.map(r => r[at(p, "__rowIdx__")])).toEqual([0, 1]);
        expect(p.columns.map(c => c.name)).toEqual(["name", "v", "__rowIdx__"]);
        expect(p.rows).toEqual([["r4", 40, 0], ["r1", 10, 1]]);
    });

    it("without an incoming one the payload is exactly what it always was", () => {
        const p = buildRenderPayload(SAMPLE_COLUMNS.slice(0, 2), [{ name: "r0", v: 0 }, { name: "r1", v: 10 }]);
        expect(p.columns.map(c => c.name)).toEqual(["name", "v", "__rowIdx__"]);
        expect(p.rows).toEqual([["r0", 0, 0], ["r1", 10, 1]]);
    });

    it("a __geoIso__ the builder computes replaces an incoming one; with no binding the caller's stays", () => {
        const cols = [{ name: "Country", dataType: "String", isMeasure: false }, { name: "__geoIso__", dataType: "String", isMeasure: false }];
        const rows = [{ Country: "France", __geoIso__: "stale" }, { Country: "Japan", __geoIso__: "stale" }];
        const bound = buildRenderPayload(cols, rows, { column: "Country", kind: "country-name" });
        expect(count(bound, "__geoIso__")).toBe(1);
        expect(bound.rows.map(r => r[at(bound, "__geoIso__")])).toEqual(["FRA", "JPN"]);
        const unbound = buildRenderPayload(cols, rows);
        expect(count(unbound, "__geoIso__")).toBe(1);
        expect(unbound.rows.map(r => r[at(unbound, "__geoIso__")])).toEqual(["stale", "stale"]);
    });
});

// A chart that reads the row index from the DATA, as generated code does.
const READS_ROWIDX = `
function render(container, data, options) {
  container.innerHTML = "";
  const doc = container.ownerDocument;
  const nameAt = data.columns.findIndex(c => c.name === "name");
  const idxAt = data.columns.findIndex(c => c.name === "__rowIdx__");
  for (const row of data.rows) {
    const m = doc.createElement("div");
    m.className = "d3-mark";
    m.setAttribute("data-row-idx", String(row[idxAt]));
    m.setAttribute("data-name", String(row[nameAt]));
    container.appendChild(m);
  }
}`;

describe("a group built from data.sample.json rows", () => {
    let group: ChartGroup;
    const els: HTMLElement[] = [];
    afterEach(() => { group?.destroy(); els.splice(0).forEach(e => e.remove()); });

    it("THE CASE: a click in a FILTERED member reaches the source row it drew", () => {
        group = createChartGroup(SAMPLE_COLUMNS, SAMPLE_ROWS);
        const member = (id: string, onSelect?: (r: number[]) => void) => {
            const el = document.createElement("div");
            document.body.appendChild(el);
            els.push(el);
            const host = createChartHost(el, { code: READS_ROWIDX, d3: {}, data: group.memberPayload(id).payload, labelContrast: false });
            host.render();
            group.attach(id, host, { onSelect });
            return el;
        };
        const click = (el: HTMLElement, name: string, mod?: "ctrlKey") =>
            (el.querySelector(`.d3-mark[data-name="${name}"]`) as HTMLElement)
                .dispatchEvent(new MouseEvent("click", { bubbles: true, ...(mod ? { [mod]: true } : {}) } as any));
        const seenB: number[][] = [];
        const a = member("a");
        const b = member("b", r => seenB.push(r));
        click(a, "r3");
        click(a, "r4", "ctrlKey");
        // b now draws r3 and r4 only; its second mark is r4, source row 4.
        expect(Array.from(b.querySelectorAll(".d3-mark")).map(m => m.getAttribute("data-name"))).toEqual(["r3", "r4"]);
        click(b, "r4");
        expect(seenB.at(-1)).toEqual([4]);
    });
});
