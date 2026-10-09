import { describe, it, expect } from "vitest";
import {
    orderRefusalsForDisplay, refusalIsSelectable, hasRefusalsToShow,
    qualifyRefusalHeadingFor, newQualifyRefusalGroupState,
    qualifyRefusalReason, QUALIFY_REFUSAL_UNSPECIFIED,
    refusalIsTileBound, QUALIFY_TILE_REFUSAL_CODES, QUALIFY_TOO_SMALL_HEADING,
    type QualifyRefusalRow,
} from "../packages/chart-host/src/qualifyGroups";
import * as barrel from "../packages/chart-host/src/index";

// Same shape of test as qualifyGroups: run a list through the ordering AND the boundary rule the
// way a host's render loop does, and assert on the rendered SEQUENCE. Every defect these two
// exports exist to prevent is a row in the wrong block or a control on the wrong row - neither
// throws, and both mislead about what the product will accept.
function render(rows: QualifyRefusalRow[]): string[] {
    const st = newQualifyRefusalGroupState();
    const out: string[] = [];
    for (const r of orderRefusalsForDisplay(rows)) {
        const h = qualifyRefusalHeadingFor(r, st);
        if (h) out.push(`[${h}]`);
        out.push(`${r.name}${refusalIsSelectable(r) ? "" : "*"}`);   // * = no control
    }
    return out;
}

const waivable = (name: string): QualifyRefusalRow => ({ name, reason: `${name} would be ugly` });
const veto = (name: string): QualifyRefusalRow => ({ name, reason: `${name} needs a date`, isVeto: true });

describe("refusalIsSelectable", () => {
    it("offers a control for a threshold refusal - the user may overrule our taste", () => {
        expect(refusalIsSelectable(waivable("Bullet"))).toBe(true);
    });

    it("withholds it for a veto - the required channel does not exist", () => {
        expect(refusalIsSelectable(veto("Streamgraph"))).toBe(false);
    });

    // THE DEFAULT IS THE WHOLE SAFETY PROPERTY. An older server sends no isVeto, and the wrong
    // direction here silently removes charts from readers on exactly the servers that cannot
    // tell us we are wrong.
    it("treats a missing isVeto as selectable, not as a veto", () => {
        expect(refusalIsSelectable({ name: "Bullet" })).toBe(true);
        expect(refusalIsSelectable({ name: "Bullet", isVeto: false })).toBe(true);
        expect(refusalIsSelectable({ name: "Bullet", isVeto: null })).toBe(true);
    });

    it("never claims a null or undefined row is pickable", () => {
        expect(refusalIsSelectable(null)).toBe(false);
        expect(refusalIsSelectable(undefined)).toBe(false);
    });
});

describe("orderRefusalsForDisplay", () => {
    // The reader opened this section to DO something. Putting the inert half first makes them
    // scroll past every chart they cannot have to reach the ones they can.
    it("puts every pickable row above every veto", () => {
        const out = orderRefusalsForDisplay([veto("A"), waivable("B"), veto("C"), waivable("D")]);
        expect(out.map(r => r.name)).toEqual(["B", "D", "A", "C"]);
    });

    // A partition, not a sort: the server's alphabetical order has to survive inside each block
    // or two answers over the same shape stop being diffable.
    it("keeps the server's order within each block", () => {
        const out = orderRefusalsForDisplay(
            [waivable("Alpha"), veto("Beta"), waivable("Gamma"), veto("Delta")]);
        expect(out.map(r => r.name)).toEqual(["Alpha", "Gamma", "Beta", "Delta"]);
    });

    it("drops rows with no usable name - a control labelled with nothing cannot be chosen", () => {
        const out = orderRefusalsForDisplay(
            [waivable("Bullet"), { reason: "orphan" }, { name: "   " }, { name: "" }] as QualifyRefusalRow[]);
        expect(out.map(r => r.name)).toEqual(["Bullet"]);
    });

    it("treats absent and non-array input as an empty list rather than throwing", () => {
        expect(orderRefusalsForDisplay(undefined)).toEqual([]);
        expect(orderRefusalsForDisplay(null)).toEqual([]);
        expect(orderRefusalsForDisplay([])).toEqual([]);
    });
});

