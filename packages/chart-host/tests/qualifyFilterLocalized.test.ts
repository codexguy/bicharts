// The chooser's type-ahead filter finds a chart type by its name in any language: a reader types the name they know
// ("Balken", "barras", "棒グラフ"), and the language they type is not the one the host reports.
import { describe, it, expect } from "vitest";
import { filterQualifyRows } from "../src/qualifyFilter";

const rows = [
    { name: "Bar chart (horizontal)", description: "" },
    { name: "Bar chart (vertical)", description: "" },
    { name: "Treemap", description: "" },
    { name: "Line chart", description: "" },
];
const read = (r: { name: string; description: string }) => r;
const names = (term: string) => filterQualifyRows(rows, term, read).rows.map(r => r.name);

describe("the chooser filter reads every language's chart names", () => {
    it("finds a type by a word starting its name in another language", () => {
        expect(names("balken")).toEqual(["Bar chart (horizontal)"]);                 // de "Balkendiagramm"
        expect(names("säulen")).toEqual(["Bar chart (vertical)"]);                   // de "Säulendiagramm"
        expect(filterQualifyRows(rows, "barras", read).tier).toBe("name");          // es "Gráfico de barras"
        expect(names("barras")).toEqual(["Bar chart (horizontal)", "Bar chart (vertical)"]);
        expect(names("棒グラフ")).toEqual(["Bar chart (horizontal)", "Bar chart (vertical)"]);
        expect(names("rectángulos")).toEqual(["Treemap"]);                          // es, accents as typed
        expect(names("rectangulos")).toEqual(["Treemap"]);                          // ...or not
    });
    it("the name as shown keeps its precedence, and an unknown term still finds nothing", () => {
        expect(filterQualifyRows(rows, "line", read).rows.map(r => r.name)).toEqual(["Line chart"]);
        expect(filterQualifyRows(rows, "qqqq", read).tier).toBe("none");
    });
});
