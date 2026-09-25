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
export type { IValueCollection, ColumnNameAlias } from "./indexedText";

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

// TEMPORAL CADENCE (2026-09-12) — how a time column's values are SPACED and where
// they stop. Public because the measurement is reusable standalone, and because
// DEFAULT_GAP_FACTOR is a measured constant a consumer may need to reason about. The POLICY
// that turns a hole into a broken line is the consumer's; this package only measures.
export { measureCadence, parseTemporalPoint, DEFAULT_GAP_FACTOR, MAX_RUN_BOUNDS } from "./cadence";
export type { TemporalCadence, TemporalRun } from "./cadence";

// PER-SERIES COMPLETENESS (2026-09-24) — which series of a time axis start late, end early or have
// holes, measured over one entity-like key. IndexedText attaches it to the time column as
// `seriesCompleteness`; the pieces are public so a host measuring rows of its own reaches the same
// answer, and so the key rule can be asked why it refused a column.
export {
    measureSeriesCompleteness, pickSeriesColumn, seriesKeyVerdict,
    SERIES_COMPLETENESS_MAX_LISTED, SERIES_COMPLETENESS_MIN_FILL, SERIES_KEY_MAX_DISTINCT,
} from "./seriesCompleteness";
export type {
    SeriesCompleteness, SeriesCoverage, SeriesKeyCandidate, SeriesKeyVerdict,
} from "./seriesCompleteness";

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
    // An automatic aggregation's English name, recomposed from its language-invariant query name,
    // for cached code generated in another UI language - see IndexedText.aliasesForCode.
    englishImplicitAggNames,
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
    LLMResultNotice,
    GetLicenseStatusResult,
} from "./models";

// Column-detail helpers.
// The gazetteer-quality knob and the "what counts as blank" rule, exported so a host or a
// sibling classifier tunes ONE constant rather than keeping its own copy.
export { ROLE_MATCH_PCT, CITY_ROLE_MATCH_PCT, isBlankLike } from "./matchQuality";
export { detectOrdinalDomain, safeDistinctValuesToShip, isOrdinalFriendlyName } from "./ordinalDetector";
export { detectFormatSignature } from "./formatDetector";
// The one place a date STRING becomes a Date. Exported because a host that reads text dates of
// its own must use the same rule, or its profile and ours disagree about what day it is.
//
// `wholeDayFrame` is the companion READ-side rule and is exported for the same reason: it names
// which clock a Date is midnight on, and anything that renders a date - not just anything that
// profiles one - has to ask the same question or it prints a day the cell never showed.
export { parseDateStable, wholeDayFrame, wholeDayIso } from "./util";
// And the write-side consequence: a date column that arrived at the reader's LOCAL midnight is re-anchored
// to the UTC midnight of its day before a host serialises it, so a chart's UTC reads print the cell's day
// east of Greenwich too.
export { localMidnightToUtcDay, localMidnightDateColumns, normalizeLocalMidnightDates } from "./util";
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
export { STR, SIMPLE_STRING_HASH, GET_RANDOM, isDeterministicRefusal, nameWords, DEFAULT_TEMPERATURE } from "./util";

// THE LANGUAGE LIST (2026-09-24): the thirty Tier 1 languages every vocabulary and string catalog
// is checked against, and the ONE reading of a host's culture tag. A host resolves its culture
// here rather than cutting a tag to two letters itself - that cut is how `nb` met a table keyed
// `no` and `zh-TW` read as Simplified. Data vocabulary never keys on this: a Spanish model sits in
// an English UI, so vocabulary is the union of all thirty.
export {
    SUPPORTED_LANGUAGES, SUPPORTED_LANGUAGE_CODES, supportedLanguage, resolveLanguage,
    VOCABULARY_ONLY_LANGUAGES, VOCABULARY_LANGUAGE_CODES, vocabularyLanguage,
} from "./languages";
export type {
    SupportedLanguage, SupportedLanguageCode, LanguageScript, ResolvedLanguage,
    VocabularyLanguage, VocabularyLanguageCode, VocabularyOnlyLanguageCode,
} from "./languages";

// THE DATE-LEVEL LEXICON (2026-09-25): what a date hierarchy's Year / Quarter / Month / Day levels
// are called in every language a model is written in, with the one-language rule and a Gregorian-
// year guard for the languages whose data counts years in another calendar. For the step that
// BUILDS a date; never for anything that feeds a saved identity.
export {
    DATE_LEVEL_NAMES, DATE_LEVEL_LANGUAGES, DATE_LEVEL_NON_GREGORIAN_LANGUAGES,
    DATE_LEVEL_GREGORIAN_YEAR_MIN, DATE_LEVEL_GREGORIAN_YEAR_MAX, dateLevelPart, dateLevelYearAdmits,
} from "./vocab/dateLevels";
export type { DateLevelPart, DateLevelEntry } from "./vocab/dateLevels";

