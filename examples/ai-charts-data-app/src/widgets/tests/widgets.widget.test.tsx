// EVERY PREBUILT WIDGET, TESTED ON ITS OWN, in real headless Chromium (npm run test:widgets), with no network:
//   (a) it draws on the shipped field map, from the bundled sample rows;
//   (b) it draws after a rebind: the query names every result column after its role on a renamed model, and the
//       widget draws rows with new values, three times as many, and labels over 60 characters;
//   (c) a role left out of the map shows "Map a field to <Role> in src/fieldMap.ts" in its panel;
//   (d) a mini-app's controls change what it draws, before and after the rebind;
//   (e) a click on one of its marks reaches the page filter it sets.

import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Controls, Filter } from "@bicharts/chart-host";
import { useBicControls, useBicFilter } from "@bicharts/chart-host/react";
import "@/global.css";
import { WidgetCard } from "@/components/widget-card";
import { VegaRankingCard } from "@/components/vega-ranking-card";
import { VEGA_RANKING, vegaToFilter } from "@/components/vega-ranking";
import { ThemeContext } from "@/hooks/theme.context";
import { fieldMap, type FieldMap } from "@/fieldMap";
import { sampleTable } from "@/sample/sample-model";
import { buildDax, rolesOf } from "@/widgets/query";
import { filterKeys, WIDGETS, type Widget } from "@/widgets/registry";
import { activeFilters } from "@/widgets/use-widget-data";
import { renamedMap, swapTable } from "./swap";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEYS = filterKeys();
const WIDTH = 900;
const HEIGHT = 560;

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
});

async function mount(node: ReactNode): Promise<HTMLElement> {
    host = document.createElement("div");
    host.style.width = `${WIDTH}px`;
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(
        <ThemeContext.Provider value={{ isDark: false, toggleTheme: () => {}, theme: {} as never }}>{node}</ThemeContext.Provider>,
    ));
    return host;
}

async function until<T>(what: string, probe: () => T | undefined | null | false, ms = 20_000): Promise<T> {
    const t0 = Date.now();
    for (;;) {
        const v = probe();
        if (v) return v;
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
        await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    }
}

/** What a page holds for a widget: the filters by role, and the widget's controls. */
interface Page { filters: Record<string, Filter>; controls: Controls }

function PageState({ onReady, children }: { onReady: (p: Page) => void; children: (p: Page) => ReactNode }) {
    const category = useBicFilter(KEYS.Category, { label: "Category" });
    const date = useBicFilter(KEYS.Date, { label: "Month" });
    const controls = useBicControls();
    const page = { filters: { Category: category, Date: date }, controls };
    useEffect(() => onReady(page));
    return <>{children(page)}</>;
}

const marksIn = (el: Element) => [...el.querySelectorAll(".d3-mark, [data-row-idx]")].filter((m) => m.tagName.toLowerCase() !== "desc");
const drawn = (el: Element) => [...el.querySelectorAll("svg")].some((s) => s.getBoundingClientRect().width > 40);
// Drawn data: clickable marks, or (a line chart over many points, which drops its point marks) a drawn path.
const drawnData = (el: Element) => drawn(el) && (marksIn(el).length > 0 || [...el.querySelectorAll("path")].some((p) => (p.getAttribute("d") ?? "").length > 200));
const BROKEN = /query failed|went wrong|No data to display|needs \d+ to \d+|too few rows|Map a field to/i;

/** The page, drawing the widget the way App does: from the field map, live or sample. */
async function mountCard(widget: Widget, map: FieldMap = fieldMap) {
    let page: Page | undefined;
    const el = await mount(
        <PageState onReady={(p) => { page = p; }}>
            {(p) => (
                <WidgetCard widget={widget} map={map} filters={p.filters} active={activeFilters(p.filters)}
                    options={{}} height={HEIGHT} controls={widget.def.kind === "mini-app" ? p.controls : undefined} />
            )}
        </PageState>,
    );
    return { el, page: () => page! };
}

