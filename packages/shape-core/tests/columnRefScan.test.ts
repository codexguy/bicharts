import { describe, it, expect } from "vitest";
import {
    missingHardColumnRefs, nameProbeIsGuarded, isColumnContextRef, HOST_SYNTHETIC_COLUMNS, guardColumnNames,
} from "../src/index";

// The scanner a host runs before drawing cached chart code: which columns does the code look up
// by name, in a statement that reads the columns collection, without handling their absence -
// and which of those are gone now. See columnRefScan.ts for the two shapes it deliberately does
// not count (an optional probe, a data-value comparison).

const PRESENT = ["UserID", "Calories Burned", "Steps", "Year", "Quarter", "Month", "Day"];

// A chart that resolves its columns by name and probes for an optional 'Date', using it only
// when found. The reader's fields carry a date hierarchy and no 'Date' column.
const GUARDED_DATE_PROBE = `
  const ciUserID = columns.findIndex(c => c.name === 'UserID');
  const ciCal    = columns.findIndex(c => c.name === 'Calories Burned');
  const ciSteps  = columns.findIndex(c => c.name === 'Steps');
  const ciDate   = columns.findIndex(c => c.name === 'Date');
  rows.forEach((r, i) => {
    if (ciDate >= 0) {
      const d = new Date(r[ciDate]);
      if (!isNaN(d)) { series.push(d); }
    }
    total += r[ciCal];
  });
`;

describe("missingHardColumnRefs - guarded probes are not dependencies", () => {
    it("a >=0-guarded probe for an absent column does NOT block", () => {
        expect(missingHardColumnRefs(GUARDED_DATE_PROBE, PRESENT)).toEqual([]);
    });

    it("an UNGUARDED lookup of an absent column still blocks", () => {
        const code = `
          const ciRegion = columns.findIndex(c => c.name === 'Region');
          rows.forEach(r => { sum += r[ciRegion]; });   // no -1 check anywhere
        `;
        expect(missingHardColumnRefs(code, PRESENT)).toEqual(["Region"]);
    });

    it("an INLINE (unassigned) lookup of an absent column blocks - it cannot be proven optional", () => {
        const code = `const v = rows.map(r => r[columns.findIndex(c => c.name === 'Region')]);`;
        expect(missingHardColumnRefs(code, PRESENT)).toEqual(["Region"]);
    });

    it("one guarded assignment plus one inline use of the SAME absent name stays hard", () => {
        const code = `
          const ci = columns.findIndex(c => c.name === 'Region');
          if (ci >= 0) draw(ci);
          const w = columns.find(c => c.name === 'Region');
        `;
        expect(missingHardColumnRefs(code, PRESENT)).toEqual(["Region"]);
    });

    it("every guard spelling counts: !== -1, === -1 (early-out), > -1", () => {
        for (const guard of ["if (ci !== -1) use(ci);", "if (ci === -1) return; use(ci);", "if (ci > -1) use(ci);"]) {
            const code = `const ci = columns.findIndex(c => c.name === 'Region'); ${guard}`;
            expect(missingHardColumnRefs(code, PRESENT), guard).toEqual([]);
        }
    });

    it("present columns never report, guarded or not", () => {
        const code = `
          const a = columns.findIndex(c => c.name === 'UserID');
          rows.forEach(r => t += r[a]);
        `;
        expect(missingHardColumnRefs(code, PRESENT)).toEqual([]);
    });

    it("no name-based lookups at all -> empty (nothing to assess, so nothing blocks)", () => {
        expect(missingHardColumnRefs(`const x = rows.length;`, PRESENT)).toEqual([]);
    });

    it("empty code -> empty", () => {
        expect(missingHardColumnRefs("", PRESENT)).toEqual([]);
    });

    it("the __rowIdx__ contract column is always present", () => {
        const code = `const ri = columns.findIndex(c => c.name === '__rowIdx__'); use(r[ri]);`;
        expect(missingHardColumnRefs(code, PRESENT)).toEqual([]);
    });
});

