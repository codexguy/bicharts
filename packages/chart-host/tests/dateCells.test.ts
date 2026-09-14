// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildRenderPayload } from "../src/payload";
import { codeReadsDatesInLocalTime, vegaSpecReadsDatesInLocalTime } from "../src/dateCells";
import { resolveOptions } from "../src/defaults";
import { createChartHost } from "../src/host";

const iso = (y: number, m: number, d: number) =>
    `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00.000Z`;

describe("codeReadsDatesInLocalTime - the never-worse guard", () => {
    it("calls UTC-only code clean", () => {
        expect(codeReadsDatesInLocalTime(
            "function render(c, data, options) { const f = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });"
            + " return data.rows.map(r => f.format(new Date(r[0])) + new Date(r[0]).getUTCDate()); }")).toBe(false);
        expect(codeReadsDatesInLocalTime("const x = d3.scaleUtc(); const f = d3.utcFormat('%b'); new Date(Date.UTC(2020, 0, 1));")).toBe(false);
        expect(codeReadsDatesInLocalTime("")).toBe(false);
    });

    it("calls every local read local", () => {
        for (const code of [
            "new Date(r[0]).getMonth()",
            "d.setHours(0, 0, 0, 0)",
            "d3.timeFormat('%b')",
            "d3.scaleTime()",
            "d3.timeMonth.every(1)",
            "new Date(2020, 0, 1)",
            "new Intl.DateTimeFormat('en', { month: 'short' })",
            "new Date(r[0]).toLocaleDateString('en')",
        ]) expect(codeReadsDatesInLocalTime(code), code).toBe(true);
    });

    it("does not mistake the UTC-offset read a date shim uses for a local read", () => {
        expect(codeReadsDatesInLocalTime("var local = t - new Date(t).getTimezoneOffset() * 60000;")).toBe(false);
    });
});

describe("vegaSpecReadsDatesInLocalTime", () => {
    it("treats a temporal field without a utc scale, a local timeUnit, a time scale and local functions as local", () => {
        for (const spec of [
            '{"encoding":{"x":{"field":"Date","type":"temporal"}}}',
            '{"encoding":{"x":{"field":"Date","type":"temporal","timeUnit":"yearmonth"}}}',
            '{"scales":[{"name":"x","type":"time"}]}',
            '{"signals":[{"name":"m","update":"month(datum.Date)"}]}',
            '{"encoding":{"x":{"field":"Date","type":"ordinal","timeUnit":{"unit":"month"}}}}',
        ]) expect(vegaSpecReadsDatesInLocalTime(spec), spec).toBe(true);
    });

    it("calls a UTC-only spec clean", () => {
        expect(vegaSpecReadsDatesInLocalTime('{"encoding":{"x":{"field":"Date","type":"temporal","scale":{"type":"utc"},"timeUnit":"utcyearmonth"}}}')).toBe(false);
        expect(vegaSpecReadsDatesInLocalTime('{"signals":[{"name":"m","update":"utcmonth(datum.Date)"}]}')).toBe(false);
    });
});

describe("buildRenderPayload opts.utcDays", () => {
    const cols = [{ name: "Period", dataType: "String" }, { name: "Date", dataType: "DateTime" }, { name: "n", dataType: "Integer", isMeasure: true }];
    const rows = () => [{ Period: "P1", Date: new Date(2026, 6, 13), n: 57 }, { Period: "P3", Date: new Date(2026, 7, 1), n: 63 }];

    it("serialises each local-midnight date as the UTC midnight of the day it names, in every zone", () => {
        const p = buildRenderPayload(cols, rows(), null, null, null, { utcDays: true });
        expect(p.rows.map(r => r[1])).toEqual([iso(2026, 6, 13), iso(2026, 7, 1)]);
        expect(p.dateCellsAreUtcDays).toBe(true);
        expect(Array.isArray(p.utcDayColumns)).toBe(true);
    });

    it("is byte-identical to before when utcDays is not asked for", () => {
        const r = rows();
        const p = buildRenderPayload(cols, r, null, null, null);
        expect(p.rows.map(x => x[1])).toEqual(r.map(x => x.Date.toISOString()));
        expect("dateCellsAreUtcDays" in p).toBe(false);
        expect("utcDayColumns" in p).toBe(false);
    });

    it("never touches a real timestamp column", () => {
        const withTime = [{ Date: new Date(2026, 6, 13, 9, 12), n: 1 }, { Date: new Date(2026, 6, 14), n: 2 }];
        const p = buildRenderPayload([{ name: "Date", dataType: "DateTime" }, { name: "n", dataType: "Integer" }], withTime, null, null, null, { utcDays: true });
        expect(p.rows.map(r => r[0])).toEqual(withTime.map(x => x.Date.toISOString()));
        expect(p.utcDayColumns).toEqual([]);
    });
});

describe("dateCellsAreUtcDays reaches the chart", () => {
    it("resolveOptions passes the host fact through", () => {
        expect(resolveOptions({ width: 1, height: 1, palette: [], dateCellsAreUtcDays: true }).dateCellsAreUtcDays).toBe(true);
        expect(resolveOptions({ width: 1, height: 1, palette: [] }).dateCellsAreUtcDays).toBeUndefined();
    });

    it("createChartHost promotes it from the payload, like geoPoint", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        let seen: any = "unset";
        const code = "function render(container, data, options) { window.__seen = options.dateCellsAreUtcDays; }";
        const payload = buildRenderPayload([{ name: "Date", dataType: "DateTime" }], [{ Date: new Date(2026, 6, 13) }], null, null, null, { utcDays: true });
        createChartHost(container, { data: payload, code, d3: {} }).render();
        seen = (window as any).__seen;
        container.remove();
        expect(seen).toBe(true);
    });
});