// CALENDAR WORDS IN A COLUMN NAME (2026-09-25): the year and the cycles (hour, weekday, month,
// quarter, week, season) in the other languages, read where the English words find nothing - the
// canonical copy the server's cycle and year tests are generated from.
export {
    YEAR_WORDS, CYCLE_WORDS, CYCLE_MEMBERS, calendarWordIn, localizedYearWordIn, localizedCycleIn,
} from "./vocab/calendarWords";
export type { CycleConcept, CalendarWordHit } from "./vocab/calendarWords";

// PERIOD CODES (2026-09-25): how every language labels a quarter, a half-year and a week (`T1 2024`,
// `1. Quartal`, `KW 12`, `第1四半期`, `1분기`), read one language per series with English labels joining,
// and a letter code counted only beside a year. The canonical copy the server's period readers are
// generated from.
export {
    PERIOD_CODE_FORMS, PERIOD_ORDINALS, PERIOD_UNFOLDED, PERIOD_CODE_MEMBERS, readPeriodCode, periodCodeSeries,
} from "./vocab/periodCodes";
export type { PeriodCodeGrain, PeriodCodeForms, PeriodCodeReading, PeriodCodeSeries } from "./vocab/periodCodes";

// IDENTIFIER WORDS (2026-09-25): the other languages' words that make a column an identifier
// (`Kundennummer`, `Código Postal`, `客户编号`), each in the position its language puts it - read by
// isIdentifierName where the English words find nothing.
export {
    IDENTIFIER_WORDS, IDENTIFIER_HEAD_INITIAL, IDENTIFIER_UNFOLDED, localizedIdentifierWordIn,
} from "./vocab/identifierWords";
export type { IdentifierWordHit } from "./vocab/identifierWords";

// THE NAME READER (2026-09-24): one reading of a column name in every script - the words (any
// script's letters, marks and digits; camelCase on any cased script), one length-preserving fold,
// and the views a vocabulary needs where whole words are blind: compound suffixes, glued prefixes
// and unsegmented scripts. `nameWords` above is its word view. Korean compounds get the suffix view
// through a Hangul token (2026-09-25); `nameLetterRuns` is the letters-only boundary older readers use.
export {
    foldName, readName, matchNameToken, wordEndsWith, gluedPrefixStems, unsegmentedRuns,
    hasUnsegmentedScript, hangulWordEndsWith, nameLetterRuns, COMPOUND_MIN_STEM, GLUED_STEM_MIN, SUBSTRING_MIN,
    HANGUL_MIN_STEM,
} from "./nameReader";
export type { NameReading, NameTokenView } from "./nameReader";

// NUMBERS WRITTEN AS TEXT (2026-09-24): which character is a column's decimal point, decided from
// its values with the culture as the tiebreak. `ingest` applies it; exported for a host that still
// parses text of its own, which must read `12,5` the same way.
export { detectDecimalSeparator, decimalSeparatorOf, parseNumberText } from "./numberText";
export type { DecimalSeparator } from "./numberText";

// THE INGEST FRONT DOOR — many source shapes, one measured result. Adapters no longer need
// to hand-build columns and feed addRow themselves; a decoder translates what the source
// already knows into descriptors, and the shared core does the rest. Also published as the
// "@bicharts/shape-core/ingest" subpath for consumers who want only this.
export { ingest, engineTypeForSqlType } from "./ingest";
export type {
    DataSource, IngestOptions, IngestResult, ColumnDescriptor, SqlColumnMeta, EngineDataType,
} from "./ingest";

// WHAT A HOST WOULD SEND, minus the reader's own credentials - the shared redactor behind
// "See what's sent" in the Power BI visual and the Excel task pane. Pure: object in, object
// out, no rendering, because the two hosts render it very differently (a 95% overlay vs a
// narrow inline block). See payloadPreview.ts for why it SUBTRACTS from a real payload
// rather than re-listing the fields it believes are sent.
export { payloadPreview, PREVIEW_OMITTED_FIELDS } from "./payloadPreview";
export type { PayloadPreviewOptions } from "./payloadPreview";

// WHICH COLUMNS A CHART'S CODE READS - asked by a host before its drift warning names a column
// the reader removed. Both hosts share the one rule so they agree on what counts as a use. See
// codeColumnReads.ts for why code that picks columns by role or position keeps every name.
export { codeReadsColumn, codeReadsColumnsByRoleOrPosition, columnsTheCodeReads } from "./codeColumnReads";

// FREEMIUM ENTITLEMENT WALLS A HOST CAN ANTICIPATE (2026-09-17). The column cap is ENFORCED only on
// the server; these let a host refuse in 0 ms in the SERVER'S OWN WORDS rather than pay a round
// trip that a production request proved can be lost in transport and read as "the service is down". The
// sentence is never authored in a host - see freemiumCaps.ts for the two rules that keeps.
export { freemiumColumnsOverCap, freemiumColumnCapRefusal, freemiumDateHierarchyClauses } from "./freemiumCaps";
export type { FreemiumColumnCapStatus, FreemiumDateGroupColumn } from "./freemiumCaps";

