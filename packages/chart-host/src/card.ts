// THE SELECTION CARD'S CHROME. Published as "@bicharts/chart-host/card".
//
// Where the card opens (beside the click, inside the frame), pinning with an oldest-out limit, dismissal (its close
// control, an empty selection, Esc) and the compact card a small tile gets. One implementation for every host that
// mounts a card, so they cannot disagree; the arithmetic it shows is computeSelectionCard, from the main entry.
//
// Their own entry, not the package's main one, so a host that never mounts a card loads none of it: the main entry's
// eager closure is budgeted (scripts/checkEagerSize.mjs).

export { createSelectionCards, type SelectionCards, type SelectionCardsDeps } from "./selectionCardChrome";
