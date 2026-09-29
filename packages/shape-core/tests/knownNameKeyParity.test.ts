import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { looseNameKey } from "../src/knownNameKey";

// The shared known-name fixture: every input with the key looseNameKey returns for it. The server's twin reads the same
// file, so a change to the function that moves a key fails here first, and the fixture is regenerated from this function.
interface Fixture { cases: { input: string; key: string }[] }
const fixture: Fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "known_name_loose_key_parity.json"), "utf-8"));

describe("known-name loose key - the shared fixture", () => {
    it("carries enough cases to mean something", () => {
        expect(fixture.cases.length).toBeGreaterThanOrEqual(60);
    });

    it.each(fixture.cases.map(c => [c.input, c.key] as const))("%j", (input, key) => {
        expect(looseNameKey(input)).toBe(key);
    });
});
