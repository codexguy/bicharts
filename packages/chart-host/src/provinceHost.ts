// WHAT EVERY HOST DOES FOR A PROVINCE MAP, once, so the hosts cannot drift: get the profile ready (the reader's Derive
// Provinces setting, and the hosted admin-1 lookup for a table that could use it), and build the province binding a
// render hands buildRenderPayload. Lives on the provinces entry, off the main entry's eager closure.

import { buildProvinceIsoColumn, admin1LookupRegistered } from "@bicharts/shape-core";
import { loadAdmin1Lookup, needsAdmin1Lookup, ADMIN1_LOOKUP_PATH } from "./admin1LookupLoader";
import { geoKeyFor, provinceLocator } from "./provinceGeo";
import type { GeoBinding } from "./payload";

/** The profile a host measures with: shape-core's IndexedText, by the members this needs. */
export interface ProvinceProfile {
    deriveProvinces?: boolean;
    getColumnsWithStats(privacyLevel: string, locale?: string): ReadonlyArray<{ name?: string | null; geoKind?: string | null; isMeasure?: boolean | null }>;
    invalidateStats?(): void;
}

/**
 * Before a request is profiled: hand the profile the reader's Derive Provinces setting, and when the table could carry
 * provinces, wait (up to `timeoutMs`, default 3000) for the hosted admin-1 lookup served at `origin`. Either change
 * re-measures the profile, which keeps its rows. Never throws; a late or failed load costs a province map, never a chart.
 */
export async function prepareProvinceProfile(
    profile: ProvinceProfile | null | undefined,
    opts: { origin: string; deriveProvinces: boolean; privacyLevel: string; locale?: string; timeoutMs?: number;
            fetchJson?: (url: string) => Promise<any>; log?: (tag: string, data?: any) => void },
): Promise<void> {
    if (!profile || typeof profile.getColumnsWithStats !== "function") return;
    let invalidate = false;
    if (profile.deriveProvinces !== opts.deriveProvinces) { profile.deriveProvinces = opts.deriveProvinces; invalidate = true; }
    // A host that names no origin cannot fetch the lookup; it profiles without it, as on a failed load.
    const origin = typeof opts.origin === "string" ? opts.origin.trim() : "";
    if (!admin1LookupRegistered() && origin) {
        let cols: ReturnType<ProvinceProfile["getColumnsWithStats"]> = [];
        try { cols = profile.getColumnsWithStats(opts.privacyLevel, opts.locale); } catch { /* an unprofilable table needs no lookup */ }
        if (needsAdmin1Lookup(cols)) {
            const ok = await loadAdmin1Lookup(origin.replace(/\/+$/, "") + ADMIN1_LOOKUP_PATH,
                { timeoutMs: opts.timeoutMs ?? 3000, fetchJson: opts.fetchJson, log: opts.log });
            invalidate = invalidate || ok;
        }
    }
    if (invalidate) profile.invalidateStats?.();
}

/** The geo fields a generation names, as every host keeps them. */
export interface GeoFields { geoColumn?: string | null; geoKind?: string | null; geoRegion?: string | null; geoGrain?: string | null }

/**
 * The geo binding for a render. A province map (grain "admin1") gets the province join, a locator over `geo` (the
 * continent's province geometry, when the host has it), the reader's Derive Provinces setting and the columns a blank
 * province falls back to, named from the profile; every other geo chart its column + kind. Null when nothing is bound.
 */
export function provinceBinding(
    res: GeoFields,
    cols: ReadonlyArray<{ name: string; geoKind?: string | null; isMeasure?: boolean | null }>,
    opts: { deriveProvinces: boolean; geo?: any },
): GeoBinding | null {
    if (!res.geoColumn || !res.geoKind) return null;
    if (String(res.geoGrain ?? "").toLowerCase() !== "admin1") return { column: res.geoColumn, kind: res.geoKind };
    const dims = cols.filter(c => !c.isMeasure && c.name !== res.geoColumn);
    const kindOf = (c: { geoKind?: string | null }) => String(c.geoKind ?? "");
    const words = (n: string) => n.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/);
    const named = (re: RegExp) => cols.find(c => words(c.name).some(w => re.test(w)))?.name ?? null;
    return {
        column: res.geoColumn, kind: res.geoKind, grain: "admin1", region: res.geoRegion || null,
        fallback: {
            city: dims.find(c => kindOf(c).startsWith("city"))?.name ?? null,
            country: dims.find(c => kindOf(c).startsWith("country"))?.name ?? null,
            lat: named(/^(lat|latitude)$/), lon: named(/^(lon|lng|long|longitude)$/),
        },
        deriveProvinces: opts.deriveProvinces,
        join: buildProvinceIsoColumn,
        locate: opts.geo ? provinceLocator(opts.geo) : null,
    };
}

/** The geometry key a generation renders against (geoKeyFor over a host's kept fields). */
export function geoKeyOfFields(res: GeoFields): string | null {
    return geoKeyFor({ geoKind: res.geoKind, geoRegion: res.geoRegion, geoGrain: res.geoGrain });
}
