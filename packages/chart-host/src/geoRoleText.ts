// The point map's place-role decisions in the reader's language. shape-core's resolver reports each one twice: an
// English sentence (geoPoint.rolesRefused / rolesBackfilled, geoPointRefused) that generated charts and agents have read
// since it shipped, and the same decision as data (roleFacts, geoPointRefusedFacts). This words the data, one whole
// sentence per role and reason so no language has to bend a role name into a shared frame.
import type { GeoPointRoleFact } from "./contract";
import { hostText, type StringSource } from "./hostText";

/** Each decision's key and English. A role/reason pair the resolver never produces reads the generic sentence. */
const FACT_TEXT: Readonly<Record<string, string>> = {
    "refused.zip.low-match": "{column} was not used as the ZIP code: only {pct}% of its values read as ZIP codes.",
    "refused.zip.short-digits": "{column} was not used as the ZIP code: its values are 3-4 digit codes with nothing to say they are postal.",
    "refused.state.ambiguous-ca": "{column} was not used as the state: every value is \"CA\", which is both Canada and California.",
    "refused.state.country-values": "{column} was not used as the state: every value is a country.",
    "refused.state.low-match": "{column} was not used as the state: only {pct}% of its values are states or provinces.",
    "refused.country.replaced": "{column} was not used as the country: only {pct}% of its values are countries, so {replacement} was used instead.",
    "refused.country.one-country": "{column} cannot place the points on its own: every row is in the same country.",
    "refused.country.not-country": "{column} was not used as the country: its values are not countries.",
    "refused.lat/lon.no-coordinate-pair": "{column} were not used as coordinates: no row holds a usable latitude and longitude.",
    "backfilled.state.matched": "{column} was used as the state ({pct}% of its values are states or provinces).",
    "backfilled.zip.matched": "{column} was used as the ZIP code ({pct}% of its values are ZIP codes).",
    "backfilled.city.matched": "{column} was used as the city ({pct}% of its values are known cities).",
    "backfilled.country.matched": "{column} was used as the country.",
    "refused.other": "{column} was not used as a place column.",
    "backfilled.other": "{column} was used as a place column.",
};

/** The catalog key a decision reads: "geo.refused.zip_low_match", "geo.backfilled.city_matched". */
export function pointRoleFactKey(fact: GeoPointRoleFact): string {
    const exact = `${fact.kind}.${fact.role}.${fact.reason}`;
    const id = Object.prototype.hasOwnProperty.call(FACT_TEXT, exact) ? exact : `${fact.kind}.other`;
    return "geo." + id.replace("lat/lon", "latlon").replace(/\.(?=[^.]*$)/, "_").replace(/-/g, "_");
}

/** Every geo.* key with its English, for a catalog check. */
export const POINT_ROLE_FACT_ENGLISH: Readonly<Record<string, string>> = Object.freeze({
    ...Object.fromEntries(Object.entries(FACT_TEXT).map(([id, en]) => {
        const [kind, role, reason] = id.split(".");
        const key = reason ? pointRoleFactKey({ kind: kind as any, role: role as any, reason: reason as any, column: "" })
            : `geo.${kind}_other`;
        return [key, en];
    })),
    "geo.destination": "Destination: {sentence}",
});

/**
 * One decision as a sentence in the source's language (English with no source). A flow map's destination-end fact is
 * prefixed the way geoPointRefused prefixes its English ("destination: ...").
 */
export function pointRoleFactText(fact: GeoPointRoleFact, strings?: StringSource | null): string {
    const key = pointRoleFactKey(fact);
    const english = POINT_ROLE_FACT_ENGLISH[key];
    const sentence = hostText(strings, key, english, {
        column: fact.column,
        pct: fact.pct ?? "",
        replacement: fact.replacement ?? "",
    });
    return fact.endpoint === "destination"
        ? hostText(strings, "geo.destination", POINT_ROLE_FACT_ENGLISH["geo.destination"], { sentence })
        : sentence;
}
