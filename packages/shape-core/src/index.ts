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
    classifyAdditivity,
    classifyNumericValueNature,
    hostAggHint,
    isIdentifierName,
} from "./indexedText";

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
export { detectOrdinalDomain, safeDistinctValuesToShip, isOrdinalFriendlyName } from "./ordinalDetector";
export { detectFormatSignature } from "./formatDetector";
// isJoinGeoKind is PUBLIC because a host must distinguish a region-JOIN kind from a
// coordinate-feeding one: "city-name" is a GeoKind but not a join key, and building
// __geoIso__ from it nulls every row, so the map draws empty.
export { detectGeo, toGeoIso, buildGeoIsoColumn, isJoinGeoKind } from "./geoDetector";
export type { GeoKind, GeoDetectionResult, GeoIsoColumn } from "./geoDetector";
// Point geocoding — a COORDINATE for a row that has none (City+State / ZIP / State),
// as opposed to geoDetector's polygon JOIN KEY. Cross-column by nature.
export {
    resolveGeoPoint, buildGeoPointColumns, isGeoPointAmbiguity, resolveAdmin1, zipToPrefix3, zipPrefixCandidates,
    normalizePlaceName, cityMatchPct, normalizeCountry,
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
export { STR, SIMPLE_STRING_HASH, GET_RANDOM } from "./util";

// THE INGEST FRONT DOOR — many source shapes, one measured result. Adapters no longer need
// to hand-build columns and feed addRow themselves; a decoder translates what the source
// already knows into descriptors, and the shared core does the rest. Also published as the
// "@bicharts/shape-core/ingest" subpath for consumers who want only this.
export { ingest, engineTypeForSqlType } from "./ingest";
export type {
    DataSource, IngestOptions, IngestResult, ColumnDescriptor, SqlColumnMeta, EngineDataType,
} from "./ingest";
