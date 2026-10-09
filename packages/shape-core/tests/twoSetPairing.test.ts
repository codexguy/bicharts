import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { IndexedText } from "../src/indexedText";
import { measureTwoSetPairing, TWO_SET_PAIRING_MAX_ROWS } from "../src/twoSetPairing";
import {
    col, HEADLINE, headlineColumns, headlineRows, customer, customerId, profile, carriers,
} from "./twoSetData";

// TWO-SET PAIRING (2026-10-09). Does this table hold the SAME RECORDS TWICE - once per set - keyed by
// a column that is unique inside each set? The signal is measured on the client because only the
// client holds the rows; it ships counts, a percentage, two column names and an enum, never a value.
//
// Every number asserted below is one the table was BUILT to have (see twoSetData.ts), not one read
// back off the pass: an assertion that echoes the code under test can't fail.

const pairingOf = (cols: any[], name: string) => cols.find(c => c.name === name)?.twoSetPairing;

describe("twoSetPairing - the 400-customer, two-snapshot master", () => {
    it("finds CustomerID x Snapshot and reports the counts the table was built with", () => {
        const { cols } = profile(headlineColumns(), headlineRows("Jan", "Feb"));
        const p = pairingOf(cols, "CustomerID");
        expect(p, "a keyed two-set table must be recognised").toBeDefined();
        const { identical, changed, onlyFirst, onlySecond } = HEADLINE;
        expect(p.form).toBe("long");
        expect(p.key).toBe("CustomerID");
        expect(p.discriminator).toBe("Snapshot");
        expect(p.keysBoth).toBe(identical + changed);                       // 360
        // "Jan" / "Feb" alone are no calendar period (no year), so the order is alphabetical:
        // A = Feb, B = Jan. The chart's caption is what tells the reader which way round it is.
        expect(p.setOrder).toBe("none");
        expect(p.keysA).toBe(identical + changed + onlySecond);             // Feb: 378
        expect(p.keysB).toBe(identical + changed + onlyFirst);              // Jan: 382
        expect(p.duplicateKeysA).toBe(0);
        expect(p.duplicateKeysB).toBe(0);
        expect(p.identicalPct).toBe(Math.round((identical / (identical + changed)) * 100));   // 312 of 360 = 87
        expect(p.identicalPct).toBe(87);
        expect(p.discriminatorBlankRows).toBe(0);
        expect(p.looseCollisionsA).toBe(0);
        expect(p.looseCollisionsB).toBe(0);
    });

    it("a dated discriminator is ordered by the calendar: A is the EARLIER set, whatever the spelling sorts as", () => {
        const { cols } = profile(headlineColumns(), headlineRows("Jan 2026", "Feb 2026"));
        const p = pairingOf(cols, "CustomerID");
        expect(cols.find(c => c.name === "Snapshot")!.isTemporal).toBe(true);
        expect(p.setOrder).toBe("temporal");
        // "Feb 2026" sorts before "Jan 2026" alphabetically; the calendar says Jan is first.
        expect(p.keysA).toBe(HEADLINE.identical + HEADLINE.changed + HEADLINE.onlyFirst);     // Jan: 382
        expect(p.keysB).toBe(HEADLINE.identical + HEADLINE.changed + HEADLINE.onlySecond);    // Feb: 378
        expect(p.keysBoth).toBe(360);
    });

    it("the key column and the discriminator column carry the SAME object, and no other column carries one", () => {
        const { cols } = profile(headlineColumns(), headlineRows());
        const holders = carriers(cols);
        expect(holders.map(c => c.name).sort()).toEqual(["CustomerID", "Snapshot"]);
        expect((holders[0] as any).twoSetPairing).toBe((holders[1] as any).twoSetPairing);
    });

    it("a field that moved in the second snapshot is a changed key, so identicalPct reads every column but the key and the set", () => {
        // 12 customers each changed City, CreditLimit, Balance or Name (a text, an integer, a decimal and
        // a text). Take one field out of the comparison by making it identical everywhere and the share
        // rises by exactly its 12 customers.
        const noNameMoves = headlineRows("Jan", "Feb").map(r => (r[2] as string).endsWith(" Holdings") ? [r[0], r[1], (r[2] as string).replace(" Holdings", ""), r[3], r[4], r[5]] : r);
        const { cols } = profile(headlineColumns(), noNameMoves);
        const p = pairingOf(cols, "CustomerID");
        expect(p.identicalPct).toBe(Math.round(((312 + 12) / 360) * 100));    // 324 of 360 = 90
    });
});