// HOST SERVICES, the wire-level half (2026-09-24). Shared client logic reaches its host only
// through services the host constructs - a signer, a transport, credentials, a clock - and
// branches on whether an optional service is present, never on which host it runs in. Types
// only; each host's adapter is proven by the matching check in "@bicharts/shape-core/testing".
export type {
    WireSigner, WireTransport, WireResponse, CredentialTriple, CredentialSource,
    ViewportSource, Clock, DiagnosticEntry, DiagnosticsSink, RendererId, WireServices,
} from "./host/services";

// THE REQUEST WIRE (2026-09-24): the envelope every signed request travels in, the signature over
// it, and a response field read in either casing. The host passes its signing key; the envelope,
// its one pinned compressor and the algorithm are these, once.
export { encodePayload, gzipWireText, keyedSigner, messageSignature, readWireField } from "./wire";
export type { GzipText } from "./wire";
// READING A GENERATE RESPONSE (2026-09-24): the NDJSON stream or the buffered JSON body, by one set
// of rules - the content type decides first, an unknown line is skipped, no result is a loud throw.
export { readGenerateStream, isNdjsonContentType, wireResponseFromFetch } from "./wireStream";
export type { OnStage } from "./wireStream";
// WHAT A RESPONSE SAYS (2026-09-24): one field list each for a generate result, a qualify answer
// and a review verdict, every field in either casing, typed - fields only, the policy stays in the host.
export { parseGenerateResponse, parseQualifyResponse, parseReviewVerdict } from "./wireParse";
export type {
    ParsedGenerateResponse, ParsedQualifyResponse, ParsedQualifyChart, ParsedQualifyRefusal,
    ParsedReviewVerdict, ParsedNotice, WirePointBinding, WirePointColumns,
} from "./wireParse";
// THE SERVER'S MESSAGE CODES A HOST DECIDES BY (2026-09-25): every server message carries a stable
// code beside its text, and a host branches on the code - never the text, which is due to be
// translated. The progress stage, the freemium state a painted chart contradicts, the stale-secret
// licence answer, the retry flag.
export {
    PROGRESS_STAGE_IDS, progressStageOf, FREEMIUM_ATTEMPT_SPENT, CLIENT_SECRET_MISMATCH, FREEMIUM_COLUMN_CAP,
    answerIsRetryable,
} from "./messageCodes";
export type { ProgressStageId } from "./messageCodes";
// BUILDING A GENERATE REQUEST (2026-09-25): the concerns every host applies by the same rule, each a
// function returning the fields it owns - the host places them where it always did.
export {
    viewportFields, maxNonMeasureCardinality, credentialFields, resolveFetchVersion, fetchFields, capabilityFields,
    retryFields, leafCardinalityField, shortlistIsStale, offeredShortlistFor,
} from "./wireBuild";
export type {
    ViewportFields, CredentialFields, FetchRequest, FetchFields, CapabilityFields, RetryFields,
} from "./wireBuild";
// ARE THESE THE SAME FIELDS? (2026-09-25): the schema identity a host compares column sets by in
// memory - name, role and type family per column. Never a persisted fingerprint; see schemaIdentity.ts.
export { schemaIdentity, schemaIdentityKey, schemaTypeFamily } from "./schemaIdentity";
export type { SchemaIdentityColumn } from "./schemaIdentity";
// THE CLIENT TELEMETRY VOCABULARY (2026-09-25): the severity levels, a client message's field names,
// the event kinds and the event-count line - stated once for every host. See telemetry.ts.
export {
    SEV_INFO, SEV_WARNING, SEV_ERROR, SEV_USER_PRESENTED, CLIENT_EVENT_KINDS, isEventLogCode, eventLogLine,
    TELEMETRY_TIMEOUT_MS, TELEMETRY_TIMEOUT_DEV_MS,
} from "./telemetry";
export type { ClientMessage } from "./telemetry";
// SENDING IT (2026-09-25): the encode, sign and post of both telemetry channels, over the host's
// transport - never a throw, a failure only ever reported to the host. See telemetryClient.ts.
export { createTelemetryClient } from "./telemetryClient";
export type { TelemetryClient, TelemetryServices, TelemetryEnv, TelemetryFailure, TelemetryChannel } from "./telemetryClient";
// A WIRE TRANSPORT OVER THE HOST'S FETCH (2026-09-25): the contract's semantics - a status resolves,
// the deadline covers the whole exchange - for any host that has a fetch. See fetchTransport.ts.
export { fetchTransport } from "./fetchTransport";
export type { FetchFunction, FetchTransportOptions } from "./fetchTransport";
// THE GENERATE CLIENT (2026-09-25): the post and the read of a generation, a what-fits list, an image
// review and an example chart, over the host's transport - each resolving as an answer, an HTTP status
// or a transport failure that the host words and acts on. See generateClient.ts.
export { createGenerateClient, HTTP_BODY_START_CHARS } from "./generateClient";
export type {
    GenerateClient, GenerateClientServices, GenerateClientEnv, GenerateCall, WireOutcome, AnswerOutcome,
    HttpOutcome, TransportOutcome, WireCallOptions, GenerateCallOptions, QualifyCallOptions,
} from "./generateClient";
