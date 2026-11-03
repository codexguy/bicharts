import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// WHICH WAY IS GOOD IS ONE SHARED FIELD. The visual, the Excel add-in and chart-mcp send the reader's setting as
// clientHints.directionOfGood, a list of { measure, better }; LLMClientHints declares it so all three send it from one
// type. tests/typecheck/directionOfGoodHint.ts checks the shape at compile time; this checks the typecheck includes it.
describe("LLMClientHints carries directionOfGood", () => {
    it("the compile-time file exists and the package typecheck includes it", () => {
        const tsconfig = JSON.parse(readFileSync(resolve(__dirname, "../tsconfig.json"), "utf8"));
        expect(tsconfig.include).toContain("tests/typecheck/**/*.ts");
        const file = readFileSync(resolve(__dirname, "typecheck/directionOfGoodHint.ts"), "utf8");
        expect(file).toContain("directionOfGood: [{ measure: \"Bookings\", better: \"higher\" }");
    });
});
