// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useBicFilter, useBicUrlState, type Filter } from "../src/react";
import { createFilterScope, viewFromToken } from "../src/filterScope";

// A SAVED VIEW PUTS A GROUP'S PICK BACK IN THE MEMBER THAT MADE IT. One pick across a map, a table and a scatter is
// three filters on one column in one group; each took the column as its name in a saved view, so a lasso of six
// countries on the scatter, saved in a link, came back as a pick on the map: the scatter lost its comparison with the
// rest and the map was narrowed instead. Each member now has a name of its own in the view.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("a group's pick round-trips through a saved view to the member that made it", () => {
    const page = () => {
        const scope = createFilterScope();
        const map = scope.filter("Country", { label: "Country (map)", group: "country" });
        const table = scope.filter("Country", { label: "Country (table)", group: "country" });
        const scatter = scope.filter("Country", { label: "Countries (scatter)", group: "country" });
        return { scope, map, table, scatter };
    };
    const SIX = ["Chile", "Peru", "Kenya", "Ghana", "Laos", "Nepal"];

    it("a scatter lasso comes back as a scatter lasso, and the map stays unfiltered", () => {
        const { scope, map, table, scatter } = page();
        scatter.set(SIX, "click");
        const view = scope.save();
        scatter.clear();
        map.set("Spain", "click");

        const fresh = page();
        fresh.scope.restore(view);
        expect(fresh.scope.active).toEqual([fresh.scatter]);
        expect(fresh.scatter.values).toEqual(SIX);
        expect(fresh.map.active).toBe(false);
        expect(fresh.table.active).toBe(false);

        scope.restore(view);
        expect(scope.active).toEqual([scatter]);
        expect(map.active).toBe(false);
        expect(table.active).toBe(false);
    });

    it("every member round-trips its own pick, and filters on one column outside any group keep theirs apart", () => {
        for (const who of ["map", "table", "scatter"] as const) {
            const p = page();
            p[who].set(["Japan"], "click");
            const q = page();
            q.scope.restore(p.scope.save());
            expect(q.scope.active).toEqual([q[who]]);
        }
        const loose = createFilterScope();
        const a = loose.filter("Country"), b = loose.filter("Country");
        a.set("Japan"); b.set("Chile");
        const back = createFilterScope();
        const a2 = back.filter("Country"), b2 = back.filter("Country");
        back.restore(loose.save());
        expect(a2.values).toEqual(["Japan"]);
        expect(b2.values).toEqual(["Chile"]);
    });

    it("a link saved before members had names of their own still opens: the pick goes to the first member", () => {
        const { scope, map, scatter } = page();
        scope.restore({ v: 1, filters: { Country: [["Japan"]] } });
        expect(scope.active).toEqual([map]);
        expect(map.values).toEqual(["Japan"]);
        expect(scatter.active).toBe(false);
    });

    it("a filter's own key names it in the view, as it always did", () => {
        const scope = createFilterScope();
        scope.filter("Country", { key: "map", group: "g" });
        const b = scope.filter("Country", { key: "table", group: "g" });
        b.set("Italy", "click");
        expect(scope.save().filters).toEqual({ table: [["Italy"]] });
    });
});

let el: HTMLDivElement;
let root: Root;
beforeEach(() => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    window.history.replaceState(null, "", "/review");
});
afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
});

describe("useBicUrlState with one pick across three panels", () => {
    it("a link made after a scatter lasso reopens with the scatter holding it (StrictMode mounts twice)", async () => {
        const got: Record<string, Filter> = {};
        function Page() {
            got.map = useBicFilter("Country", { label: "Country (map)", group: "country" });
            got.table = useBicFilter("Country", { label: "Country (table)", group: "country" });
            got.scatter = useBicFilter("Country", { label: "Countries (scatter)", group: "country" });
            useBicUrlState();
            return null;
        }
        const page = () => createElement(StrictMode, null, createElement(Page));
        await act(async () => { root.render(page()); });
        await act(async () => { got.scatter.set(["Chile", "Peru"], "click"); });
        const link = window.location.href;
        expect(viewFromToken(new URL(link).searchParams.get("view"))).not.toBeNull();

        await act(async () => root.unmount());
        root = createRoot(el);
        window.history.replaceState(null, "", link);
        await act(async () => { root.render(page()); });
        expect(got.scatter.values).toEqual(["Chile", "Peru"]);
        expect(got.map.active).toBe(false);
        expect(got.table.active).toBe(false);
    });
});