describe("twoSetPairing - a key that repeats inside a set", () => {
    const withRepeats = () => {
        const rows = headlineRows("Jan 2026", "Feb 2026");
        // 14 customers get a SECOND January row with a different balance (not a byte-for-byte copy).
        for (let i = 0; i < 14; i++) {
            const c = customer(i);
            rows.push([c.id, "Jan 2026", c.name, c.city, c.limit, c.balance + 1000]);
        }
        return rows;
    };

    it("is still reported - the refusal message needs the count - with the repeats on the right side", () => {
        const { cols } = profile(headlineColumns(), withRepeats());
        const p = pairingOf(cols, "CustomerID");
        expect(p, "emitted even with duplicate keys").toBeDefined();
        expect(p.duplicateKeysA).toBe(14);        // A = Jan (temporal)
        expect(p.duplicateKeysB).toBe(0);
        expect(p.keysA).toBe(382);                // distinct keys, not rows
        expect(p.keysBoth).toBe(360);
    });

    it("compares the FIRST row of a repeated key, so the repeat changes the duplicate count and not identicalPct", () => {
        const { cols } = profile(headlineColumns(), withRepeats());
        expect(pairingOf(cols, "CustomerID").identicalPct).toBe(87);
    });

    it("a row repeated byte for byte is collapsed before the pass sees it (the engine's dedup), and counted when dedup is off", () => {
        const dupRow = headlineRows("Jan 2026", "Feb 2026")[0];
        const rows = [...headlineRows("Jan 2026", "Feb 2026"), dupRow.slice()];
        expect(pairingOf(profile(headlineColumns(), rows).cols, "CustomerID").duplicateKeysA).toBe(0);
        expect(pairingOf(profile(headlineColumns(), rows, "20", { dedup: false }).cols, "CustomerID").duplicateKeysA).toBe(1);
    });
});

