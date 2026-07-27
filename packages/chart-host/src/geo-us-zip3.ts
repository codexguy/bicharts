// SINGLE-ASSET entry point: US ZIP-3 polygons (feature.id = 3-digit prefix; the archetype
// joins __geoIso__.slice(0,3) against it). The largest asset by a wide margin — ~810 KB raw,
// more than the other two together — which is exactly why it is worth separating.
// See geo-world.ts for why the per-asset entries exist.
// Pair with registerGeoAsset("us-zip3", US_ZIP3).
export { US_ZIP3 } from "./geoUsZip3.generated";
