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
import type { GeoPointPrecision } from "./contract";

/** Which columns hold the place parts a coordinate can be resolved from. Any subset;
 *  the cascade uses the most precise tier available per row. */
export interface GeoPointBinding {
    city?: string;
    state?: string;
    zip?: string;
    lat?: string;
    lon?: string;
    // Narrows city matching to the row's own country, so a bare "Burlington" on a US row
    // cannot land on the larger Canadian one. Optional: absent = the cascade behaves
    // exactly as it did before.
    country?: string;
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
    // COARSEST tier any row needed, `ambiguousRows` counts rows placed by the
    // largest-match tie-break on a colliding bare city name.
    geoPoint?: {
        precision: GeoPointPrecision | null;
        unplaced: number;
        unplacedExamples: string[];
        ambiguousRows: number;
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
    if (bind) {
        const dims = cols.filter(c => !c.isMeasure).map(c => c.name);
        const res = resolvePointRoles(dims, rowObjs, bind);
        bind = res.bind;
        rolesBackfilled = res.backfilled;
        rolesRefused = res.refused;
    }
    const hasPointBind = !!bind && !!(bind.city || bind.state || bind.zip || (bind.lat && bind.lon));
    if (hasPointBind) {
        const p = bind!;
        const built = buildGeoPointColumns(rowObjs.map(r => ({
            lat: p.lat ? r[p.lat] : null,
            lon: p.lon ? r[p.lon] : null,
            city: p.city ? r[p.city] : null,
            state: p.state ? r[p.state] : null,
            zip: p.zip ? r[p.zip] : null,
            country: p.country ? r[p.country] : null,
        })));
        pLat = built.lat; pLon = built.lon;
        geoPoint = {
            precision: built.precision,
            unplaced: built.totalRows - built.matchedRows,
            unplacedExamples: built.unmatched.slice(0, 8),
            ambiguousRows: built.ambiguousRows,
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
    return { columns: colsOut as any[], rows: out, geoUnmatched, geoUnmatchedDistinct, geoPoint };
}

