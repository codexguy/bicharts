import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildRenderPayload } from "../src/payload";

// A TIME OF DAY ON THE READER'S CLOCK, as the payload serializes it. The reader's zone is the fixture: in Sao Paulo the
// 1899-12-30 base is on local mean time (-03:06:28), so 08:30 on the reader's clock is the instant 11:36:28Z.

const saved = process.env.TZ;
beforeAll(() => { process.env.TZ = "America/Sao_Paulo"; });
afterAll(() => { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; });

describe("buildRenderPayload opts.localWallClock", () => {
    const cols = [{ name: "Horas", dataType: "DateTime" }];
    const rows = () => [{ Horas: new Date(1899, 11, 30, 8, 30) }, { Horas: new Date(1899, 11, 30, 0, 0) }];

    it("serializes each timed cell at the reader's wall clock, the midnight slot with the rest", () => {
        const p = buildRenderPayload(cols, rows(), null, null, null, { localWallClock: true });
        expect(p.rows.map(r => r[0])).toEqual(["1899-12-30T08:30:00.000Z", "1899-12-30T00:00:00.000Z"]);
        expect(p.dateCellsAreUtcWallClock).toBe(true);
        expect(p.utcWallClockColumns).toEqual(["Horas"]);
    });

    it("is byte-identical to before when it is not asked for", () => {
        const p = buildRenderPayload(cols, rows(), null, null, null);
        expect(p.rows[0][0]).toBe("1899-12-30T11:36:28.000Z");
        expect("dateCellsAreUtcWallClock" in p).toBe(false);
        expect("utcWallClockColumns" in p).toBe(false);
    });

    it("leaves a whole-day column to utcDays", () => {
        const days = [{ Horas: new Date(2026, 6, 13) }];
        const p = buildRenderPayload(cols, days, null, null, null, { localWallClock: true });
        expect(p.rows[0][0]).toBe(days[0].Horas.toISOString());
        expect(p.utcWallClockColumns).toEqual([]);
    });
});
