import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as main from "../src/index";
import * as card from "../src/card";

// THE CARD'S CHROME LIVES BEHIND ITS OWN ENTRY, NOT THE MAIN ONE.
//
// The main entry's eager closure is budgeted (scripts/checkEagerSize.mjs): every host loads it, and with the chrome
// inside it the closure sat exactly on the 720 KB ceiling, so the next feature would have had to move the line. Only a
// host that mounts a card needs the chrome, so it is published as "@bicharts/chart-host/card", the way "/page" and
// "/dax" are. These four checks keep that true: the main entry must not re-grow it, and the subpath must stay built
// and exported (a missing entry would not fail any in-repo import, only a consumer's).

const pkgRoot = resolve(__dirname, "..");

describe("the selection card's chrome entry", () => {
    it("the main entry does not export the chrome (its eager closure is budgeted)", () => {
        expect("createSelectionCards" in main).toBe(false);
    });

    it("the main entry still exports the card's arithmetic, which every host's tooltip may read", () => {
        expect(typeof main.computeSelectionCard).toBe("function");
    });

    it("the card entry exports the chrome", () => {
        expect(typeof card.createSelectionCards).toBe("function");
    });

    it("package.json exports ./card and build.mjs builds it", () => {
        const pkg = JSON.parse(readFileSync(resolve(pkgRoot, "package.json"), "utf8"));
        expect(pkg.exports["./card"]).toEqual({
            types: "./dist/types/card.d.ts",
            import: "./dist/card.mjs",
            default: "./dist/card.mjs",
        });
        const build = readFileSync(resolve(pkgRoot, "build.mjs"), "utf8");
        expect(build).toMatch(/card:\s*join\(here,\s*"src\/card\.ts"\)/);
    });
});
