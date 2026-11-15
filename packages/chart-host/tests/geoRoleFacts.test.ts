// A point map's place-role decisions as DATA beside the English sentences, worded in the reader's language by the host.
// shape-core's resolver wrote each refusal and backfill as an English sentence only ("state=St (every value is a
// country, not a state)"), and a generated chart printed it as written, so every reader read English and any caller
// that wanted the column had to parse prose. The resolver now returns the same decisions as facts
// {kind, role, column, reason, pct?, replacement?}; the payload carries them (geoPoint.roleFacts,
// geoPointRefusedFacts), the host promotes them into options, and pointRoleFactText words them. The English
// sentences stay byte-identical for one release, because charts and agents read them today.
import { describe, it, expect } from "vitest";
import { resolvePointRoles } from "@bicharts/shape-core";
import { buildRenderPayload } from "../src/payload";
import { resolveOptions } from "../src/defaults";
import { pointRoleFactText, pointRoleFactKey, POINT_ROLE_FACT_ENGLISH } from "../src/geoRoleText";
import { catalogSource } from "../src/hostText";
import type { GeoPointRoleFact } from "../src/contract";

const dim = (name: string) => ({ name, isMeasure: false });
const COUNTRY_IN_STATE = [
    { City: "Toronto", St: "Canada" }, { City: "Chicago", St: "United States" },
    { City: "Monterrey", St: "Mexico" }, { City: "Calgary", St: "Canada" },
];

describe("the resolver reports each decision as data, beside its sentence", () => {
    it("gives every refused and backfilled sentence one fact, in the same order", () => {
        const res = resolvePointRoles(["City", "St"], COUNTRY_IN_STATE, { city: "City", state: "St" }, "north-america", ["City", "St"]);
        expect(res.refused).toEqual(["state=St (every value is a country, not a state)"]);
        expect(res.facts.filter(f => f.kind === "refused")).toEqual([
            { kind: "refused", role: "state", column: "St", reason: "country-values" },
        ]);
        expect(res.facts.filter(f => f.kind === "refused").length).toBe(res.refused.length);
        expect(res.facts.filter(f => f.kind === "backfilled").length).toBe(res.backfilled.length);
    });

    it("measures the share a refusal or a backfill was decided on", () => {
        const rows = [{ Z: "abc" }, { Z: "def" }, { Z: "12345" }, { Z: "ghi" }];
        const res = resolvePointRoles(["Z"], rows, { zip: "Z" }, "usa", ["Z"]);
        const f = res.facts.find(x => x.role === "zip")!;
        expect(f).toMatchObject({ kind: "refused", reason: "low-match", column: "Z" });
        expect(res.refused[0]).toContain(`only ${f.pct}% of values read as ZIPs`);
    });
});

describe("the payload and the host carry the facts", () => {
    it("puts them on geoPoint, and its English sentences are unchanged", () => {
        const p = buildRenderPayload([dim("City"), dim("St")], COUNTRY_IN_STATE, null,
            { city: "City", state: "St", mapKind: "north-america" });
        expect(p.geoPoint!.rolesRefused).toEqual(["state=St (every value is a country, not a state)"]);
        expect(p.geoPoint!.roleFacts).toContainEqual({ kind: "refused", role: "state", column: "St", reason: "country-values" });
    });

    it("adds no field when nothing was adjusted", () => {
        const rows = [{ Lat: 43.7, Lon: -79.4 }, { Lat: 41.9, Lon: -87.6 }];
        const p = buildRenderPayload([{ name: "Lat", isMeasure: true }, { name: "Lon", isMeasure: true }], rows, null,
            { lat: "Lat", lon: "Lon" });
        expect(p.geoPoint).toBeTruthy();
        expect("roleFacts" in p.geoPoint!).toBe(false);
        expect("geoPointRefusedFacts" in p).toBe(false);
    });

    it("passes geoPointRefusedFacts through resolveOptions untouched", () => {
        const facts: GeoPointRoleFact[] = [{ kind: "refused", role: "country", column: "C", reason: "one-country" }];
        expect(resolveOptions({ geoPointRefusedFacts: facts } as any).geoPointRefusedFacts).toBe(facts);
    });
});

describe("pointRoleFactText words a decision", () => {
    const fact: GeoPointRoleFact = { kind: "refused", role: "state", column: "Region", reason: "low-match", pct: 40 };

    it("in English with no source", () => {
        expect(pointRoleFactText(fact)).toBe("Region was not used as the state: only 40% of its values are states or provinces.");
    });

    it("in the source's language, the column and share filled in", () => {
        const ja = catalogSource("ja", { [pointRoleFactKey(fact)]: "{column} は州として使用されませんでした: 値の {pct}% のみが州です。" });
        expect(pointRoleFactText(fact, ja)).toBe("Region は州として使用されませんでした: 値の 40% のみが州です。");
    });

    it("names a flow map's destination end, and a pair it does not know reads the generic sentence", () => {
        expect(pointRoleFactText({ ...fact, endpoint: "destination" })).toBe(`Destination: ${pointRoleFactText(fact)}`);
        expect(pointRoleFactText({ kind: "refused", role: "city", column: "X", reason: "replaced" }))
            .toBe("X was not used as a place column.");
    });

    it("has an English sentence for every key it can read", () => {
        const keys = Object.keys(POINT_ROLE_FACT_ENGLISH);
        expect(keys).toContain("geo.refused.latlon_no_coordinate_pair");
        expect(keys).toContain("geo.backfilled_other");
        for (const k of keys) expect(k).toMatch(/^geo\.[a-z_.]+$/);
    });
});
