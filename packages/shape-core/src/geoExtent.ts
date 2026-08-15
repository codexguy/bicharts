// WHERE THE DATA ACTUALLY SITS — the signal that lets a picker choose a map FRAME, not just
// detect that geography exists.
//
// Detecting geo and choosing the right map are different questions, and only the first was
// answered. A table of European cities is offered a North America basemap — every point off the
// map or clustered at its edge — and an all-US table is offered a world map, legal and terrible,
// the data a smudge in one corner of an empty world. The picker treats the two as
// interchangeable because, to it, they are: both gate on "does a lat/lon pair exist".
//
// THE SERVER CANNOT ANSWER THIS. It sees at most a couple of dozen obfuscated sample rows and
// per-column summaries; the raw values live only on the client. So the extent is measured HERE
// and shipped as NUMBERS — percentages and quantiles, never a coordinate that belongs to a row.
// Same privacy class as geoKind: a statistic ABOUT values, never the values.
//
// QUANTILES, NOT MIN/MAX. One null-island row at (0,0), one bad geocode in Antarctica, or one
// "Mystery" placeholder is enough to make a min/max envelope describe a dataset that does not
// exist. p5/p95 answers "where is the bulk of this data" and shrugs off the tail, which is the
// question a frame choice actually turns on.

/** Coarse world regions, chosen for FRAME selection rather than geographic doctrine. */
export type GeoRegion =
    | "north-america" | "south-america" | "europe" | "africa" | "asia" | "oceania" | "antarctica";

/** What the extent measurement says about a set of resolved coordinates. Numbers only. */
export interface GeoExtentSummary {
    /** Rows inside the United States (including Alaska and Hawaii), 0..100. */
    pctUsa: number;
    /** Rows inside the North American frame — Mexico through Canada, 0..100. */
    pctNa: number;
    /** The 5th/95th percentile envelope of the plotted points. */
    latP5: number; latP95: number;
    lonP5: number; lonP95: number;
    /** How many coordinates the percentages are computed over — a percentage from three rows
     *  is not the same claim as one from three thousand, and a consumer weighting the signal
     *  needs to know which it has. */
    n: number;
}

/** What a country column says about its own region mix. */
export interface CountryRegionSummary {
    dominantGeoRegion: GeoRegion;
    /** Share of RESOLVED country values in that region, 0..100. */
    dominantGeoRegionPct: number;
    /** Distinct regions with at least one country present. A single-region set is the
     *  gray-world case; a spread of four is a genuinely global one. */
    regionCount: number;
    /** Country values that resolved to a region at all. */
    n: number;
}

// ---------------------------------------------------------------- bounding boxes
//
// Deliberately a few explicit boxes rather than one hull. A single box around the United States
// spans from Hawaii to Maine and swallows most of the Pacific and half of Canada, so "inside the
// US box" would be true for data that is nowhere near it — the exact false confidence this
// signal exists to remove.
//
// AND A LIMIT NO RECTANGLE CAN FIX, which is why `country` below is preferred whenever the
// caller has it: the US/Canada border is not a line of latitude. Southern Ontario and Quebec
// reach down to ~41.7N, well BELOW Boston and Chicago, so Toronto, Montreal, Windsor and
// Vancouver all fall inside any rectangle drawn around the contiguous United States. A box test
// alone reports a Canadian dataset as 100% American and hands it a US map — a confidently wrong
// frame, which is precisely the failure this signal exists to prevent. Boxes are the FALLBACK
// for coordinates that arrive with no country attached; they are adequate for the coarse
// question (is this North America or is this Europe) and cannot answer the fine one.
type Box = readonly [number, number, number, number];   // [latMin, latMax, lonMin, lonMax]

const USA_BOXES: readonly Box[] = [
    [24.4, 49.4, -125.0, -66.9],    // contiguous
    [51.2, 71.5, -168.0, -129.9],   // Alaska (the Aleutian tail past the antimeridian is out)
    [18.9, 22.3, -160.3, -154.8],   // Hawaii
];
// One box, because the North American FRAME is one map. Greenland is deliberately outside it,
// matching the basemap the host actually derives (the NA asset excludes it).
const NA_BOX: Box = [7.0, 72.0, -172.0, -52.0];

function inBox(lat: number, lon: number, b: Box): boolean {
    return lat >= b[0] && lat <= b[1] && lon >= b[2] && lon <= b[3];
}

