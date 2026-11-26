import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import {
    registerAdmin1Lookup, clearAdmin1LookupForTests, provinceCenter, isKnownProvinceId, resolveProvinceValue, type Admin1LookupDoc,
} from "../src/admin1Lookup";
import { resolveGeoPoint } from "../src/geoPoint";

// A PROVINCE ID IS ONE ID WHATEVER ITS CASE. The hosted lookup gives a province with no ISO 3166-2 code a fallback id
// written as a lower-case slug ("ES-X-cataluna"), and ISO ids in upper case ("DE-BY"). Registration kept each id as
// written while every query upper-cased it, so no fallback id was ever found: a point map placed none of those provinces
// (all of Spain's, Great Britain's and Ireland's among them), though profiling had matched their names.
const DOC: Admin1LookupDoc = {
    version: 1,
    cities: "",
    admin1: [
        "ES.56|catalonia|cataluna;catalogne",
        "FR.11|ile de france|region ile de france",
        "DE.02|bavaria|bayern",
    ].join("\n"),
    crosswalk: ["ES.56|ES-X-cataluna", "FR.11|FR-X-ile-de-france", "DE.02|DE-BY"].join("\n"),
    centers: ["ES-X-cataluna|1.528|41.795", "FR-X-ile-de-france|2.504|48.709", "DE-BY|11.28|48.73"].join("\n"),
} as Admin1LookupDoc;

describe("a province id is one id whatever its case", () => {
    beforeEach(() => { clearAdmin1LookupForTests(); registerAdmin1Lookup(DOC); });

    it("finds a fallback id's center, in the case it is written and in any other", () => {
        expect(provinceCenter("ES-X-cataluna")).toEqual([1.528, 41.795]);
        expect(provinceCenter("ES-X-CATALUNA")).toEqual([1.528, 41.795]);
        expect(provinceCenter("fr-x-ile-de-france")).toEqual([2.504, 48.709]);
        expect(provinceCenter("DE-BY")).toEqual([11.28, 48.73]);
        expect(isKnownProvinceId("es-x-cataluna")).toBe(true);
    });

    it("resolves an id to the id as the lookup writes it, so a choropleth still joins its geometry", () => {
        expect(resolveProvinceValue("es-x-cataluna")).toEqual({ status: "resolved", provinceId: "ES-X-cataluna" });
        expect(resolveProvinceValue("de-by")).toEqual({ status: "resolved", provinceId: "DE-BY" });
        expect(resolveProvinceValue("Cataluña")).toEqual({ status: "resolved", provinceId: "ES-X-cataluna" });
    });

    it("places a province named by its fallback id's name at the province's center", () => {
        for (const [name, lat, lon] of [["Cataluña", 41.795, 1.528], ["Ile-de-France", 48.709, 2.504], ["Bayern", 48.73, 11.28]] as const) {
            const p = resolveGeoPoint({ state: name, region: "europe", mapKind: "world" }) as { lat: number; lon: number; precision: string } | null;
            expect(p, name).not.toBeNull();
            expect([p!.lat, p!.lon, p!.precision], name).toEqual([lat, lon, "state"]);
        }
    });
});

// EVERY CENTER IN THE HOSTED LOOKUP is reachable by its own id. The document is served beside the site's geometry, not
// shipped in this repo, so this runs where it is given (BIC_ADMIN1_LOOKUP=<path to admin1-lookup.v1.json>).
const HOSTED = process.env.BIC_ADMIN1_LOOKUP;
describe.skipIf(!HOSTED || !fs.existsSync(HOSTED))("every hosted province center is reachable by its own id", () => {
    it("resolves each id to its own center", () => {
        clearAdmin1LookupForTests();
        const doc = JSON.parse(fs.readFileSync(HOSTED!, "utf8")) as Admin1LookupDoc;
        registerAdmin1Lookup(doc);
        const lines = String((doc as any).centers || "").split("\n").filter(Boolean);
        const missed: string[] = [];
        for (const line of lines) {
            const [pid, lon, lat] = line.split("|");
            const c = provinceCenter(pid);
            if (!c || c[0] !== +lon || c[1] !== +lat || !isKnownProvinceId(pid)) missed.push(pid);
        }
        expect(lines.length).toBeGreaterThan(3000);
        expect(missed.slice(0, 20), `${missed.length} of ${lines.length} centers unreachable`).toEqual([]);
    });
});