describe("twoSetPairing - which pair wins", () => {
    // Source = A / B; 40 rows per set.
    const tickets = () => {
        const rows: any[][] = [];
        for (let s = 0; s < 2; s++) {
            for (let i = 0; i < 40; i++) {
                // Ticket: 5 tickets in both sets, the rest one-sided. Account: 38 accounts, the same ones in
                // both sets, and two of them taken twice inside each set.
                const ticket = s === 0 ? "T" + i : (i < 5 ? "T" + i : "T1" + String(i).padStart(2, "0"));
                rows.push([ticket, "AC" + String(i % 38).padStart(2, "0"), s === 0 ? "A" : "B", s * 1000 + i]);
            }
        }
        return rows;
    };
    const cols = () => [col("Ticket", "String"), col("Account", "String"), col("Source", "String"), col("Amount", "Integer", true)];

    it("a real key with some repeats beats a narrow column whose every value repeats: pairs are ranked by the SHARE of keys that repeat", () => {
        // 30 of the 400 customers have a second row in the first snapshot, so CustomerID is not clean. A
        // five-valued Region column has only five keys that CAN repeat, and every one of them does (10 repeated
        // keys against CustomerID's 30). Ranked by the raw count Region won and the refusal would have named it;
        // by share CustomerID repeats in 30 of 760 keys and Region in 10 of 10.
        const regions = ["North", "South", "East", "West", "Central"];
        const cols = [...headlineColumns(), col("Region", "String")];
        const rows = headlineRows("Jan 2026", "Feb 2026").map(r => [...r, regions[Number(String(r[0]).slice(1)) % 5]]);
        for (let i = 0; i < 30; i++) {
            const c = customer(i);
            rows.push([c.id, "Jan 2026", c.name, c.city, c.limit, c.balance + 1000, regions[i % 5]]);
        }
        const out = profile(cols, rows).cols;
        const p = out.find(c => (c as any).twoSetPairing)!.twoSetPairing!;
        expect(p.key).toBe("CustomerID");
        expect(p.duplicateKeysA).toBe(30);
        expect(p.duplicateKeysB).toBe(0);
        expect(p.keysBoth).toBe(360);
        expect(pairingOf(out, "Region"), "Region carries nothing: it is not the winner").toBeUndefined();
    });

    it("among pairs with the same share of repeated keys, the one with the most keys in both wins, wherever it sits in the table", () => {
        // Two clean keys (no key repeats): Small shares 5 of its keys between the sets and comes first in the
        // table, Wide shares 20.
        const rows: any[][] = [];
        for (let s = 0; s < 2; s++) {
            for (let i = 0; i < 20; i++) {
                rows.push([s === 0 ? "S" + i : (i < 5 ? "S" + i : "T" + i), "W" + i, s === 0 ? "A" : "B", i + s]);
            }
        }
        const cs = [col("Small", "String"), col("Wide", "String"), col("Source", "String"), col("Amount", "Integer", true)];
        const p = profile(cs, rows).cols.find(c => (c as any).twoSetPairing)!.twoSetPairing!;
        expect(p.key).toBe("Wide");
        expect(p.keysBoth).toBe(20);
    });

    it("the pair with the smaller share of repeated keys beats the pair with the most keys in both", () => {
        const { cols: out } = profile(cols(), tickets());
        const p = out.find(c => (c as any).twoSetPairing)!.twoSetPairing!;
        // Account is in both sets 38 times over, but two of its accounts repeat inside each set; Ticket is
        // in both sets only 5 times and never repeats.
        expect(p.key).toBe("Ticket");
        expect(p.keysBoth).toBe(5);
        expect(p.duplicateKeysA + p.duplicateKeysB).toBe(0);
    });

    it("on a tie an identifier-named column comes first, wherever it sits in the table", () => {
        const rows: any[][] = [];
        for (let s = 0; s < 2; s++) for (let i = 0; i < 20; i++) rows.push(["R" + i, "C" + i, s === 0 ? "A" : "B", i + s]);
        const c = (a: string, b: string) => [col(a, "String"), col(b, "String"), col("Source", "String"), col("Amount", "Integer", true)];
        expect(profile(c("Reference", "CustomerID"), rows).cols.find(x => (x as any).twoSetPairing)!.twoSetPairing!.key).toBe("CustomerID");
        // With no identifier name to prefer, the column order decides.
        expect(profile(c("Reference", "Customer"), rows).cols.find(x => (x as any).twoSetPairing)!.twoSetPairing!.key).toBe("Reference");
    });

    it("two discriminators that split the rows identically: the first in column order", () => {
        const rows: any[][] = [];
        for (let s = 0; s < 2; s++) for (let i = 0; i < 12; i++) rows.push(["K" + i, s === 0 ? "v1" : "v2", s === 0 ? "A" : "B", i]);
        const cs = [col("Key", "String"), col("Version", "String"), col("Source", "String"), col("Amount", "Integer", true)];
        expect(profile(cs, rows).cols.find(x => (x as any).twoSetPairing)!.twoSetPairing!.discriminator).toBe("Version");
    });
});

