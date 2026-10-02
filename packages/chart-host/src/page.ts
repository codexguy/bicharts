// THE PAGE'S OWN STATE, FOR A HOST WITHOUT REACT (2026-10-02). Published as "@bicharts/chart-host/page".
//
// Page filters keyed by column values, a chart's in-chart controls as state, readers' notes as badges - the wiring a
// data app's page needs around its charts. A React app takes them from "@bicharts/chart-host/react" (useBicFilter,
// useBicControls and these same functions); a Blazor page over JS interop or a plain page takes them here.
//
// Their own entry, not the package's main one, so a host that only draws charts (the Power BI visual, the Excel
// add-in) never loads them: the main entry's eager closure is budgeted (scripts/checkEagerSize.mjs).

export { createFilter, createFilterScope, bindFilter, payloadRowReader, fromVegaInteraction,
    type Filter, type FilterScope, type FilterOptions, type FilterKey, type FilterChangeReason,
    type FilterBinding, type BindFilterOptions, type VegaInteractionEvent } from "./filterScope";
export { createControls, attachControls, readControls, type Controls, type ControlInfo, type ControlsAttachment } from "./controls";
export { noteBadges, badgeKey, notesFor, type MarkNoteLike, type NoteBadgeOptions } from "./markNotes";
