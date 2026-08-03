// The RenderData builder — the exact `data` object generated render(container,
// data, options) expects, shared by the Power BI visual (buildD3DataPayload) and
// the MCP client (dataPayload) so the wire shape can never fork (Phase B remainder
//). Semantics moved VERBATIM from the visual:
//   { columns: [...cols, __rowIdx__ [, __geoIso__] ],
//     rows:    [ [v0, …, vN, rowIdx [, iso]], … ] }   // positional; Date→ISO; null-coalesced
// The trailing __rowIdx__ is HOST METADATA: its value is the row's position, and it
// is what a mark's data-row-idx attribute carries back to the host on click.
// __geoIso__ (geo binding present) is the deterministic ISO/USPS/prefix join key
// (shape-core buildGeoIsoColumn; unmatched → null) the code binds against feature.id.
// Locked by chart-host/tests/payload.test.ts (oracle = the visual's original loop).
// A real PACKAGE specifier, not a path out of this package. The relative form
// ("../../shape-core/src/…") is what made `npm pack` ship a tarball whose every import
// failed, and no tsconfig alias could fix it: TypeScript does not route RELATIVE specifiers
// through `paths`, so `tsc -b` failed where the bundler succeeded.
import {
    buildGeoIsoColumn, isJoinGeoKind, buildGeoPointColumns, resolvePointRoles, type GeoKind,
} from "@bicharts/shape-core";
// GeoPointPrecision comes from OUR contract, not shape-core: it appears in this module's
// public return type, and shape-core is a build-time devDependency that consumers never
// install — so importing the type here put a dangling specifier in the shipped payload.d.ts.
import type { GeoPointPrecision, GeoMapKind } from "./contract";

/** Which columns hold the place parts a coordinate can be resolved from. Any subset;
 *  the cascade uses the most precise tier available per row. */
export interface GeoPointBinding {
    city?: string;
    state?: string;
    zip?: string;
    lat?: string;
    lon?: string;
    // A matching CONSTRAINT like state (any non-blank source attribute must match the
    // same value or a blank in the lookup row), and — since the country tier — also the
    // placement of last resort. Optional: absent = unconstrained.
    country?: string;
    // Which map's gazetteer rows the city tier may use. The v2 table (2026-08-02)
    // carries per-row map-kind flags so ONE list serves every point map, each map
    // declaring its own scope. Absent = "north-america" — the pre-v2 candidate set
    // exactly, so an older caller that never sends this is byte-identical.
    mapKind?: GeoMapKind;
}

export interface RenderPayload {
    columns: any[];
    rows: any[][];
    // Present only when a geo binding was given: feeds options.geoUnmatched
    // ("N regions unmatched"). undefined for non-geo payloads.
    geoUnmatched?: { count: number; examples: string[] };
    // Diagnostics companion: DISTINCT raw values that failed to resolve (examples is
    // capped at 8; this is the uncapped count the visual's geoIso-d3 log reports).
    geoUnmatchedDistinct?: number;
    // Present only when a POINT binding was given (city/state/zip -> coordinates).
    // Feeds options.geoPoint so the chart can annotate honestly: `precision` is the
    // COARSEST tier any row needed; `ambiguousRows` counts rows whose name matched
    // MULTIPLE places and were therefore NOT plotted (v2 matching, 2026-08-02 — refusal
    // replaced the old largest-city tie-break).
    geoPoint?: {
        precision: GeoPointPrecision | null;
        // Rows per tier. `precision` alone is a CEILING and reads the same for 1-of-42
        // and 42-of-42 coarse rows, so a caption written from it can be false for almost
        // the whole map; these counts are what the chart should annotate from.
        precisionCounts: Record<GeoPointPrecision, number>;
        // The rows a coarse-tier caption is actually about, named and capped.
        coarseExamples: string[];
        unplaced: number;
        unplacedExamples: string[];
        ambiguousRows: number;
        // The rows behind ambiguousRows, named so the chart's info call-out can tell the
        // user WHAT to disambiguate (add a state/country column). ADDITIVE + optional —
        // absent on older hosts, and old generated code needs nothing from it: ambiguous
        // rows carry null coordinates, so its own off-map counting already covers them.
        ambiguousExamples?: string[];
        // What the ROLE resolution did to the caller's binding, so the chart can say when
        // its coordinates rest on something other than what was asked for. Both are
        // ADDITIVE and optional: a host on an older contract simply ignores them.
        //   backfilled — roles the binding omitted, resolved from the data
        //                ("state=StateCode (100% states/provinces)")
        //   refused    — roles the binding named that were rejected, with why
        //                ("state=Country (every value is a country, not a state)")
        rolesBackfilled?: string[];
        rolesRefused?: string[];
    };
    /**
     * WHY THERE IS NO MAP — the refusals that survive when nothing could be placed.
     *
     * `geoPoint.rolesRefused` above only exists when a binding resolved, so the one case where
     * an explanation is worth most — the resolver rejected every candidate and the chart is
     * about to draw its own empty state — reported NOTHING. That is how "no coordinate data
     * available" over a table full of countries cost a day: the classifier had a precise
     * reason ("only 95.5% of values are country identifiers") and no way to say it.
     *
     * Present whenever a point binding was attempted and something was refused, whether or not
     * a map came out of it. Joel 2026-08-02: "be sure to provide feedback in the output that
     * helps call out exceptions / decisions like this, if possible."
     */
    geoPointRefused?: string[];
}