describe("twoSetPairing - what can be a key and what can be a set", () => {
    const pair = (keys: number, perKey: (k: number, s: number) => any[], extra: any[] = []) => {
        const rows: any[][] = [];
        for (let s = 0; s < 2; s++) for (let k = 0; k < keys; k++) rows.push(perKey(k, s));
        return rows;
    };

    it("a key needs five distinct values: four is a category, not a record", () => {
        const four = pair(4, (k, s) => ["K" + k, s === 0 ? "A" : "B", k]);
        const five = pair(5, (k, s) => ["K" + k, s === 0 ? "A" : "B", k]);
        const cs = [col("Key", "String"), col("Source", "String"), col("Amount", "Integer", true)];
        expect(carriers(profile(cs, four).cols)).toEqual([]);
        expect(carriers(profile(cs, five).cols).length).toBe(2);
    });

    it("a measure is never the key, and a date column is never the key", () => {
        // 12 numeric values, unique per set: a quantity, not a key.
        const numeric = pair(12, (k, s) => [1000.5 + k, s === 0 ? "A" : "B", k]);
        const cs = [col("Amount", "Decimal", true), col("Source", "String"), col("Rank", "Integer", true)];
        expect(carriers(profile(cs, numeric).cols)).toEqual([]);
        const dated = pair(12, (k, s) => [new Date(2026, 0, 1 + k), s === 0 ? "A" : "B", k]);
        expect(carriers(profile([col("Day", "DateTime"), col("Source", "String"), col("Amount", "Integer", true)], dated).cols)).toEqual([]);
    });

    it("a set column has exactly two non-blank values: one value or three is no pair", () => {
        const one = pair(12, (k, s) => ["K" + k, "A", s]);
        const three = [...pair(12, (k, s) => ["K" + k, s === 0 ? "A" : "B", k]), ["K0", "C", 0]];
        const cs = [col("Key", "String"), col("Source", "String"), col("Amount", "Integer", true)];
        expect(carriers(profile(cs, one).cols)).toEqual([]);
        expect(carriers(profile(cs, three).cols)).toEqual([]);
    });

    it("blank set cells are counted and join neither set; they are not a third value", () => {
        const rows = pair(12, (k, s) => ["K" + k, s === 0 ? "North" : "South", k]);
        rows.push(["K0", "", 90], ["K1", null, 91], ["K2", "  ", 92]);
        const cs = [col("Key", "String"), col("Source", "String"), col("Amount", "Integer", true)];
        const { cols } = profile(cs, rows);
        const p = pairingOf(cols, "Key");
        expect(p.discriminatorBlankRows).toBe(3);
        expect(p.keysA).toBe(12);
        expect(p.keysB).toBe(12);
        expect(p.keysBoth).toBe(12);
        expect(p.duplicateKeysA + p.duplicateKeysB).toBe(0);
    });

    it("blank key cells are skipped, not paired with each other", () => {
        const rows = pair(12, (k, s) => ["K" + k, s === 0 ? "A" : "B", k]);
        rows.push(["", "A", 90], ["", "B", 91]);
        const cs = [col("Key", "String"), col("Source", "String"), col("Amount", "Integer", true)];
        const p = pairingOf(profile(cs, rows).cols, "Key");
        expect(p.keysBoth).toBe(12);
        expect(p.duplicateKeysA + p.duplicateKeysB).toBe(0);
    });

    it("nothing is emitted when no key is in both sets", () => {
        const rows: any[][] = [];
        for (let k = 0; k < 12; k++) rows.push(["A" + k, "A", k], ["B" + k, "B", k]);
        const cs = [col("Key", "String"), col("Source", "String"), col("Amount", "Integer", true)];
        expect(carriers(profile(cs, rows).cols)).toEqual([]);
    });

    it("a pair with no overlap does not hide a pair that has some: the winner is chosen among pairs that overlap", () => {
        // Part is clean (no repeats) but shares nothing between the sets; Order repeats inside the sets but
        // shares all of its values. Order is the only pairing there is.
        const rows: any[][] = [];
        for (let s = 0; s < 2; s++) for (let i = 0; i < 12; i++) rows.push([`P${s}-${i}`, "O" + (i % 6), s === 0 ? "A" : "B", i]);
        const cs = [col("Part", "String"), col("Order", "String"), col("Source", "String"), col("Amount", "Integer", true)];
        const p = pairingOf(profile(cs, rows).cols, "Order");
        expect(p).toBeDefined();
        expect(p.key).toBe("Order");
        expect(p.duplicateKeysA).toBe(6);
        expect(p.keysBoth).toBe(6);
    });

    it("a table with no candidate at all - one column, measures only, no rows - emits nothing and does not throw", () => {
        expect(carriers(profile([col("Name", "String")], [["a"], ["b"], ["c"]]).cols)).toEqual([]);
        expect(carriers(profile([col("A", "Decimal", true), col("B", "Decimal", true)], [[1, 2], [3, 4]]).cols)).toEqual([]);
        expect(carriers(profile(headlineColumns(), []).cols)).toEqual([]);
    });

    describe("the candidate caps: 8 keys, 4 sets", () => {
        // 24 rows: 12 serials, each in both sets (Serial is the only real pairing). Eight decoy columns have
        // MORE distinct values than Serial (so they rank first) and share almost nothing between the sets.
        const build = (decoys: number) => {
            const rows: any[][] = [];
            for (let r = 0; r < 24; r++) {
                const row: any[] = [];
                for (let j = 0; j < decoys; j++) row.push("x" + ((r * (j + 3)) % 23));
                row.push("S" + (r % 12), r < 12 ? "A" : "B", r);
                rows.push(row);
            }
            const cs = [...Array.from({ length: decoys }, (_, j) => col("D" + (j + 1), "String")),
                        col("Serial", "String"), col("Source", "String"), col("Amount", "Integer", true)];
            return profile(cs, rows).cols;
        };

        it("the ninth key candidate is never examined", () => {
            expect(carriers(build(7)).map(c => (c as any).twoSetPairing.key)[0]).toBe("Serial");     // Serial is the 8th: examined
            const eight = carriers(build(8));
            // Serial is the 9th: the pairing found, if any, is a decoy's
            expect(eight.length === 0 || (eight[0] as any).twoSetPairing.key !== "Serial").toBe(true);
        });

        it("the fifth set candidate is never examined", () => {
            // Flag columns put a key's two rows (r and r + 12) in the SAME flag value, so no key is ever in
            // both sets under a flag; Source is the one real split.
            const build2 = (flags: number) => {
                const rows: any[][] = [];
                for (let r = 0; r < 24; r++) {
                    const row: any[] = [];
                    for (let j = 0; j < flags; j++) row.push(r % 2 === 0 ? "x" : "y");
                    row.push("K" + (r % 12), r < 12 ? "A" : "B", r);
                    rows.push(row);
                }
                const cs = [...Array.from({ length: flags }, (_, j) => col("Flag" + (j + 1), "String")),
                            col("Key", "String"), col("Source", "String"), col("Amount", "Integer", true)];
                return profile(cs, rows).cols;
            };
            expect(carriers(build2(3)).length, "Source is the 4th set candidate: examined").toBe(2);
            expect(carriers(build2(4)).length, "Source is the 5th set candidate: not examined").toBe(0);
        });
    });
});