describe("missingHardColumnRefs - data-value .name compares are not column refs", () => {
    // A hierarchy pass that relabels a group's single-member 'Other' bucket, beside two real
    // column probes.
    const RELABEL_PASS = `
      const catIdx = cols.findIndex(c => c.name === 'Category');
      const divIdx = cols.findIndex(c => c.name === 'Division');
      for (const leaf of leaves) {
        if (leaf.name === 'Other' && leaf.otherMembers.size === 1) {
          leaf.name = [...leaf.otherMembers][0];
        }
      }
    `;

    it("leaf.name === 'Other' on a data node does NOT block", () => {
        expect(missingHardColumnRefs(RELABEL_PASS, PRESENT.concat(["Category", "Division"]))).toEqual([]);
    });

    it("the real column probes in the same code still register (an absent column blocks)", () => {
        expect(missingHardColumnRefs(RELABEL_PASS, PRESENT.concat(["Category"]))).toEqual(["Division"]);
    });

    it("legend-entry / node-name compares with no columns receiver never block", () => {
        const code = `
          nodes.forEach(n => { if (n.name === 'Root') n.hidden = true; });
          const sel = items.filter(d => d.name === 'Selected Group');
        `;
        expect(missingHardColumnRefs(code, PRESENT)).toEqual([]);
    });

    it("a data compare of the SAME name as a guarded probe does not poison the probe", () => {
        const code = `
          const ciDate = columns.findIndex(c => c.name === 'Date');
          if (ciDate >= 0) draw(ciDate);
          if (leaf.name === 'Date') leaf.bold = true;
        `;
        expect(missingHardColumnRefs(code, PRESENT)).toEqual([]);
    });

    it("multi-line findIndex chains keep their columns receiver (newlines do not cut the window)", () => {
        const code = "const ci = data.columns\n    .findIndex(c =>\n      c.name === 'Region');\n  use(r[ci]);";
        expect(missingHardColumnRefs(code, PRESENT)).toEqual(["Region"]);
    });

    it("color()/colorMaps in the window does not qualify a data compare as a column ref", () => {
        const code = `
          rect.attr('fill', d => colorMaps[d.group] || color(d.group));
          if (d.name === 'Other') tip.show(d);
        `;
        expect(missingHardColumnRefs(code, PRESENT)).toEqual([]);
    });

    it("isColumnContextRef: a columns statement does not leak past its semicolon", () => {
        const code = `const ci = cols.findIndex(c => c.name === 'Category'); if (leaf.name === 'Other') x();`;
        expect(isColumnContextRef(code, code.indexOf(".name === 'Other'"))).toBe(false);
        expect(isColumnContextRef(code, code.indexOf(".name === 'Category'"))).toBe(true);
    });

    it("isColumnContextRef: the window is bounded at 240 characters before the match", () => {
        const code = "columns;" + "x".repeat(10) + " columns " + "y".repeat(300) + " d.name === 'A'";
        expect(isColumnContextRef(code, code.indexOf(".name"))).toBe(false);
    });
});

describe("nameProbeIsGuarded - edges", () => {
    it("a guard on a DIFFERENT variable does not vouch for the probe", () => {
        const code = `
          const ci = columns.findIndex(c => c.name === 'Region');
          const other = 3;
          if (other >= 0) use(ci);
        `;
        expect(nameProbeIsGuarded(code, "Region")).toBe(false);
    });

    it("regex metacharacters in column names are handled", () => {
        const code = `const ci = columns.findIndex(c => c.name === 'Cost (USD)'); if (ci >= 0) use(ci);`;
        expect(nameProbeIsGuarded(code, "Cost (USD)")).toBe(true);
        expect(missingHardColumnRefs(code, PRESENT)).toEqual([]);
    });

    it("a name with no column-context lookup is not a guarded probe", () => {
        expect(nameProbeIsGuarded("if (leaf.name === 'Other') x();", "Other")).toBe(false);
    });
});

