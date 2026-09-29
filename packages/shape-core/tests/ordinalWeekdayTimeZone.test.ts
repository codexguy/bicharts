import { describe, it, expect, beforeAll, afterAll } from "vitest";

// A LOCALE'S WEEKDAY NAMES ARE THE SAME DAYS IN EVERY TIME ZONE. The detector builds its per-locale
// weekday dictionary from UTC-midnight instants; formatted in a zone west of Greenwich, each instant
// is the previous day there, so every name was filed one position early ("domingo" as Monday) and a
// Spanish weekday column came back Sunday-first under the Monday-first pattern. The reader's zone is
// fixture here, so it is set explicitly - on a UTC machine the defect does not show.

const saved = process.env.TZ;
beforeAll(() => { process.env.TZ = "America/Los_Angeles"; });
afterAll(() => { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; });

describe("localized weekday order does not depend on the reader's time zone", () => {
    it("a Spanish weekday column is Monday-first in Los Angeles", async () => {
        // Imported after the zone is set, so the per-locale dictionary is built in it.
        const { detectOrdinalDomain } = await import("../src/ordinalDetector");
        const values = ["Domingo", "Sábado", "Viernes", "Jueves", "Miércoles", "Martes", "Lunes"];
        const r = detectOrdinalDomain(values, "es-ES");
        expect(r?.pattern).toBe("weekday_mon_sun");
        expect(r?.orderedDomain).toEqual(["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]);
    });
});