describe("twoSetPairing - identicalPct", () => {
    const base = (k: number): any[] => ["K" + k, k % 5 === 0 ? "alpha" : "beta", k, "note"];
    const cs = () => [col("Key", "String"), col("Name", "String"), col("Qty", "Decimal", true), col("Note", "String")];
    const run = (overrides: Record<number, (second: any[]) => void>, keys = 6) => {
        const rows: any[][] = [];
        for (let k = 0; k < keys; k++) {
            const first = ["K" + k, "n" + k, 10 + k, "x"];
            const second = first.slice();
            overrides[k]?.(second);
            rows.push([...first.slice(0, 1), "A", ...first.slice(1)], [...second.slice(0, 1), "B", ...second.slice(1)]);
        }
        const c = [col("Key", "String"), col("Source", "String"), col("Name", "String"), col("Qty", "Decimal", true), col("Note", "String")];
        return pairingOf(profile(c, rows).cols, "Key");
    };

    it("text is compared on the trimmed cell, numbers exactly, blank equals blank and differs from a value", () => {
        const p = run({
            1: s => { s[1] = "  n1  "; },                       // whitespace only: the engine trims it, so equal
            2: s => { s[2] = 12.5; },                           // 12 -> 12.5: a change
            3: s => { s[3] = ""; },                             // "x" -> blank: a change
            4: s => { s[3] = null; },                           // "x" -> null: a change
            5: s => { s[2] = 15 + 1e-9; },                      // exact comparison: a change, however small
        });
        // K0 and K1 identical; K2..K5 changed: 2 of 6.
        expect(p.keysBoth).toBe(6);
        expect(p.identicalPct).toBe(33);
    });

    it("the comparison trims text itself, so a caller whose cells are untrimmed still reads them as equal", () => {
        const rows: any[][] = [];
        for (let k = 0; k < 6; k++) rows.push(["K" + k, "A", "  n  "], ["K" + k, "B", "n"]);
        const base = { isMeasure: false, isTemporal: false, isDatePart: false, identifierNamed: false };
        const found = measureTwoSetPairing({
            rows,
            columns: [
                { ...base, name: "Key", values: new Set(rows.map(r => r[0])), distinct: 6 },
                { ...base, name: "Source", values: new Set(["A", "B"]), distinct: 2 },
                { ...base, name: "Name", values: null, distinct: 2 },
            ],
            text: v => v == null ? "" : String(v),
        });
        expect(found!.pairing.keysBoth).toBe(6);
        expect(found!.pairing.identicalPct).toBe(100);
    });

    it("two blanks are equal", () => {
        const rows: any[][] = [];
        for (let k = 0; k < 8; k++) rows.push(["K" + k, "A", null], ["K" + k, "B", ""]);
        const c = [col("Key", "String"), col("Source", "String"), col("Note", "String")];
        expect(pairingOf(profile(c, rows).cols, "Key").identicalPct).toBe(100);
    });

    it("100 means EVERY key is identical and 0 means NONE is, however close the rounding", () => {
        const many = 400;
        const oneOff = run({ 0: s => { s[3] = "y"; } }, many);
        expect(oneOff.identicalPct, "399 of 400 rounds to 100 but is not all of them").toBe(99);
        const oneSame = run(Object.fromEntries(Array.from({ length: many - 1 }, (_, i) => [i + 1, (s: any[]) => { s[3] = "y"; }])), many);
        expect(oneSame.identicalPct, "1 of 400 rounds to 0 but is not none of them").toBe(1);
        expect(run({}, many).identicalPct).toBe(100);
        expect(run(Object.fromEntries(Array.from({ length: many }, (_, i) => [i, (s: any[]) => { s[3] = "y"; }])), many).identicalPct).toBe(0);
    });

    it("with no field to compare every key in both sets is identical", () => {
        const rows: any[][] = [];
        for (let s = 0; s < 2; s++) for (let k = 0; k < 6; k++) rows.push(["K" + k, s === 0 ? "A" : "B"]);
        const p = pairingOf(profile([col("Key", "String"), col("Source", "String")], rows).cols, "Key");
        expect(p.keysBoth).toBe(6);
        expect(p.identicalPct).toBe(100);
    });
});

