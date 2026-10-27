// PROVINCE MAPS, as their own entry ("@bicharts/chart-host/provinces"), off the main entry's eager closure: a host that
// draws no province map loads none of it. Everything a host needs to draw one:
//   * loadAdmin1Lookup / needsAdmin1Lookup - the hosted admin-1 lookup, fetched once before profiling a table that could
//     use it, so province columns and city rollups are measured;
//   * loadProvinceGeo / geoKeyFor - a continent's province geometry, and the key a province map renders against;
//   * provinceLocator - placing a coordinate in its province, for the binding's `locate`.
// And the two steps every host repeats, shared: prepareProvinceProfile (before profiling) and provinceBinding (the
// render's binding, with shape-core's buildProvinceIsoColumn as its join).
export { loadProvinceGeo, geoKeyFor, provinceLocator } from "./provinceGeo";
export { loadAdmin1Lookup, needsAdmin1Lookup, ADMIN1_LOOKUP_PATH } from "./admin1LookupLoader";
export { prepareProvinceProfile, provinceBinding, geoKeyOfFields, type ProvinceProfile, type GeoFields } from "./provinceHost";
