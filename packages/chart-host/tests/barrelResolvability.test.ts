import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as api from "../src/index";
import * as contract from "../src/contract";

// `export *` IN THE BARREL IS INVISIBLE TO A NodeNext CONSUMER, AND IT FAILS SILENTLY.
//
// A consumer compiling with TypeScript's `moduleResolution: NodeNext` resolves this package
// through `exports`, lands on dist/types/index.d.ts, and follows the re-exports inside it.
// NAMED re-exports resolve. A bare `export * from "./x"` does not - and the error a consumer
// sees names the missing SYMBOL, not the star, so it reads as "the package does not export
// this" rather than "the barrel is unreadable". Every symbol in contract.ts was unimportable
// that way for as long as the barrel used a star, which is how a consumer ended up keeping
// hand-copied constants instead of importing the ones defined here (found 2026-08-30).
//
// Vitest resolves source directly and would never notice, so a runtime import test cannot
// protect this. These two do: the first forbids the construct, the second makes sure the
// explicit list did not quietly lose anything contract.ts still defines.

const here = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(resolve(here, "..", "src", "index.ts"), "utf-8");

describe("the public barrel stays resolvable under NodeNext", () => {
    it("re-exports by NAME - never `export *`", () => {
        const stars = indexSrc
            .split("\n")
            .filter(l => /^\s*export\s*\*\s*from/.test(l));
        expect(stars, `barrel re-exports with a star:\n${stars.join("\n")}`).toEqual([]);
    });

    it("the explicit list still covers everything contract.ts exports", () => {
        // A name ADDED to contract.ts and not added to the barrel is the quiet direction:
        // typecheck stays green and the consumer just cannot see it.
        const missing = Object.keys(contract).filter(k => !(k in api));
        expect(missing, `contract.ts exports these but the barrel does not: ${missing.join(", ")}`)
            .toEqual([]);
    });

    it("and the values are the SAME objects, not copies", () => {
        expect(api.MARK_CLASS).toBe(contract.MARK_CLASS);
        expect(api.ACTIVE_TICK_CLASS).toBe(contract.ACTIVE_TICK_CLASS);
        expect(api.periodTickSuppressesFeedback).toBe(contract.periodTickSuppressesFeedback);
        expect(api.chartOwnsTimeline).toBe(contract.chartOwnsTimeline);
    });
});
