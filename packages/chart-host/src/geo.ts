import { WORLD_110M } from "./geoWorld110m.generated";
import { US_STATES } from "./geoUsStates.generated";
import { US_ZIP3 } from "./geoUsZip3.generated";
import { NA_ISO3, NA_LAT_MAX, clipFeatureToLat } from "./geoNaRegions";

// Geometry the D3 choropleth lanes hand to generated code as `options.geo`
// (2026-07-22 — bundled, not fetched: each asset is well under ~180 KB gzipped,
// so it rides the visual, needs no /geo/ hosting, and renders offline/air-gapped).
// Moved into @bicharts/chart-host (Phase B) so the Power BI visual AND the MCP client share
// ONE copy — MCP no longer reaches into the visual's src/. Keyed by the server-supplied
// geoKind → the FeatureCollection whose feature.id is the join key generated code binds
// against __geoIso__:
//   country-*                → WORLD_110M  (feature.id = ISO 3166-1 alpha-3)
//   us-state-code|name       → US_STATES   (feature.id = USPS, e.g. "CA")
//   us-zip5                  → US_ZIP3     (feature.id = 3-digit prefix; the archetype
//                                           joins __geoIso__.slice(0,3) == feature.id)
// County / other assets slot in here (own generated modules) as those lanes land.
export function geoForKind(geoKind: string | null | undefined): any | undefined {
    if (!geoKind) return undefined;
    const k = geoKind.toLowerCase();
    if (/^country/.test(k)) return WORLD_110M;
    if (k === "us-state-code" || k === "us-state-name") return US_STATES;
    if (k === "us-zip5") return US_ZIP3;
    if (k === "north-america") return northAmerica();
    return undefined;
}

// North America BASEMAP for point-map (lat/lon) types — e.g. North America (Bubbles).
// Not a join target (no __geoIso__): pure grey context polygons. Filtered from the
// already-bundled world asset at runtime (zero extra bundle bytes); polygons only —
// the world asset's centroid Point features (micro-island hubs) are join aids for the
// choropleth and would just clutter a context map. Cached after first build. The
// server routes this via LLMChartType.GeoAssetKind -> res.GeoKind = "north-america".
// Membership (and the Greenland exclusion + its rationale) lives in geoNaRegions.ts so it can
// be read without pulling this module's ~1.3 MB of generated geometry. Re-exported for callers
// that already hold a geo.ts import.
export { NA_ISO3 };
let _na: any | undefined;
function northAmerica(): any {
    if (!_na) {
        // Membership filter, then the northern cutoff. The archetype fitExtent()s to this
        // collection, so clipping the geometry (rather than only the fit) is what actually
        // reclaims the frame: land above the cutoff is gone, so it can neither drive the fit
        // nor spill over the top of the plot area into the header strip.
        _na = {
            type: "FeatureCollection",
            features: (WORLD_110M.features as any[])
                .filter((f: any) => NA_ISO3.has(f?.id) && f?.geometry && f.geometry.type !== "Point")
                .map((f: any) => clipFeatureToLat(f, NA_LAT_MAX))
                .filter((f: any) => f !== null),
        };
    }
    return _na;
}