describe("the rendered sequence", () => {
    it("writes one heading per block, at the boundary", () => {
        expect(render([waivable("B"), veto("A"), waivable("D"), veto("C")]))
            .toEqual(["[poorFit]", "B", "D", "[cannotDraw]", "A*", "C*"]);
    });

    // A heading for a block that never starts is the sibling of the "main"-with-no-preview bug
    // qualifyGroups already guards.
    it("writes no cannotDraw heading when nothing is vetoed", () => {
        expect(render([waivable("B"), waivable("A")]))
            .toEqual(["[poorFit]", "B", "A"]);
    });

    it("writes no poorFit heading when everything is vetoed", () => {
        expect(render([veto("B"), veto("A")]))
            .toEqual(["[cannotDraw]", "B*", "A*"]);
    });

    it("renders nothing at all for an empty refusal list", () => {
        expect(render([])).toEqual([]);
    });
});

describe("hasRefusalsToShow", () => {
    // A checkbox that reveals nothing reads as a broken control, not as an empty category.
    it("is false when there is nothing behind the toggle", () => {
        expect(hasRefusalsToShow([])).toBe(false);
        expect(hasRefusalsToShow(undefined)).toBe(false);
        expect(hasRefusalsToShow([{ reason: "no name" }] as QualifyRefusalRow[])).toBe(false);
    });

    it("is true when the section would carry a row of either kind", () => {
        expect(hasRefusalsToShow([waivable("Bullet")])).toBe(true);
        expect(hasRefusalsToShow([veto("Streamgraph")])).toBe(true);
    });
});

// A REFUSED ROW IS NEVER A BARE NAME. The server documents that a null reason is
// rendered by the client as a fallback sentence, and until this existed no host wrote one - all
// three tested `if (reason)` and skipped the element, so a chart the engine had turned down for
// a runtime signal it could not name appeared as a lone chart name under a heading that claimed
// to know why. The fallback lives beside `refusalIsSelectable` because the failure was three
// hosts each forgetting the same thing.
describe("qualifyRefusalReason", () => {
    it("uses the server's own sentence whenever there is one", () => {
        expect(qualifyRefusalReason("a Gantt chart needs a date or time field, and this data has none"))
            .toBe("a Gantt chart needs a date or time field, and this data has none");
    });

    it("never returns empty - the whole point", () => {
        for (const empty of [undefined, null, "", "   "]) {
            expect(qualifyRefusalReason(empty)).toBe(QUALIFY_REFUSAL_UNSPECIFIED);
            expect(qualifyRefusalReason(empty).trim().length).toBeGreaterThan(0);
        }
    });

    it("claims nothing it cannot support", () => {
        // It must not read as a verdict about the FIELDS - that is the false claim the bare rows
        // were making by sitting under "Poor fit for these fields" with nothing to say.
        expect(QUALIFY_REFUSAL_UNSPECIFIED).toContain("no single requirement to name");
    });

    it("lets a host localize without re-deciding", () => {
        expect(qualifyRefusalReason("", "pas un bon choix ici")).toBe("pas un bon choix ici");
        expect(qualifyRefusalReason("the server's words", "pas un bon choix ici"))
            .toBe("the server's words");
    });
});

