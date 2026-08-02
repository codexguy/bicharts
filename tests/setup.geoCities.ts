// Register the city PLACEMENT table for every test file.
//
// Since 2026-08-02 the gazetteer ships in two pieces: a bundled DETECTION index (which
// decides offerability and therefore cannot wait on a fetch) and a PLACEMENT table that
// hosts register — the Power BI visual fetches it, every other host imports it. Tests are
// a host like any other, and this is their registration.
//
// A test that wants the UNREGISTERED state (the visual before its fetch lands, or an
// air-gapped session) calls registerCityTable("") itself and restores afterwards; see
// geoPointSplit.test.ts.
import { registerCityTable } from "../packages/shape-core/src/geoPoint";
import { CITY_PACKED } from "../packages/shape-core/src/geoPointCities.generated";

registerCityTable(CITY_PACKED);
