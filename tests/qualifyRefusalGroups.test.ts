import { describe, it, expect } from "vitest";
import {
    orderRefusalsForDisplay, refusalIsSelectable, hasRefusalsToShow,
    qualifyRefusalHeadingFor, newQualifyRefusalGroupState,
    qualifyRefusalReason, QUALIFY_REFUSAL_UNSPECIFIED,
    type QualifyRefusalRow,
} from "../packages/chart-host/src/qualifyGroups";

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