/** The widget's generated component on rows given straight to it: what a rebound model's query hands it. */
async function mountRows(widget: Widget, table: { columns: { name: string }[]; rows: unknown[][] }) {
    let page: Page | undefined;
    const { Component } = widget;
    const el = await mount(
        <PageState onReady={(p) => { page = p; }}>
            {(p) => (
                <Component table={table} rename={widget.rename} width={WIDTH - 40} height={HEIGHT - 80} options={{}}
                    selects={widget.def.selects ? p.filters[widget.def.selects] : undefined}
                    controls={widget.def.kind === "mini-app" ? p.controls : undefined} />
            )}
        </PageState>,
    );
    return { el, page: () => page! };
}

const nudge = (v: unknown): unknown => {
    if (typeof v === "number") return v === 0 ? 1 : v * (Math.abs(v) < 1 ? 0.5 : 1.5);
    if (typeof v === "boolean") return !v;
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return `${Number(v.slice(0, 4)) - 1}${v.slice(4)}`;
    return v;
};

/** Turns each knob the widget reports and expects the drawing to change. Returns how many knobs moved it. */
async function turnEachKnob(el: HTMLElement, controls: Controls): Promise<number> {
    await until("the controls to report", () => controls.ready && controls.info.length > 0);
    let moved = 0;
    for (const knob of controls.info) {
        const before = el.innerHTML;
        const next = nudge(knob.value);
        if (next === knob.value) continue;
        await act(async () => controls.set({ [knob.key]: next }));
        await until(`knob ${knob.key} to redraw`, () => el.innerHTML !== before, 8_000).catch(() => false);
        if (el.innerHTML !== before) moved++;
        else throw new Error(`turning ${knob.key} (${knob.label || "no label"}) from ${String(knob.value)} to ${String(next)} changed nothing`);
    }
    return moved;
}

async function clickFirstMark(el: HTMLElement) {
    const mark = await until("a clickable mark", () => marksIn(el).find((m) => (m as HTMLElement).getBoundingClientRect?.().width > 0) ?? marksIn(el)[0]);
    await act(async () => { mark.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })); });
}