/** Linear-interpolated quantile over a sorted array. */
function quantile(sorted: number[], q: number): number {
    if (!sorted.length) return NaN;
    if (sorted.length === 1) return sorted[0];
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Measure where a set of coordinates sits. Rows with missing or out-of-range coordinates are
 * skipped rather than counted as "outside", because an unplaced row says nothing about extent —
 * folding it in would drag every percentage toward zero and make a clean US dataset look global.
 *
 * Returns null when there is not enough placed data to make a claim: a frame chosen from two
 * points is a guess wearing a number.
 */
export function summarizeGeoExtent(
    points: ReadonlyArray<{ lat?: number | null; lon?: number | null; country?: string | null }>,
    minPoints = 3,
): GeoExtentSummary | null {
    const lats: number[] = [], lons: number[] = [];
    let usa = 0, na = 0;
    for (const p of points) {
        const lat = p?.lat, lon = p?.lon;
        if (typeof lat !== "number" || typeof lon !== "number") continue;
        if (!isFinite(lat) || !isFinite(lon)) continue;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
        lats.push(lat); lons.push(lon);
        // COUNTRY FIRST when the caller has one. It is an exact answer where the boxes are an
        // approximation, and the one place they disagree is the populous one — the Great Lakes
        // and St. Lawrence corridor, where Canada lies south of much of the northern US.
        const iso = p?.country ? String(p.country).trim().toUpperCase() : "";
        const region = iso ? countryRegion(iso) : null;
        if (region) {
            if (iso === "US" || iso === "USA") usa++;
            if (region === "north-america") na++;
        } else {
            if (USA_BOXES.some(b => inBox(lat, lon, b))) usa++;
            if (inBox(lat, lon, NA_BOX)) na++;
        }
    }
    const n = lats.length;
    if (n < minPoints) return null;
    lats.sort((a, b) => a - b);
    lons.sort((a, b) => a - b);
    return {
        pctUsa: round1((usa / n) * 100),
        pctNa: round1((na / n) * 100),
        latP5: round1(quantile(lats, 0.05)), latP95: round1(quantile(lats, 0.95)),
        lonP5: round1(quantile(lons, 0.05)), lonP95: round1(quantile(lons, 0.95)),
        n,
    };
}

// ---------------------------------------------------------------- country -> region
//
// Packed ISO-2 lists in the same style as ISO_3166_PAIRS: compact, and a typo shows up as a code
// that resolves to nothing rather than as a silently wrong region.
//
// A handful of countries genuinely straddle two regions (Russia, Turkey, Kazakhstan, Egypt). They
// are assigned by where a MAP FRAME would want them, which is not always where a geography
// textbook puts them — this table picks a projection, it does not adjudicate continents.
const REGION_ISO2: Record<GeoRegion, string> = {
    "north-america":
        "AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX " +
        "NI PA PM PR SV SX TC TT US VC VG VI",
    "south-america": "AR BO BR CL CO EC FK GF GY PE PY SR UY VE",
    "europe":
        "AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE " +
        "LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA",
    "africa":
        "AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA " +
        "MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW",
    "asia":
        "AE AF AM AZ BD BH BN BT CC CN CX GE HK ID IL IN IO IQ IR JO JP KG KH KP KR KW KZ LA LB " +
        "LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE",
    "oceania":
        "AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS",
    "antarctica": "AQ BV GS HM TF",
};

/** ISO-2 and ISO-3 both map, so a caller can pass whichever form it resolved. */
const REGION_BY_CODE: Map<string, GeoRegion> = (() => {
    const m = new Map<string, GeoRegion>();
    for (const region of Object.keys(REGION_ISO2) as GeoRegion[]) {
        for (const a2 of REGION_ISO2[region].split(/\s+/)) if (a2) m.set(a2, region);
    }
    return m;
})();

/** Register ISO-3 aliases from the caller's own ISO2->ISO3 table, so the two never drift. */
export function registerIso3Regions(iso2ToIso3: ReadonlyMap<string, string>): void {
    for (const [a2, a3] of iso2ToIso3) {
        const r = REGION_BY_CODE.get(a2);
        if (r && !REGION_BY_CODE.has(a3)) REGION_BY_CODE.set(a3, r);
    }
}

/** The region a country code belongs to, or null when the code is not one we know. */
export function countryRegion(code: string | null | undefined): GeoRegion | null {
    if (!code) return null;
    return REGION_BY_CODE.get(String(code).trim().toUpperCase()) ?? null;
}

/**
 * Which region a set of country values sits in, and how concentrated it is.
 *
 * The case this exists for: a country column that is entirely US/Canada/Mexico clears the world
 * choropleth's eligibility floor and draws a world that is gray everywhere but one continent.
 * Not wrong — but the NA-framed map was the better answer, and nothing measured the difference.
 *
 * Unresolvable values are excluded from the denominator, not counted against the dominant
 * region: a misspelling is a data-quality fact, not evidence about where the data sits.
 */
export function summarizeCountryRegions(
    values: ReadonlyArray<string | null | undefined>,
    minCountries = 2,
): CountryRegionSummary | null {
    const counts = new Map<GeoRegion, number>();
    let n = 0;
    for (const v of values) {
        const r = countryRegion(v);
        if (!r) continue;
        counts.set(r, (counts.get(r) ?? 0) + 1);
        n++;
    }
    if (n < minCountries || !counts.size) return null;
    let best: GeoRegion = "europe", bestN = -1;
    // Ties resolve by the region's own name so the answer is deterministic across runs —
    // a signal that changes between identical renders is worse than no signal.
    for (const r of Array.from(counts.keys()).sort()) {
        const c = counts.get(r)!;
        if (c > bestN) { best = r; bestN = c; }
    }
    return {
        dominantGeoRegion: best,
        dominantGeoRegionPct: round1((bestN / n) * 100),
        regionCount: counts.size,
        n,
    };
}