export function buildRenderPayload(
    cols: Array<{ name: string } & Record<string, any>>,
    rowObjs: Array<Record<string, any>>,
    geo?: { column: string; kind: string } | null,
    point?: GeoPointBinding | null,
): RenderPayload {
    const colNames = cols.map(c => c.name);

    // POINT geocoding: resolve each row to a coordinate from whatever place parts it has
    // (City+State -> ZIP -> State) and append __geoLat__/__geoLon__. This is what lets a
    // point map draw from city NAMES alone, with no lat/lon columns in the data. Skipped
    // entirely when the caller supplied no point binding, so non-map charts pay nothing.
    let pLat: (number | null)[] | null = null;
    let pLon: (number | null)[] | null = null;
    let geoPoint: RenderPayload["geoPoint"];
    // The caller's binding is a HINT, not the last word. The codegen response names these
    // roles and can leave one out — a production point map named the city, not the state, so
    // City+State never engaged and 8 marks landed on the wrong same-named city. Verify
    // what was named and backfill what was not, from the values themselves.
    // Measures are excluded: a place is a dimension, and a 5-digit Revenue reads as a ZIP.
    let bind: GeoPointBinding | null = point ?? null;
    let rolesBackfilled: string[] = [];
    let rolesRefused: string[] = [];
    // The column the resolver passed over, kept ONLY so an unplaced row can be named. When a
    // country hint is swapped for a cleaner column, the rows that then fail are typically the
    // ones whose value in the WINNING column is blank — so without this the report can count
    // them and not say which they are, which is the silent drop it exists to prevent.
    let labelCol: string | undefined;
    if (bind) {
        const dims = cols.filter(c => !c.isMeasure).map(c => c.name);
        const res = resolvePointRoles(dims, rowObjs, bind, point?.mapKind);
        bind = res.bind;
        rolesBackfilled = res.backfilled;
        rolesRefused = res.refused;
        const lf = res.labelFallback;
        labelCol = lf && (lf.country || lf.city || lf.state || lf.zip);
    }
    // COUNTRY is a PLACEABLE role, not merely a matching constraint. It was only the latter
    // when this gate was written; the COUNTRY precision tier (shape-core 0.4.2, "COUNTRY
    // precision tier + the world basemap kind") made country-alone a real placement — "the
    // coarsest honest answer" — and this line was never updated alongside it. The effect was
    // silent and total: a World point map over country-only data took this branch as false,
    // never called buildGeoPointColumns, appended no __geoLat__/__geoLon__, and the chart
    // drew its own "no coordinate data" empty state — while the resolver was perfectly
    // capable of placing every row. Seen on dev LLMLogID 38905 (world_country_metrics,
    // 44 countries, server binding {"country":"Country"}).
    const hasPointBind = !!bind && !!(bind.city || bind.state || bind.zip || bind.country || (bind.lat && bind.lon));
    if (hasPointBind) {
        const p = bind!;
        const built = buildGeoPointColumns(rowObjs.map(r => ({
            lat: p.lat ? r[p.lat] : null,
            lon: p.lon ? r[p.lon] : null,
            city: p.city ? r[p.city] : null,
            state: p.state ? r[p.state] : null,
            zip: p.zip ? r[p.zip] : null,
            country: p.country ? r[p.country] : null,
            label: labelCol ? r[labelCol] : null,
        })), point?.mapKind);
        pLat = built.lat; pLon = built.lon;
        geoPoint = {
            precision: built.precision,
            precisionCounts: built.precisionCounts,
            coarseExamples: built.coarseExamples,
            // STRICTLY no-match. Ambiguous rows are deliberately NOT in here: new charts
            // report them from ambiguousRows/ambiguousExamples, while OLD generated code
            // still shows them — it computes its own off-map count from null coordinates
            // and takes max(offMap, unplaced), so the not-shown total stays right without
            // double-counting on either side of the upgrade.
            unplaced: built.totalRows - built.matchedRows - built.ambiguousRows,
            unplacedExamples: built.unmatched.slice(0, 8),
            ambiguousRows: built.ambiguousRows,
            ...(built.ambiguousExamples.length ? { ambiguousExamples: built.ambiguousExamples } : {}),
            // Omitted entirely when nothing was adjusted, so the common case adds no bytes
            // and a chart can treat presence as "something about this binding is worth
            // saying".
            ...(rolesBackfilled.length ? { rolesBackfilled } : {}),
            ...(rolesRefused.length ? { rolesRefused } : {}),
        };
    }

    // Geo choropleth: precompute the deterministic __geoIso__ join column (normal-
    // form ISO/USPS/FIPS via shape-core; unmatched → null) so each region <path>
    // binds a CODE, never a name→code map the generated code invents. Only when the
    // server named a geo column + kind for this render.
    let geoIso: (string | null)[] | null = null;
    let geoUnmatched: { count: number; examples: string[] } | undefined;
    let geoUnmatchedDistinct: number | undefined;
    // isJoinGeoKind guard: "city-name" (and any future coordinate-feeding kind) is a
    // GeoKind but not a JOIN kind — building __geoIso__ from it nulls every row and
    // the choropleth draws blank with "N regions unmatched" = 100%. Skip instead: no
    // __geoIso__ appended → the archetype's guarded probe reports honestly.
    if (geo && geo.column && geo.kind && isJoinGeoKind(geo.kind)) {
        const built = buildGeoIsoColumn(rowObjs.map(r => r[geo.column]), geo.kind as GeoKind);
        geoIso = built.iso;
        geoUnmatched = { count: built.totalRows - built.matchedRows, examples: built.unmatched.slice(0, 8) };
        geoUnmatchedDistinct = built.unmatched.length;
    }

    // Project the row objects back into arrays in the column order to keep the wire
    // shape predictable for the LLM. DateTime cells come straight off the index;
    // coerce to ISO so the contract in PromptPreable holds. Trailing columns:
    // __rowIdx__ [+ __geoIso__].
    const extra = 1 + (geoIso ? 1 : 0) + (pLat ? 2 : 0);
    const out: any[][] = new Array(rowObjs.length);
    for (let r = 0; r < rowObjs.length; r++) {
        const row = rowObjs[r];
        const a = new Array(cols.length + extra);
        for (let c = 0; c < cols.length; c++) {
            const v = row[colNames[c]];
            if (v instanceof Date) {
                a[c] = v.toISOString();
            } else {
                a[c] = v ?? null;
            }
        }
        // Trailing `__rowIdx__` — its value IS the row's position, exactly the index
        // the host bridge expects in data-row-idx. __geoIso__ / __geoLat__ / __geoLon__
        // are the same class: host-computed metadata, not plottable dimensions.
        let k = cols.length;
        a[k++] = r;
        if (geoIso) a[k++] = geoIso[r];
        if (pLat && pLon) { a[k++] = pLat[r]; a[k++] = pLon[r]; }
        out[r] = a;
    }
    const colsOut = [...cols, { name: "__rowIdx__", dataType: "Integer", isMeasure: false, modelDesc: "" }];
    if (geoIso) colsOut.push({ name: "__geoIso__", dataType: "String", isMeasure: false, modelDesc: "" });
    if (pLat) colsOut.push(
        { name: "__geoLat__", dataType: "Double", isMeasure: false, modelDesc: "" },
        { name: "__geoLon__", dataType: "Double", isMeasure: false, modelDesc: "" });
    return {
        columns: colsOut as any[], rows: out, geoUnmatched, geoUnmatchedDistinct, geoPoint,
        // Survives a refusal that placed nothing — see geoPointRefused. Omitted when empty so
        // the ordinary case adds no bytes.
        ...(rolesRefused.length ? { geoPointRefused: rolesRefused } : {}),
    };
}