// A REFUSAL ABOUT THE TILE IS NOT A REFUSAL ABOUT THE FIELDS.
//
// A chart type turned down because the tile is too narrow, too short, not square enough or not
// tall enough used to be filed under "Can't be drawn from the fields as bound" (a veto) or "Poor
// fit for these fields" (a waivable refusal). Both headings send the reader to rebind data that is
// fine, when the one thing that would change the answer is the size of the tile. The server tags
// each of those refusals with a stable code beside its sentence, so the split is read from the
// code and never guessed from the English.
const tile = (name: string, code: string, isVeto = true): QualifyRefusalRow =>
    ({ name, reason: `${name} needs more room`, reasonCode: code, isVeto });
const fieldsVeto = (name: string, code = "NEEDS_DATE"): QualifyRefusalRow =>
    ({ name, reason: `${name} needs a date`, reasonCode: code, isVeto: true });
const fieldsWaivable = (name: string, code = "TOO_FEW_RAW_ROWS"): QualifyRefusalRow =>
    ({ name, reason: `${name} would be ugly`, reasonCode: code, isVeto: false });

describe("refusalIsTileBound", () => {
    it("is true for each of the four tile codes", () => {
        for (const code of ["TILE_TOO_NARROW", "TILE_TOO_SHORT", "TILE_NOT_SQUARE", "TILE_NOT_TALL"]) {
            expect(refusalIsTileBound({ name: "Basic Sankey", reasonCode: code }), code).toBe(true);
        }
        expect([...QUALIFY_TILE_REFUSAL_CODES].sort())
            .toEqual(["TILE_NOT_SQUARE", "TILE_NOT_TALL", "TILE_TOO_NARROW", "TILE_TOO_SHORT"]);
    });

    // Reading any other code as a tile problem would tell a reader to resize a visual whose data is
    // what failed - the same false instruction the fields heading gives, turned around.
    it("is false for every other code, including a gate that merely mentions the viewport", () => {
        for (const code of ["NEEDS_DATE", "ROWS_CRAMPED", "GATE_REFUSAL", "DECLARED_REQUIREMENT", "TILE", "tile_too_narrow"]) {
            expect(refusalIsTileBound({ name: "Gantt chart", reasonCode: code }), code).toBe(false);
        }
    });

    // An older server sends no code at all. That must read as "not known to be about the tile",
    // which is the grouping the list always had.
    it("is false when the server sent no code", () => {
        for (const reasonCode of [undefined, null, "", "   "]) {
            expect(refusalIsTileBound({ name: "Gantt chart", reasonCode })).toBe(false);
        }
        expect(refusalIsTileBound({ name: "Gantt chart" })).toBe(false);
        expect(refusalIsTileBound(null)).toBe(false);
        expect(refusalIsTileBound(undefined)).toBe(false);
    });

    it("does not change whether the reader may pick the row", () => {
        expect(refusalIsSelectable(tile("Basic Sankey", "TILE_TOO_NARROW", true))).toBe(false);
        expect(refusalIsSelectable(tile("Basic Sankey", "TILE_TOO_NARROW", false))).toBe(true);
    });
});

describe("the tile heading", () => {
    // Every host renders these words, so they are pinned here once rather than in each host.
    it("is plain words about the tile, and says nothing about the fields", () => {
        expect(QUALIFY_TOO_SMALL_HEADING).toBe("Needs a bigger tile");
        expect(QUALIFY_TOO_SMALL_HEADING.toLowerCase()).not.toContain("field");
    });

    it("is exported from the package barrel with the helpers that go with it", () => {
        // Defined first: two undefined values are "the same object", and a missing export must fail.
        expect(barrel.QUALIFY_TOO_SMALL_HEADING).toBeTypeOf("string");
        expect(barrel.QUALIFY_TILE_REFUSAL_CODES).toBeTypeOf("object");
        expect(barrel.refusalIsTileBound).toBeTypeOf("function");
        expect(barrel.QUALIFY_TOO_SMALL_HEADING).toBe(QUALIFY_TOO_SMALL_HEADING);
        expect(barrel.QUALIFY_TILE_REFUSAL_CODES).toBe(QUALIFY_TILE_REFUSAL_CODES);
        expect(barrel.refusalIsTileBound).toBe(refusalIsTileBound);
    });
});