describe("twoSetPairing - looseCollisions", () => {
    const rows = () => {
        const out: any[][] = [];
        const jan = ["ACME Inc.", "Acme, Inc", "Borealis LLC", "Cobalt Corp", "Delta Ltd", "N/A", "NA"];
        const feb = ["ACME Inc.", "Borealis LLC", "Cobalt Corp", "Delta Ltd", "Echo SA"];
        jan.forEach((k, i) => out.push([k, "Jan 2026", i]));
        feb.forEach((k, i) => out.push([k, "Feb 2026", i]));
        return out;
    };

    it("counts the keys of a set that merge under the loose key; a code under four characters is never loosened", () => {
        const p = pairingOf(profile([col("Company", "String"), col("Period", "String"), col("Amount", "Integer", true)], rows()).cols, "Company");
        expect(p.setOrder).toBe("temporal");
        // "ACME Inc." and "Acme, Inc" are one company to the loose key; "N/A" and "NA" would be "na" and
        // are left apart by the length floor (the Namibia rule).
        expect(p.looseCollisionsA).toBe(2);
        expect(p.looseCollisionsB).toBe(0);
        expect(p.duplicateKeysA).toBe(0);
    });
});

describe("twoSetPairing - the row ceiling", () => {
    it("is 500,000 rows", () => {
        expect(TWO_SET_PAIRING_MAX_ROWS).toBe(500_000);
    });

    it("above it nothing is computed: the rows are not even read", () => {
        const cols = [
            { name: "Key", values: null, distinct: 100, isMeasure: false, isTemporal: false, isDatePart: false, identifierNamed: false },
            { name: "Source", values: new Set(["A", "B"]), distinct: 2, isMeasure: false, isTemporal: false, isDatePart: false, identifierNamed: false },
        ];
        // A sparse array of the right length: reading any cell would yield undefined and no pairing, so the
        // proof that it was never read is that the pass answered null WITHOUT building anything.
        const tooMany = new Array(TWO_SET_PAIRING_MAX_ROWS + 1);
        let read = 0;
        const input = { rows: tooMany, columns: cols, text: (v: any) => { read++; return v == null ? "" : String(v); } };
        expect(measureTwoSetPairing(input)).toBeNull();
        expect(read).toBe(0);
    });

    it("through the engine: 500,001 rows of a table that WOULD pair emit nothing", { timeout: 120_000 }, () => {
        const t = new IndexedText();
        t.dedupRows = false;
        t.setColumns([col("Key", "String"), col("Source", "String")]);
        for (let r = 0; r < TWO_SET_PAIRING_MAX_ROWS + 1; r++) t.addRow(["K" + (r % 997), r % 2 === 0 ? "A" : "B"]);
        expect(carriers(t.getColumnsWithStats("20")), "a key in both sets: it would pair at 500,000 rows").toEqual([]);
        const small = new IndexedText();
        small.dedupRows = false;
        small.setColumns([col("Key", "String"), col("Source", "String")]);
        for (let r = 0; r < 20_000; r++) small.addRow(["K" + (r % 997), r % 2 === 0 ? "A" : "B"]);
        expect(carriers(small.getColumnsWithStats("20")).length, "the same table under the ceiling pairs").toBe(2);
    });
});

