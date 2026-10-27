// THE HOSTED ADMIN-1 LOOKUP: cities and first-level divisions, for province maps and bubble placement.
//
// Every GeoNames city of 20,000+ people and every first-level division, built from GeoNames
// (CC BY 4.0) and served beside the geometry (geo/admin1-lookup.v1.json). It is far too big
// to bundle, so a HOST fetches it once and hands it over with registerAdmin1Lookup(); until then nothing here
// resolves, which is the designed fail-closed state: a province map is simply not offered.
//
// Everything here is synchronous. The host awaits the fetch (bounded) BEFORE profiling, so the profiler and the
// render-data builder can stay sync and read the lookup through this module.
//
// Keys are normalizePlaceName(), the same normal form the lookup was built with.

import { normalizePlaceName, countryIso3, ISO2_TO_ISO3 } from "./geoCountryNames";
import { countryRegion, type GeoRegion } from "./geoExtent";

/** The hosted document, as served. */
export interface Admin1LookupDoc {
    version: number;
    cities: string;   // "key|cc|admin1|popK|lat|lon|alt;alt|provinceId" per line
    admin1: string;   // "cc.admin1|key|alt;alt" per line
    crosswalk?: string; // "cc.admin1|provinceId" per line: the province most of that code's cities sit in
    centers?: string;   // "provinceId|lon|lat" per line: where a bubble map places a province with no city
}

interface CityRow { cc: string; a1: string; popK: number; lat: number; lon: number; pid: string; primary: boolean; }

interface Parsed {
    version: number;
    cityByKey: Map<string, CityRow[]>;       // primary AND alternate keys -> rows
    admin1ByCode: Map<string, string>;       // "FR.11" -> key
    admin1ByKey: Map<string, string[]>;      // key (primary or alternate) -> codes
    provinceOfCode: Map<string, string>;     // "FR.11" -> the province id it maps to
    provinceIds: Set<string>;                // every province id a city or a code reaches
    centers: Map<string, [number, number]>;  // province id -> its center [lon, lat], where a bubble map places it
    cityCount: number;
    admin1Count: number;
}

// ONE REGISTRY PER PAGE, NOT PER COPY OF THIS MODULE. A host that installs chart-host gets a second copy of this package
// inside chart-host's bundle, beside the one it profiles with; a module-level variable would give each copy its own
// registry, so a lookup the loader registered would be invisible to the profiler (or the payload builder) and province
// maps would silently never be offered. The registry lives on globalThis under a registered symbol instead; the key
// carries the parsed format's version, so two copies that parse differently never read each other's state.
const REGISTRY_KEY = Symbol.for("@bicharts/shape-core/admin1-lookup/v1");
const state: { lookup: Parsed | null } = ((g: any) => (g[REGISTRY_KEY] ??= { lookup: null }))(globalThis);

const ISO3_TO_ISO2: Map<string, string> = (() => {
    const m = new Map<string, string>();
    ISO2_TO_ISO3.forEach((a3, a2) => m.set(a3, a2));
    return m;
})();

/** Parse and register the hosted lookup. Idempotent for the same version; returns the row counts. A document that
 *  is not the expected shape registers nothing and throws, so a host's bounded preload logs it as a failed load. */