describe("host-synthetic columns", () => {
    it("names every column the payload builder appends after the reader's fields", () => {
        // A column missing from this list reads as "a column the reader removed" when generated
        // code references it, which misdiagnoses a runtime hiccup as a schema change and spends a
        // paid regeneration. __geoPrecision__ joined the point-map payload after the other four.
        expect([...HOST_SYNTHETIC_COLUMNS]).toEqual(["__rowIdx__", "__geoIso__", "__geoLat__", "__geoLon__", "__geoPrecision__"]);
    });

    it("never count as missing, even unguarded", () => {
        for (const name of HOST_SYNTHETIC_COLUMNS) {
            const code = `const i = columns.findIndex(c => c.name === '${name}'); return rows[0][i];`;
            expect(missingHardColumnRefs(code, ["City"]), name).toEqual([]);
        }
    });

    it("a point map's guarded coordinate probes do not trip the scanner when the binding is absent", () => {
        const code = `
          const { columns, rows } = data;
          const gLatIdx = columns.findIndex(c => c.name === '__geoLat__');
          const gLonIdx = columns.findIndex(c => c.name === '__geoLon__');
          const latIdx = gLatIdx >= 0 ? gLatIdx : columns.findIndex((c, i) => isLat(c));
          const lonIdx = gLonIdx >= 0 ? gLonIdx : columns.findIndex((c, i) => isLon(c));
          const catCands = columns.filter(c => c.name !== '__rowIdx__' && c.name !== '__geoIso__');
        `;
        expect(missingHardColumnRefs(code, ["City", "State", "Sum of Sales"])).toEqual([]);
    });

    it("the -1 guard still decides for ORDINARY columns", () => {
        const unguarded = "const i = columns.findIndex(c => c.name === 'Region'); return rows[0][i];";
        expect(missingHardColumnRefs(unguarded, ["City"])).toContain("Region");
        const guarded = "const i = columns.findIndex(c => c.name === 'Region'); return i >= 0 ? rows[0][i] : null;";
        expect(missingHardColumnRefs(guarded, ["City"])).toEqual([]);
    });
});

describe("guardColumnNames - the names a cached chart's lookups can find", () => {
    const cols = [{ name: "Region" }, { name: "Sum of Revenue" }];

    it("no index -> no names", () => {
        expect(guardColumnNames(null, "x")).toEqual([]);
        expect(guardColumnNames(undefined, "x")).toEqual([]);
    });

    it("an index without aliasesForCode gives its live names", () => {
        expect(guardColumnNames({ getColumns: () => cols }, "code")).toEqual(["Region", "Sum of Revenue"]);
    });

    it("empty code gives the live names without asking for aliases", () => {
        let asked = 0;
        const index = { getColumns: () => cols, aliasesForCode: () => { asked++; return [{ alias: "X" }]; } };
        expect(guardColumnNames(index, "")).toEqual(["Region", "Sum of Revenue"]);
        expect(asked).toBe(0);
    });

    it("adds each second name the index answers to for THIS code, so the guard finds it present", () => {
        const code = "const i = columns.findIndex(c => c.name === 'Sum of Sum of Revenue'); use(rows[0][i]);";
        const index = {
            getColumns: () => cols,
            aliasesForCode: (c: string | null | undefined) => (c === code ? [{ alias: "Sum of Sum of Revenue" }] : []),
        };
        const names = guardColumnNames(index, code);
        expect(names).toEqual(["Region", "Sum of Revenue", "Sum of Sum of Revenue"]);
        expect(missingHardColumnRefs(code, names)).toEqual([]);
        expect(missingHardColumnRefs(code, guardColumnNames({ getColumns: () => cols }, code))).toEqual(["Sum of Sum of Revenue"]);
    });

    it("an index whose getColumns answers nothing gives no names", () => {
        expect(guardColumnNames({ getColumns: () => null as unknown as Array<{ name: string }> }, "x")).toEqual([]);
    });
});