describe("twoSetPairing ships at every privacy tier, and carries no value", () => {
    const enums = new Set(["long", "temporal", "none"]);
    const strings = (v: unknown, out: string[] = []): string[] => {
        if (typeof v === "string") out.push(v);
        else if (Array.isArray(v)) v.forEach(x => strings(x, out));
        else if (v && typeof v === "object") Object.values(v as object).forEach(x => strings(x, out));
        return out;
    };
    const FIELDS = ["discriminator", "discriminatorBlankRows", "duplicateKeysA", "duplicateKeysB", "form", "identicalPct",
                    "key", "keysA", "keysB", "keysBoth", "looseCollisionsA", "looseCollisionsB", "setOrder"];

    for (const labels of [["Jan", "Feb"], ["Jan 2026", "Feb 2026"]] as const) {
        const top = profile(headlineColumns(), headlineRows(labels[0], labels[1]), "20").cols;
        for (const pl of ["0", "10"]) {
            it(`present at privacy level ${pl} exactly as at 20 (${labels[0]} / ${labels[1]})`, () => {
                const cols = profile(headlineColumns(), headlineRows(labels[0], labels[1]), pl).cols;
                expect(pairingOf(cols, "CustomerID")).toBeDefined();
                expect(pairingOf(cols, "CustomerID")).toEqual(pairingOf(top, "CustomerID"));
                expect(pairingOf(cols, "Snapshot")).toBe(pairingOf(cols, "CustomerID"));
            });
        }
        it(`every string in the object is a column name or an enum literal, and the fields are the declared ones (${labels[0]} / ${labels[1]})`, () => {
            const names = new Set(headlineColumns().map(c => c.name));
            const p = pairingOf(top, "CustomerID");
            expect(Object.keys(p).sort()).toEqual(FIELDS);
            for (const s of strings(p)) expect(names.has(s) || enums.has(s), `"${s}" is neither a column name nor an enum literal`).toBe(true);
            // No value of any column can be read back out of it.
            const wire = JSON.stringify(p);
            for (const needle of [labels[0], labels[1], customerId(0), customerId(399), customer(7).name, "Boston"]) {
                expect(wire.includes(needle), `${needle} leaked`).toBe(false);
            }
            for (const [k, v] of Object.entries(p)) {
                if (typeof v === "number") expect(Number.isInteger(v) && v >= 0, `${k} is a count or an integer percentage`).toBe(true);
            }
            expect(p.identicalPct).toBeLessThanOrEqual(100);
        });
    }

    it("a recompute at another tier re-measures: a pairing the new rows no longer support does not survive it", () => {
        const { it: engine, cols } = profile(headlineColumns(), headlineRows("Jan 2026", "Feb 2026"), "20");
        expect(carriers(cols).length).toBe(2);
        engine.addRow(["C9999", "Mar 2026", "Third Set", "Boston", 1000, 1.5]);   // Snapshot is now three-valued
        const again = engine.getColumnsWithStats("10");
        expect(carriers(again)).toEqual([]);
        expect(again.some(c => "twoSetPairing" in c)).toBe(false);
    });
});