export function registerAdmin1Lookup(doc: Admin1LookupDoc): { cities: number; admin1: number } {
    if (!doc || typeof doc.cities !== "string" || typeof doc.admin1 !== "string")
        throw new Error("admin1 lookup: not a lookup document");
    if (state.lookup && state.lookup.version === doc.version)
        return { cities: state.lookup.cityCount, admin1: state.lookup.admin1Count };

    const cityByKey = new Map<string, CityRow[]>();
    const add = (key: string, row: CityRow) => {
        if (!key) return;
        const list = cityByKey.get(key);
        if (list) list.push(row); else cityByKey.set(key, [row]);
    };
    let cityCount = 0;
    for (const line of doc.cities.split("\n")) {
        const f = line.split("|");
        if (f.length < 6) continue;
        const base = { cc: f[1], a1: f[2], popK: +f[3] || 0, lat: +f[4], lon: +f[5], pid: f[7] || "" };
        add(f[0], { ...base, primary: true });
        for (const alt of (f[6] || "").split(";")) add(alt, { ...base, primary: false });
        cityCount++;
    }
    const admin1ByCode = new Map<string, string>();
    const admin1ByKey = new Map<string, string[]>();
    const addA = (key: string, code: string) => {
        if (!key) return;
        const list = admin1ByKey.get(key);
        if (!list) admin1ByKey.set(key, [code]); else if (!list.includes(code)) list.push(code);
    };
    let admin1Count = 0;
    for (const line of doc.admin1.split("\n")) {
        const f = line.split("|");
        if (f.length < 2 || !f[0].includes(".")) continue;
        admin1ByCode.set(f[0], f[1]);
        addA(f[1], f[0]);
        for (const alt of (f[2] || "").split(";")) addA(alt, f[0]);
        admin1Count++;
    }
    const provinceOfCode = new Map<string, string>();
    const provinceIds = new Set<string>();
    for (const line of (doc.crosswalk || "").split("\n")) {
        const [code, pid] = line.split("|");
        if (code && pid) { provinceOfCode.set(code, pid); provinceIds.add(pid); }
    }
    cityByKey.forEach(rows => rows.forEach(r => { if (r.pid) provinceIds.add(r.pid); }));
    const centers = new Map<string, [number, number]>();
    for (const line of (doc.centers || "").split("\n")) {
        const [pid, lon, lat] = line.split("|");
        if (pid && isFinite(+lon) && isFinite(+lat) && lon !== "" && lat !== "") { centers.set(pid, [+lon, +lat]); provinceIds.add(pid); }
    }
    state.lookup = { version: doc.version, cityByKey, admin1ByCode, admin1ByKey, provinceOfCode, provinceIds, centers, cityCount, admin1Count };
    return { cities: cityCount, admin1: admin1Count };
}

/** True once a host has registered the lookup. Province signals are emitted only then. */
export function admin1LookupRegistered(): boolean {
    return state.lookup !== null;
}

/** Forget the registered lookup. Tests only. */
export function clearAdmin1LookupForTests(): void {
    state.lookup = null;
}

/** A country value (name, ISO-2 or ISO-3, any language the country matcher reads) as ISO-2, or null. */
export function countryIso2(value: string | null | undefined): string | null {
    const a3 = countryIso3(value);
    return a3 ? ISO3_TO_ISO2.get(a3) ?? null : null;
}

/** A city resolves only when it is unique inside the narrowed scope, or when the largest candidate holds at least
 *  this many times the population of the next. A named constant, to be re-measured. */
export const CITY_TIE_RATIO = 10;

export type CityAdmin1Result =
    | { status: "resolved"; cc: string; admin1: string; code: string; provinceId: string | null; lat: number; lon: number; popK: number }
    | { status: "ambiguous"; candidates: number }
    | { status: "unmatched" };

/**
 * Which first-level division a city name sits in, narrowed by the row's country (any form the country matcher
 * reads) and, when there is none, by the continent the map shows. A primary-name match outranks an alternate-name
 * match. The tie-break: unique inside the scope, or the most populous at CITY_TIE_RATIO x the next; anything else
 * is "ambiguous", counted by the caller and never guessed.
 */
