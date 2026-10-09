// Deterministic long-form two-set tables for the twoSetPairing tests (no randomness, no real data).
//
// A "customer master" taken twice: the same customers in two snapshots. The headline table has 400
// customers - 312 whose two rows are identical, 48 whose rows differ in exactly one field, 22 only in
// the first snapshot and 18 only in the second - so every count the pass reports has a number the
// table was BUILT to have, not one read back off the pass.
import { IndexedText } from "../src/indexedText";
import type { LLMColumnWithValue } from "../src/models";

export const col = (name: string, dataType: string, isMeasure = false): LLMColumnWithValue => ({ name, dataType, isMeasure });

export const HEADLINE = { identical: 312, changed: 48, onlyFirst: 22, onlySecond: 18 } as const;

const CITIES = ["Boston", "Denver", "Austin", "Seattle", "Chicago", "Atlanta", "Phoenix", "Portland"];
const FIRST = ["Alder", "Birch", "Cedar", "Dune", "Elm", "Fjord", "Grove", "Harbor", "Iris", "Juniper"];
const LAST = ["Works", "Supply", "Trading", "Partners", "Freight", "Foods", "Textiles", "Tools", "Labs", "Mills"];

export const customerId = (i: number) => "C" + String(i).padStart(4, "0");

interface Customer { id: string; name: string; city: string; limit: number; balance: number }

export function customer(i: number): Customer {
    return {
        id: customerId(i),
        name: `${FIRST[i % 10]} ${LAST[(i * 7) % 10]} ${i}`,
        city: CITIES[i % 8],
        limit: 1000 + ((i * 37) % 50) * 100,
        balance: ((i * 91) % 977) + 0.25,
    };
}

/** The same customer after a month: ONE field moved, chosen by the customer's number. */
export function changedCustomer(i: number): Customer {
    const c = customer(i);
    switch (i % 4) {
        case 0: return { ...c, city: CITIES[(i + 3) % 8] };
        case 1: return { ...c, limit: c.limit + 500 };
        case 2: return { ...c, balance: c.balance + 12.5 };
        default: return { ...c, name: c.name + " Holdings" };
    }
}

const rowOf = (c: Customer, snapshot: string) => [c.id, snapshot, c.name, c.city, c.limit, c.balance];

export const headlineColumns = (): LLMColumnWithValue[] => [
    col("CustomerID", "String"), col("Snapshot", "String"), col("Name", "String"), col("City", "String"),
    col("CreditLimit", "Integer", true), col("Balance", "Decimal", true),
];

/**
 * The headline table's rows. `first` / `second` are the two snapshot labels; the first label's rows are
 * written first for each customer. `extra` rows are appended untouched (a test's own additions).
 */
export function headlineRows(first = "Jan", second = "Feb"): any[][] {
    const rows: any[][] = [];
    const { identical, changed, onlyFirst, onlySecond } = HEADLINE;
    let i = 0;
    for (; i < identical; i++) { rows.push(rowOf(customer(i), first), rowOf(customer(i), second)); }
    for (let k = 0; k < changed; k++, i++) { rows.push(rowOf(customer(i), first), rowOf(changedCustomer(i), second)); }
    for (let k = 0; k < onlyFirst; k++, i++) rows.push(rowOf(customer(i), first));
    for (let k = 0; k < onlySecond; k++, i++) rows.push(rowOf(customer(i), second));
    return rows;
}

export function profile(cols: LLMColumnWithValue[], rows: any[][], level = "20", opts: { dedup?: boolean; locale?: string } = {}) {
    const it = new IndexedText();
    if (opts.dedup === false) it.dedupRows = false;
    it.setColumns(cols);
    for (const r of rows) it.addRow(r);
    return { it, cols: it.getColumnsWithStats(level, opts.locale) };
}

/** The two columns that carry a pairing, by name. */
export function carriers(cols: LLMColumnWithValue[]): LLMColumnWithValue[] {
    return cols.filter(c => (c as any).twoSetPairing !== undefined);
}