describe("the rendered sequence with tile refusals", () => {
    it("groups tile refusals under their own heading, apart from a fields veto", () => {
        expect(render([
            tile("Basic Sankey", "TILE_TOO_NARROW"),
            fieldsVeto("Gantt chart"),
            tile("Radar chart", "TILE_NOT_SQUARE"),
        ])).toEqual(["[tooSmall]", "Basic Sankey*", "Radar chart*", "[cannotDraw]", "Gantt chart*"]);
    });

    it("still files a fields veto under cannotDraw and a fields waivable under poorFit", () => {
        expect(render([fieldsVeto("Gantt chart"), fieldsWaivable("Bullet")]))
            .toEqual(["[poorFit]", "Bullet", "[cannotDraw]", "Gantt chart*"]);
    });

    it("gives each of the four codes the same heading", () => {
        for (const code of ["TILE_TOO_NARROW", "TILE_TOO_SHORT", "TILE_NOT_SQUARE", "TILE_NOT_TALL"]) {
            expect(render([tile("Basic Sankey", code)]), code).toEqual(["[tooSmall]", "Basic Sankey*"]);
        }
    });

    // A tile refusal the gate would honour on request stays pickable, and it is a statement about
    // the tile all the same: "Poor fit for these fields" would be a false claim over it.
    it("moves a pickable tile refusal out of poorFit and keeps its control", () => {
        expect(render([fieldsWaivable("Bullet"), tile("Basic Sankey", "TILE_TOO_NARROW", false)]))
            .toEqual(["[poorFit]", "Bullet", "[tooSmall]", "Basic Sankey"]);
    });

    it("orders poorFit, then the tile block (pickable first), then cannotDraw, keeping the server's order inside each", () => {
        expect(render([
            fieldsVeto("A"),
            tile("B", "TILE_TOO_SHORT"),
            fieldsWaivable("C"),
            tile("D", "TILE_NOT_TALL", false),
            fieldsVeto("E"),
            tile("F", "TILE_TOO_NARROW", false),
            fieldsWaivable("G"),
        ])).toEqual([
            "[poorFit]", "C", "G",
            "[tooSmall]", "D", "F", "B*",
            "[cannotDraw]", "A*", "E*",
        ]);
    });

    it("writes no tile heading when nothing is about the tile", () => {
        expect(render([fieldsWaivable("B"), fieldsVeto("A")]))
            .toEqual(["[poorFit]", "B", "[cannotDraw]", "A*"]);
    });

    it("writes the tile heading once, however many tile rows follow", () => {
        const out = render([
            tile("A", "TILE_TOO_NARROW"), tile("B", "TILE_TOO_SHORT"), tile("C", "TILE_NOT_SQUARE"), tile("D", "TILE_NOT_TALL"),
        ]);
        expect(out.filter(s => s === "[tooSmall]")).toHaveLength(1);
        expect(out).toEqual(["[tooSmall]", "A*", "B*", "C*", "D*"]);
    });

    it("renders the old two-heading list unchanged for a server that sends no codes", () => {
        expect(render([waivable("B"), veto("A"), waivable("D"), veto("C")]))
            .toEqual(["[poorFit]", "B", "D", "[cannotDraw]", "A*", "C*"]);
    });

    it("counts a tile-only list as something to show", () => {
        expect(hasRefusalsToShow([tile("Basic Sankey", "TILE_TOO_NARROW")])).toBe(true);
    });

    it("drops a nameless tile row like any other nameless row", () => {
        const out = orderRefusalsForDisplay(
            [{ reasonCode: "TILE_TOO_NARROW", isVeto: true }, tile("Basic Sankey", "TILE_TOO_NARROW")] as QualifyRefusalRow[]);
        expect(out.map(r => r.name)).toEqual(["Basic Sankey"]);
    });
});
