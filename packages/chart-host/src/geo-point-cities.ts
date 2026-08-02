// SINGLE-ASSET entry point: the city PLACEMENT table, and nothing else.
//
// Since 2026-08-02 the gazetteer ships in two pieces. The DETECTION index (name + scope,
// no coordinates) stays inside shape-core because isKnownCity runs synchronously in the
// profiler and its answer decides which chart types are OFFERED — that must not depend on
// a fetch. The PLACEMENT table (coordinates, 93 KB gz) is registered by the host:
//
//   import { CITY_PACKED } from "@bicharts/chart-host/geo/point-cities";
//   registerCityTable(CITY_PACKED);           // bundle it — fine for a server or a web app
//
//   // or, where the package size IS the constraint (the Power BI visual):
//   registerCityTable(await (await fetch("/geo/point-cities.json")).json());
//
// Until something registers it, city lookups fall through to ZIP-3 / state / country and
// REPORT that coarser precision. Nothing guesses, and nothing throws.
// Re-declared rather than re-exported: shape-core is BUNDLED into this package, not a
// dependency of it, so a shipped .d.ts that names "@bicharts/shape-core/..." would point a
// consumer at a package they never installed. typeSelfContainment.test.ts enforces that.
import { CITY_PACKED as PACKED } from "@bicharts/shape-core/geoPointCities";

export const CITY_PACKED: string = PACKED;
