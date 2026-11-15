import { describe, it, expect } from "vitest";
import { createFilter } from "../src/filterScope";

// A PICK OF MANY KEYS IS SAID AS A COUNT, NOT A ROLL CALL. A filter's text (the chip on the page, and what its live
// region reads out) joined the display name of every key picked. A segment card or a circled group picks hundreds of
// keys, so a "Segment" chip printed about 1,020 customer names, pushed the page down, and a screen reader announced every
// one. Up to three keys still read in full; past that, the first two and how many more.

const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ CustomerID: "C" + i, CustomerName: "Customer " + i }));

describe("a filter's text stays short whatever the pick", () => {
    it("up to three keys read in full, as before", () => {
        const f = createFilter("CustomerID", { label: "Customer", display: "CustomerName" });
        f.selectRows(rowsOf(3), "click");
        expect(f.text).toBe("Customer 0, Customer 1, Customer 2");
    });

    it("more than three: the first two and how many more", () => {
        const f = createFilter("CustomerID", { label: "Segment", display: "CustomerName" });
        f.selectRows(rowsOf(1020), "click");
        expect(f.text).toBe("Customer 0, Customer 1 and 1,018 more");
        expect(f.text.length).toBeLessThan(60);
    });
});
