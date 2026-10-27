import { describe, it, expect, beforeEach } from "vitest";
import { loadAdmin1Lookup, needsAdmin1Lookup, ADMIN1_LOOKUP_PATH, resetAdmin1LookupLoaderForTests } from "../src/admin1LookupLoader";
import { clearAdmin1LookupForTests, admin1LookupRegistered, resolveCityAdmin1 } from "@bicharts/shape-core";

const DOC = { version: 1, cities: "paris|FR|11|2138|48.85|2.35|", admin1: "FR.11|ile de france|" };

describe("admin-1 lookup loader", () => {
    beforeEach(() => { clearAdmin1LookupForTests(); resetAdmin1LookupLoaderForTests(); });

    it("serves the lookup from a versioned path", () => {
        expect(ADMIN1_LOOKUP_PATH).toBe("/geo/admin1-lookup.v1.json");
    });

    it("fetches, registers and logs once; a second call needs no fetch", async () => {
        let fetches = 0; const logs: string[] = [];
        const ok = await loadAdmin1Lookup("u", { fetchJson: async () => { fetches++; return DOC; }, log: t => logs.push(t) });
        expect(ok).toBe(true);
        expect(admin1LookupRegistered()).toBe(true);
        expect(resolveCityAdmin1("Paris")).toMatchObject({ status: "resolved", code: "FR.11" });
        expect(await loadAdmin1Lookup("u", { fetchJson: async () => { fetches++; return DOC; } })).toBe(true);
        expect(fetches).toBe(1);
        expect(logs).toEqual(["admin1-lookup-loaded"]);
    });

    it("shares one in-flight fetch between charts loading at once", async () => {
        let fetches = 0;
        const slow = () => new Promise<any>(r => setTimeout(() => { fetches++; r(DOC); }, 20));
        const [a, b] = await Promise.all([loadAdmin1Lookup("u", { fetchJson: slow }), loadAdmin1Lookup("u", { fetchJson: slow })]);
        expect([a, b]).toEqual([true, true]);
        expect(fetches).toBe(1);
    });

    it("gives up at the timeout without throwing, and the late arrival still registers", async () => {
        const logs: string[] = [];
        const late = () => new Promise<any>(r => setTimeout(() => r(DOC), 60));
        expect(await loadAdmin1Lookup("u", { fetchJson: late, timeoutMs: 10, log: t => logs.push(t) })).toBe(false);
        expect(logs).toContain("admin1-lookup-timeout");
        await new Promise(r => setTimeout(r, 80));
        expect(admin1LookupRegistered()).toBe(true);
    });

    it("resolves false on a failed fetch or a body that is not a lookup, and lets a later table retry", async () => {
        const logs: string[] = [];
        expect(await loadAdmin1Lookup("u", { fetchJson: async () => { throw new Error("404"); }, log: t => logs.push(t) })).toBe(false);
        expect(await loadAdmin1Lookup("u", { fetchJson: async () => "<html>not found</html>", log: t => logs.push(t) })).toBe(false);
        expect(logs).toEqual(["admin1-lookup-failed", "admin1-lookup-failed"]);
        expect(admin1LookupRegistered()).toBe(false);
        expect(await loadAdmin1Lookup("u", { fetchJson: async () => DOC })).toBe(true);
    });

    it("is worth loading for a country or city column, or a dimension named like a place", () => {
        expect(needsAdmin1Lookup([{ name: "Country", geoKind: "country-name" }])).toBe(true);
        expect(needsAdmin1Lookup([{ name: "Town", geoKind: "city-name-world" }])).toBe(true);
        expect(needsAdmin1Lookup([{ name: "Province" }])).toBe(true);
        // A sales "Region" (North / South) is not worth half a megabyte on its own; beside a country column it is.
        expect(needsAdmin1Lookup([{ name: "Sales_Region" }])).toBe(false);
        expect(needsAdmin1Lookup([{ name: "Region" }, { name: "Country", geoKind: "country-name" }])).toBe(true);
        expect(needsAdmin1Lookup([{ name: "Bundesland" }])).toBe(true);
        expect(needsAdmin1Lookup([{ name: "Bundesland" }])).toBe(true);
        expect(needsAdmin1Lookup([{ name: "Product" }, { name: "Revenue", isMeasure: true }])).toBe(false);
        expect(needsAdmin1Lookup([{ name: "State of Charge", isMeasure: true }])).toBe(false);
        expect(needsAdmin1Lookup([{ name: "Statement" }, { name: "Landing page" }])).toBe(false);
        expect(needsAdmin1Lookup(null)).toBe(false);
    });
});