describe("twoSetPairing - the wire fixture the server reads", () => {
    // The server (site/TestProject) deserializes this file into its own model: the file is what both
    // sides agree on. It is the engine's own output, narrowed to the columns' identifying fields and the
    // pairing; set TWO_SET_FIXTURE_WRITE=1 to rewrite it after a deliberate change.
    const path = new URL("./fixtures/two-set-pairing.json", import.meta.url);
    const wireColumns = (cols: any[]) => cols.map(c => ({
        name: c.name, dataType: c.dataType, isMeasure: c.isMeasure, isTemporal: c.isTemporal, distinctCount: c.distinctCount,
        valueNature: c.valueNature, ...(c.twoSetPairing ? { twoSetPairing: c.twoSetPairing } : {}),
    }));
    const produce = () => ({
        _why: "Engine output for the 400-customer, two-snapshot master (312 identical, 48 changed, 22 only in January, 18 only in "
            + "February), as the client puts it on the wire. `headline` labels the snapshots Jan / Feb (no calendar period, so the "
            + "order is alphabetical); `headlineDated` labels them Jan 2026 / Feb 2026 (a calendar period, so A is the earlier).",
        headline: wireColumns(profile(headlineColumns(), headlineRows("Jan", "Feb"), "20").cols),
        headlineDated: wireColumns(profile(headlineColumns(), headlineRows("Jan 2026", "Feb 2026"), "20").cols),
    });

    it("is what the engine produces today", () => {
        const now = produce();
        if (process.env.TWO_SET_FIXTURE_WRITE) fs.writeFileSync(path, JSON.stringify(now, null, 2) + "\n");
        expect(JSON.parse(fs.readFileSync(path, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
    });
});
