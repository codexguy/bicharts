// THE RENDERER ADAPTERS. Published as "@bicharts/chart-host/adapters".
//
// The adapter interface (its types are also exported from the main entry, which costs nothing at run time) and the
// binding for D3. Their own entry, not the package's main one: the core does not consume an adapter yet, so a host that
// only draws charts loads none of it, and the main entry's eager closure is budgeted (scripts/checkEagerSize.mjs).

export { NULL_ADAPTER } from "./types";
export type {
    AdapterEvent, AdapterHit, AdapterScene, MarkHandle, MarkInfo, MarkRole, PaintRequest, RendererAdapter,
    AdapterId, RowTable,
} from "./types";
export { createD3Adapter } from "./d3";
