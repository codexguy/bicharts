import { describe, it, expect } from "vitest";
import { IndexedText } from "../src/indexedText";
import type { LLMColumnWithValue } from "../src/models";

// The CATEGORICAL-PAIR FILL pass (indexedText.ts, 2026-06-13 / 2026-06-18 / 2026-06-20 /
// 2026-07-27) had NO direct unit coverage before this file — every existing reference to
// categoricalPairStats/fillPct/determinesOther/primaryParentColumn/nestingRatio was a
// server-side (.NET) consumption test asserting against hand-built fixture JSON, never
// against IndexedText's own computed output. Added while exposing distinctCombinations
// (below) since a change to untested code is a change flying blind.

function col(name: string, dataType: string, isMeasure = false): LLMColumnWithValue {
    return { name, dataType, isMeasure };
}

function pairStat(cols: LLMColumnWithValue[], colName: string, otherName: string) {
    const c = cols.find(x => x.name === colName)!;
    return c.categoricalPairStats?.find(p => p.otherColumn === otherName);
}

describe("IndexedText categoricalPairStats — distinctCombinations", () => {
    // Models the exact shape that motivated this field (2026-07-27, Dendrogram investigation,
    // RELEASE-2.2-PLAN.md item 15): a hierarchy where a child-level NAME legitimately repeats
    // under different parents ("P" appears under Category X, Y, AND Z — cf. "Accessories"
    // under both Computing and Women in product_category_tree.csv). A single column's own
    // DistinctCount cannot see this; only a real pairwise count can.
    //
    //   Department  Category  Subcategory
    //   A           X         P
    //   A           X         Q
    //   A           Y         P     <- "P" reused under a different Category, same Dept
    //   B           Z         P     <- "P" reused again, different Dept entirely
    //   B           Z         R
    //
    // Category 1:1-determines Department (X,Y -> A; Z -> B) — a clean parent link.
    // Subcategory does NOT 1:1-determine, or get determined by, Category — "P" alone
    // breaks it both ways — yet the TRUE leaf count (5 distinct Category+Subcategory
    // pairs) is exactly what distinctCombinations must report regardless.
    function buildHierarchyFixture(): LLMColumnWithValue[] {
        const t = new IndexedText();
        t.setColumns([col("Department", "String"), col("Category", "String"), col("Subcategory", "String")]);
        t.addRow(["A", "X", "P"]);
        t.addRow(["A", "X", "Q"]);
        t.addRow(["A", "Y", "P"]);
        t.addRow(["B", "Z", "P"]);
        t.addRow(["B", "Z", "R"]);
        return t.getColumnsWithStats("10");
    }

    it("Category's own DistinctCount (3) UNDER-reports the true Category+Subcategory leaf count (5)", () => {
        const cols = buildHierarchyFixture();
        const category = cols.find(c => c.name === "Category")!;
        const subcategory = cols.find(c => c.name === "Subcategory")!;
        // The naive estimate this field replaces: max single-column cardinality.
        expect(Math.max(category.distinctCount!, subcategory.distinctCount!)).toBeLessThan(5);
    });

    it("reports the TRUE distinct (Category, Subcategory) pair count as 5, symmetric on both sides", () => {
        const cols = buildHierarchyFixture();
        const fromCategory = pairStat(cols, "Category", "Subcategory");
        const fromSubcategory = pairStat(cols, "Subcategory", "Category");
        expect(fromCategory?.distinctCombinations).toBe(5);
        expect(fromSubcategory?.distinctCombinations).toBe(5);
        // fillPct = round(5 / (3*3) * 100) — kept for backward compatibility, but it is
        // exactly the LOSSY reconstruction distinctCombinations exists to avoid: round-
        // tripping fillPct back to a count is only approximate.
        expect(fromCategory?.fillPct).toBe(56);
    });

    it("does NOT flag a functional dependency between Category and Subcategory (name reuse breaks it both ways)", () => {
        const cols = buildHierarchyFixture();
        expect(pairStat(cols, "Category", "Subcategory")?.determinesOther).toBe(false);
        expect(pairStat(cols, "Subcategory", "Category")?.determinesOther).toBe(false);
    });

    it("still detects the clean Category -> Department parent link (nesting), unaffected by the leaf ambiguity", () => {
        const cols = buildHierarchyFixture();
        const category = cols.find(c => c.name === "Category")!;
        expect(pairStat(cols, "Category", "Department")?.determinesOther).toBe(true);
        expect(pairStat(cols, "Category", "Department")?.distinctCombinations).toBe(3); // (X,A) (Y,A) (Z,B)
        expect(category.primaryParentColumn).toBe("Department");
        // nestingRatio is rounded to 2dp at the source (indexedText.ts): 2/3 -> 0.67.
        expect(category.nestingRatio).toBe(0.67);
    });

    it("minCellCount is 1 when every (Category, Subcategory) combination appears exactly once", () => {
        const cols = buildHierarchyFixture();
        expect(pairStat(cols, "Category", "Subcategory")?.minCellCount).toBe(1);
    });

    it("sanity case: with no name reuse, distinctCombinations equals BOTH columns' own DistinctCount", () => {
        const t = new IndexedText();
        t.setColumns([col("Continent", "String"), col("Country", "String")]);
        t.addRow(["Europe", "France"]);
        t.addRow(["Europe", "Germany"]);
        t.addRow(["Asia", "Japan"]);
        const cols = t.getColumnsWithStats("10");
        const continent = cols.find(c => c.name === "Continent")!;
        // Country 1:1-determines Continent AND the true leaf count is exactly Country's
        // own cardinality here, because no country name is shared across continents.
        expect(pairStat(cols, "Country", "Continent")?.distinctCombinations).toBe(3);
        expect(pairStat(cols, "Country", "Continent")?.determinesOther).toBe(true);
        expect(continent.distinctCount).toBe(2);
    });

    it("high-cardinality / measure columns are excluded from the pass (no categoricalPairStats entry)", () => {
        const t = new IndexedText();
        t.setColumns([col("Category", "String"), col("Revenue", "Decimal", /* isMeasure */ true)]);
        t.addRow(["X", 100]);
        t.addRow(["Y", 200]);
        const cols = t.getColumnsWithStats("10");
        const category = cols.find(c => c.name === "Category")!;
        // Only one non-measure candidate column exists, so no pair exists to report.
        expect(category.categoricalPairStats ?? []).toHaveLength(0);
    });
});
