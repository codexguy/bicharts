import { describe, it, expect, vi } from "vitest";
import { createFilter, createFilterScope, filterScopeOf } from "../src/page";

// FilterOptions.group without React: the scope links filters that share a group name into one pick.

describe("filter groups: several filters on one key are one pick", () => {
    const page = () => {
        const scope = createFilterScope();
        const map = scope.filter("Country", { label: "Country (map)", group: "country" });
        const table = scope.filter("Country", { label: "Country (table)", group: "country" });
        return { scope, map, table };
    };

    it("a pick in one member clears the others: the most recent pick is the page's one pick", () => {
        const { scope, map, table } = page();
        map.set(["Germany", "France"], "click");
        expect(map.pick).toBe(map);
        expect(table.pick).toBe(map);
        table.set("Germany", "click");
        expect(map.active).toBe(false);
        expect(table.pick).toBe(table);
        expect(map.pick).toBe(table);
        expect(scope.active).toEqual([table]);
        expect(filterScopeOf([map, table])).toEqual({ field: "Country (table)", values: ["Germany"] });
        table.clear();
        expect(map.pick).toBeNull();
    });

    it("a member's pick followers hear a sibling's pick", () => {
        const { map, table } = page();
        const heard = vi.fn();
        map.onPick!(heard);
        table.set("Spain", "click");
        expect(heard).toHaveBeenCalled();
    });

    it("a saved view puts the pick back in the member that held it, even when members share one key", () => {
        const { scope, map, table } = page();
        table.set("Italy", "click");
        const view = scope.save();
        expect(view.filters).toEqual({ Country: [["Italy"]] });
        table.clear();
        scope.restore(view);
        expect(scope.active).toEqual([map]);
        expect(map.values).toEqual(["Italy"]);

        const keyed = createFilterScope();
        const a = keyed.filter("Country", { key: "map", group: "g" });
        const b = keyed.filter("Country", { key: "table", group: "g" });
        b.set("Italy", "click");
        const v = keyed.save();
        a.set("Spain", "click");
        keyed.restore(v);
        expect(keyed.active).toEqual([b]);
        expect(b.values).toEqual(["Italy"]);
    });

    it("a filter keyed differently stays out of the group, said once", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { scope, map } = page();
        const code = scope.filter("CountryCode", { group: "country" });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("stays out of the group"));
        map.set("Germany", "click");
        code.set("DEU", "click");
        expect(map.active).toBe(true);
        warn.mockRestore();
    });

    it("a member removed from the scope leaves the group; an ungrouped filter is its own pick", () => {
        const { scope, map, table } = page();
        scope.add(table)();
        table.set("Spain", "click");
        map.set("Germany", "click");
        expect(table.active).toBe(true);
        const alone = createFilter("Country");
        expect(alone.pick).toBeNull();
        alone.set("Spain");
        expect(alone.pick).toBe(alone);
        expect(alone.group).toBeNull();
    });
});