for (const widget of WIDGETS) {
    const { def } = widget;
    describe(`${def.id} (${def.chartType})`, () => {
        it("(a) draws on the shipped field map, from the bundled sample", async () => {
            const { el } = await mountCard(widget);
            await until("marks", () => drawn(el) && marksIn(el).length > 0);
            expect(el.textContent ?? "").not.toMatch(BROKEN);
        });

        it("(b) draws after a rebind: renamed fields, new values, 3x the rows, labels over 60 characters", async () => {
            const other = renamedMap(fieldMap);
            const dax = buildDax(def, other);
            for (const role of rolesOf(def)) expect(dax).toContain(`"${role}",`);
            expect(dax).toContain("'Sales ");

            const base = sampleTable(def);
            const swapped = swapTable(base);
            expect(swapped.rows.length).toBe(base.rows.length * 3);
            const labels = swapped.rows.flatMap((r) => r.filter((v) => typeof v === "string" && !/^\d{4}-/.test(v) && !/^[A-Z]{3}$/.test(v)));
            if (labels.length) expect(Math.min(...labels.map((l) => (l as string).length))).toBeGreaterThanOrEqual(60);

            const { el } = await mountRows(widget, swapped);
            await until("data drawn from the swapped rows", () => drawnData(el));
            expect(el.textContent ?? "").not.toMatch(BROKEN);
        });

        it("(c) a role left out of the map says which field to map", async () => {
            for (const role of new Set(rolesOf(def))) {
                const map: FieldMap = { ...fieldMap, roles: { ...fieldMap.roles, [role]: null } };
                const { el } = await mountCard(widget, map);
                expect(el.textContent).toContain(`Map a field to ${role} in src/fieldMap.ts`);
                expect(el.querySelector("svg")).toBeNull();
                await act(async () => root?.unmount());
                host?.remove();
                root = undefined;
            }
        });

        if (def.kind === "mini-app" && def.control === "knobs") {
            it("(d) each control changes what it draws, on the sample and after the rebind", async () => {
                const first = await mountCard(widget);
                await until("marks", () => marksIn(first.el).length > 0);
                expect(await turnEachKnob(first.el, first.page().controls)).toBeGreaterThan(0);
                await act(async () => root?.unmount());
                host?.remove();

                const swapped = await mountRows(widget, swapTable(sampleTable(def)));
                await until("data drawn from the swapped rows", () => drawnData(swapped.el));
                expect(await turnEachKnob(swapped.el, swapped.page().controls)).toBeGreaterThan(0);
            });
        }

        if (def.kind === "mini-app" && def.control === "selection") {
            it("(d) a selected group changes its explanation, on the sample and after the rebind", async () => {
                for (const swap of [false, true]) {
                    const table = swap ? swapTable(sampleTable(def)) : sampleTable(def);
                    const { el, page } = await mountRows(widget, table);
                    await until("marks", () => marksIn(el).length > 0);
                    const before = el.textContent;
                    // What a lasso hands the page: several keys at once, through the filter the widget sets.
                    const key = table.columns.findIndex((c) => c.name === def.selects);
                    const picked = table.rows.slice(0, 6).map((r) => [r[key]]);
                    await act(async () => page().filters[def.selects!].set(picked, "click"));
                    await until("the explanation to change", () => el.textContent !== before);
                    await act(async () => root?.unmount());
                    host?.remove();
                    root = undefined;
                }
            });
        }

        if (def.selects) {
            it(`(e) a click on a mark sets the page's ${def.selects} filter`, async () => {
                const { el, page } = await mountCard(widget);
                await until("marks", () => marksIn(el).length > 0);
                const filter = page().filters[def.selects!];
                expect(filter.active).toBe(false);
                await clickFirstMark(el);
                await until(`the ${def.selects} filter`, () => page().filters[def.selects!].active);
                expect(page().filters[def.selects!].keys.length).toBeGreaterThan(0);
            });
        }
    });
}

describe("vega-ranking (the template's own Vega-Lite visual)", () => {
    it("(a) draws on the shipped field map", async () => {
        let filters: Record<string, Filter> | undefined;
        const el = await mount(
            <PageState onReady={(p) => { filters = p.filters; }}>
                {(p) => <VegaRankingCard filters={p.filters} active={activeFilters(p.filters)} height={HEIGHT} />}
            </PageState>,
        );
        await until("the Vega visual", () => el.querySelector("svg, canvas"));
        expect(filters).toBeDefined();
        expect(el.textContent ?? "").not.toMatch(BROKEN);
    });

    it("(c) a role left out of the map says which field to map", async () => {
        for (const role of rolesOf(VEGA_RANKING)) {
            const map: FieldMap = { ...fieldMap, roles: { ...fieldMap.roles, [role]: null } };
            const el = await mount(
                <PageState onReady={() => {}}>
                    {(p) => <VegaRankingCard filters={p.filters} active={[]} height={HEIGHT} map={map} />}
                </PageState>,
            );
            expect(el.textContent).toContain(`Map a field to ${role} in src/fieldMap.ts`);
            await act(async () => root?.unmount());
            host?.remove();
            root = undefined;
        }
    });

    it("(e) a picked bar reaches the page's Category filter", async () => {
        let filters: Record<string, Filter> | undefined;
        await mount(<PageState onReady={(p) => { filters = p.filters; }}>{() => null}</PageState>);
        const changed = vegaToFilter(filters!.Category, [{
            action: "select",
            selections: [{ predicates: [{ type: "set", name: KEYS.Category, values: ["Japan"] }] }],
        }] as never);
        expect(changed).toBe(true);
        expect(filters!.Category.keys).toEqual([["Japan"]]);
    });
});
