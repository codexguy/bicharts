// @bicharts/shape-core — public API.
//
// A host-agnostic data-shape PROFILER. Ingest a dataset's rows through the
// IValueCollection.addRow seam, then read the measured shape back as a
// LLMColumnWithValue[] payload. The Power BI visual and the (future) MCP client
// both feed the SAME engine through their own adapters, so the server receives an
// identical shape payload regardless of which front-end produced it.
//
// This package is MEASUREMENT only. The POLICY that decides what a measured shape
// means for chart selection (eligibility gates, weighting, prompt assembly) lives
// server-side and is deliberately NOT here.

// The engine + its row-ingest interface.
export { IndexedText } from "./indexedText";
export type { IValueCollection } from "./indexedText";

// Pure classifiers (usable standalone, e.g. by an adapter that wants to tag
// columns before ingest).
export {
    classifyTemporal,
    detectTextDatePattern,
    classifyAdditivity,
    classifyNumericValueNature,
    hostAggHint,
    isIdentifierName,
} from "./indexedText";
export type { TextDateDetection } from "./indexedText";

// WHICH AGGREGATIONS ARE HONEST for a column (2026-09-01). The two axes a presentation surface
// needs and that no single enum carried: what KIND of scale this is, and whether SUM means
// anything over it. Public because the answer has to be identical in the selection card, in the
// settings panel and in whatever a host builds next — "Sum of Latitude: 84 (12.3% of total)" is
// what one surface deciding for itself looked like. The token lists here are the CANONICAL copy
// of the server's own; a server-side test asserts the two sets are equal.
export {
    classifyForAggregation,
    allowedAggregations,
    defaultAggregation,
    isAggregationAllowed,
    shareOfTotalIsHonest,
    nameLooksIntensiveRate,
    nameLooksPositional,
    stripHostAggPrefix,
    hasDefaultAggPrefix,
    // "Sum of Sum of Revenue" -> "Sum of Revenue" (2026-09-04). IndexedText.setColumns applies
    // it, so every host gets the rename for free; both are exported because a host that renders
    // CACHED code must ask the second question too - see IndexedText.emitLegacyAggAliases.
    collapseRepeatedAggPrefix,
    codeNeedsLegacyAggNames,
    INTENSIVE_WORD_TOKENS,
    INTENSIVE_SUFFIX_TOKENS,
    POSITIONAL_WORD_TOKENS,
    POSITIONAL_SUFFIX_TOKENS,
} from "./aggregation";
export type {
    AggKind, AggAdditivity, AggBasis, AggNature, AggregationClass, AggregationColumn,
} from "./aggregation";

// The wire contract + column value shape.
export type { LLMColumnWithValue } from "./models";
export type {
    LLMRequestModifier,
    SimpleColumn,
    VegaRendererPayload,
    LLMClientHints,
    LLMRequestCode,
    LLMQualifyResult,
    LLMRequestCodeResult,
    GetLicenseStatusResult,
} from "./models";

// Column-detail helpers.
// The gazetteer-quality knob and the "what counts as blank" rule, exported so a host or a
// sibling classifier tunes ONE constant rather than keeping its own copy.
export { ROLE_MATCH_PCT, CITY_ROLE_MATCH_PCT, isBlankLike } from "./matchQuality";
export { detectOrdinalDomain, safeDistinctValuesToShip, isOrdinalFriendlyName } from "./ordinalDetector";
export { detectFormatSignature } from "./formatDetector";
// isJoinGeoKind is PUBLIC because a host must distinguish a region-JOIN kind from a
// coordinate-feeding one: "city-name" is a GeoKind but not a join key, and building
// __geoIso__ from it nulls every row, so the map draws empty.
export { detectGeo, toGeoIso, buildGeoIsoColumn, isJoinGeoKind } from "./geoDetector";
export type { GeoKind, GeoDetectionResult, GeoIsoColumn } from "./geoDetector";
// WHERE the data sits, as distinct from WHETHER it is geographic. Detecting geo and choosing a
// map FRAME are different questions: a table of European cities passes every geo test and is
// still the wrong data for a North America basemap. Numbers only — percentages and quantiles —
// so this is the same privacy class as GeoKind, which is what makes it shippable at all: the
// server never sees the coordinates these are measured from.
export { summarizeGeoExtent, summarizeCountryRegions, countryRegion, registerIso3Regions } from "./geoExtent";
export type { GeoRegion, GeoExtentSummary, CountryRegionSummary } from "./geoExtent";
// Point geocoding — a COORDINATE for a row that has none (City+State / ZIP / State),
// as opposed to geoDetector's polygon JOIN KEY. Cross-column by nature.
export {
    resolveGeoPoint, buildGeoPointColumns, isGeoPointAmbiguity, resolveAdmin1, zipToPrefix3, zipPrefixCandidates, normalizeZip5,
    normalizePlaceName, cityMatchPct, normalizeCountry, cityTagsFor,
    // The city PLACEMENT table is REGISTERED, not bundled here: detection stays in the
    // package (it decides offerability and runs in the profiler) while the coordinates
    // can be fetched. See the split note in geoPoint.ts.
    registerCityTable, isCityTableLoaded,
} from "./geoPoint";
export type { GeoPointPrecision, GeoPointResult, GeoPointColumns, GeoPointAmbiguity, GeoMapKind } from "./geoPoint";
// Which COLUMN plays which place role. The codegen response names them, but that answer
// is a HINT to be verified: a state it omits leaves city names undisambiguated, and a
// COUNTRY column in the state slot resolves "CA" to California.
export {
    resolvePointRoles, looksLikeCountryColumn, admin1MatchPct, zipMatchPct,
} from "./geoPointRoles";
export type { PointBind, PointRoleResolution } from "./geoPointRoles";
export { monthLookupFor, normalizeMonthKey } from "./monthNames";

// Pure utilities (shared so adapters can hash/stringify identically to the engine).
export { STR, SIMPLE_STRING_HASH, GET_RANDOM, isDeterministicRefusal } from "./util";

// THE INGEST FRONT DOOR — many source shapes, one measured result. Adapters no longer need
// to hand-build columns and feed addRow themselves; a decoder translates what the source
// already knows into descriptors, and the shared core does the rest. Also published as the
// "@bicharts/shape-core/ingest" subpath for consumers who want only this.
export { ingest, engineTypeForSqlType } from "./ingest";
export type {
    DataSource, IngestOptions, IngestResult, ColumnDescriptor, SqlColumnMeta, EngineDataType,
} from "./ingest";