export function resolveCityAdmin1(
    city: string | null | undefined,
    opts: { country?: string | null; region?: GeoRegion | null } = {},
): CityAdmin1Result {
    if (!state.lookup || !city) return { status: "unmatched" };
    const key = normalizePlaceName(String(city));
    let rows = state.lookup.cityByKey.get(key);
    if (!rows || rows.length === 0) return { status: "unmatched" };

    const cc = opts.country ? countryIso2(opts.country) : null;
    if (opts.country && cc) rows = rows.filter(r => r.cc === cc);
    else if (opts.region) rows = rows.filter(r => countryRegion(r.cc) === opts.region);
    if (rows.length === 0) return { status: "unmatched" };

    const primaries = rows.filter(r => r.primary);
    const pool = primaries.length > 0 ? primaries : rows;
    // The same place reached twice (a primary and an alternate key of one city) is one candidate.
    const distinct = new Map<string, CityRow>();
    for (const r of pool) {
        const id = `${r.cc}|${r.a1}|${r.lat}|${r.lon}`;
        if (!distinct.has(id)) distinct.set(id, r);
    }
    const cands = [...distinct.values()].sort((a, b) => b.popK - a.popK);
    const top = cands[0];
    if (cands.length === 1 || top.popK >= CITY_TIE_RATIO * Math.max(cands[1].popK, 1)) {
        if (!top.a1 && !top.pid) return { status: "unmatched" };
        return { status: "resolved", cc: top.cc, admin1: top.a1, code: `${top.cc}.${top.a1}`, provinceId: top.pid || null, lat: top.lat, lon: top.lon, popK: top.popK };
    }
    return { status: "ambiguous", candidates: cands.length };
}

/** The GeoNames first-level codes ("FR.11") a province NAME can mean, narrowed by country when given. */
export function admin1CodesForName(name: string | null | undefined, country?: string | null): string[] {
    if (!state.lookup || !name) return [];
    const codes = state.lookup.admin1ByKey.get(normalizePlaceName(String(name))) ?? [];
    const cc = country ? countryIso2(country) : null;
    return cc ? codes.filter(c => c.startsWith(cc + ".")) : [...codes];
}

/** The province id (the drawn polygon's id) a GeoNames first-level code maps to, or null when its cities spread over
 *  several provinces (a merged country's nation, such as England) or none were placed. */
export function provinceIdForAdmin1Code(code: string | null | undefined): string | null {
    if (!state.lookup || !code) return null;
    return state.lookup.provinceOfCode.get(code) ?? null;
}

/** True when a value is a province id the lookup knows (an ISO 3166-2 code such as "FR-IDF", or a fallback id). */
export function isKnownProvinceId(value: string | null | undefined): boolean {
    if (!state.lookup || !value) return false;
    return state.lookup.provinceIds.has(String(value).trim().toUpperCase());
}

/** A province's center [lon, lat] - population-weighted over its cities, else its largest part's center - where a
 *  bubble map places a row that names the province and no city. Null when the lookup carries none. */
export function provinceCenter(provinceId: string | null | undefined): [number, number] | null {
    if (!state.lookup || !provinceId) return null;
    return state.lookup.centers?.get(String(provinceId).trim().toUpperCase()) ?? null;
}

export type ProvinceValueResult =
    | { status: "resolved"; provinceId: string }
    | { status: "ambiguous"; candidates: number }
    | { status: "unmatched" };

/**
 * One province VALUE - an ISO 3166-2 code, a GeoNames first-level code ("FR.11") or a name in any language the lookup
 * carries - to the province it names. Narrowed first by the row's country, then by the continent the map shows; a
 * name still naming several provinces is "ambiguous" (Punjab, Limburg, Georgia), counted by the caller, never guessed.
 */
export function resolveProvinceValue(value: string | null | undefined, opts: { country?: string | null; region?: GeoRegion | null } = {}): ProvinceValueResult {
    if (!state.lookup || !value) return { status: "unmatched" };
    const raw = String(value).trim();
    if (!raw) return { status: "unmatched" };
    if (state.lookup.provinceIds.has(raw.toUpperCase())) return { status: "resolved", provinceId: raw.toUpperCase() };
    const byCode = state.lookup.provinceOfCode.get(raw.toUpperCase());
    if (byCode) return { status: "resolved", provinceId: byCode };
    let pids = [...new Set(admin1CodesForName(raw, opts.country ?? null).map(provinceIdForAdmin1Code).filter((x): x is string => !!x))];
    if (pids.length > 1 && opts.region) {
        const inRegion = pids.filter(pid => countryRegion(pid.split("-")[0]) === opts.region);
        if (inRegion.length) pids = inRegion;
    }
    if (pids.length === 1) return { status: "resolved", provinceId: pids[0] };
    return pids.length ? { status: "ambiguous", candidates: pids.length } : { status: "unmatched" };
}

