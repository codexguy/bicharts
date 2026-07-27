// SINGLE-ASSET entry point: the world 110m geometry, and nothing else.
//
// Exists so a host can bundle a SUBSET of the geometry. Importing "@bicharts/chart-host/geo"
// pulls all three generated assets (~1.3 MB raw) because geoForKind statically references
// each one, so a host that wanted the world map but not the 810 KB ZIP-3 table had no way to
// say so. Pair with registerGeoAsset("world", WORLD_110M) to seed the shared cache, after
// which geoFromCache serves every country-* kind AND the derived north-america basemap.
export { WORLD_110M } from "./geoWorld110m.generated";
