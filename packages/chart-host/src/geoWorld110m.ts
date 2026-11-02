// THE WORLD GEOMETRY, AS EVERY ROUTE SERVES IT: the generated asset with its join keys made whole.
//
// Natural Earth keys three features by name because it gives them no ISO code: "Kosovo", "N. Cyprus" and "Somaliland".
// Kosovo has a code a row can carry, the user-assigned XKX (the one the EU, the IMF and the World Bank use), and
// shape-core resolves a row naming Kosovo to it. A polygon still keyed "Kosovo" would then take no row: a choropleth
// would count the row matched and color nothing, where it used to say the region was unmatched. So its feature is keyed
// XKX here. The other two have no code a row could carry and keep their names. A new collection, the generated one
// untouched, so a rebuilt asset that already carries XKX passes through unchanged.
import { WORLD_110M as GENERATED } from "./geoWorld110m.generated";

const JOIN_KEY_FOR_NAME: Readonly<Record<string, string>> = { Kosovo: "XKX" };

export const WORLD_110M: any = {
    ...GENERATED,
    features: (GENERATED.features as any[]).map(f => {
        const to = JOIN_KEY_FOR_NAME[f?.id];
        return to ? { ...f, id: to } : f;
    }),
};
