import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// RELEASE DISCIPLINE, ENFORCED BY THE GATE RATHER THAN REMEMBERED.
//
// The consumers pin themselves to the version they were built against, and their suites fail
// when the installed copy drifts. What none of them can see is the failure that happens HERE:
// package source edited and committed, version never bumped, tag never pushed — so nothing
// publishes, every consumer stays consistently on the old build, and every downstream check
// passes while the fix quietly does not exist anywhere but this repo. That has happened (a
// consumer once ran sixteen versions behind), and "remember to publish" is not a mechanism.
//
// The invariant a unit test CAN hold, offline, from git alone:
//
//     if packages/*/src differs from the last release tag, the version must be ABOVE it.
//
// A bumped version with an unpushed tag still cannot publish — but a bump is visible in
// review, sits in the tag-shaped hole `npm run verify` green-lights, and the consumers'
// installed==declared checks refuse the phantom version until it actually reaches npm. The
// silent branch of the failure is the one this closes.

const root = resolve(__dirname, "..");

function git(...args: string[]): string {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function pkgVersion(name: string): string {
    return JSON.parse(readFileSync(resolve(root, "packages", name, "package.json"), "utf8")).version;
}

/** Highest v-tag by semver, not `git describe` — describe picks the nearest by GRAPH, which
 *  after a merge can be an older release on a side branch. */
function lastReleaseTag(): string | null {
    const tags = git("tag", "--list", "v*").split("\n").filter(Boolean);
    if (!tags.length) return null;
    return tags.sort((a, b) => cmpSemver(a.slice(1), b.slice(1)))[tags.length - 1];
}

function cmpSemver(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d) return d;
    }
    return 0;
}

describe("release discipline", () => {
    it("the two packages version in LOCKSTEP", () => {
        // They are bundled into each other and released together; a split pair is a
        // half-applied upgrade whose missing half is never the obvious one.
        expect(pkgVersion("chart-host")).toBe(pkgVersion("shape-core"));
    });

    it("PACKAGE SOURCE CHANGED SINCE THE LAST RELEASE => THE VERSION IS BUMPED", () => {
        const tag = lastReleaseTag();
        if (!tag) return;  // a fresh clone with no tags fetched has nothing to compare against

        // Committed AND uncommitted changes both count — the working tree is what a
        // forgotten bump ships from.
        const changed = git("diff", "--name-only", tag, "--", "packages/chart-host/src", "packages/shape-core/src")
            .split("\n").filter(Boolean);
        if (changed.length === 0) return;  // nothing shareable moved; the version may rest

        const current = pkgVersion("chart-host");
        expect(
            cmpSemver(current, tag.slice(1)) > 0,
            `packages/*/src differs from ${tag} (${changed.length} file(s), e.g. ${changed[0]}) `
            + `but the version is still ${current}. Bump BOTH packages, verify, commit, tag `
            + `v<version>, and push the commit AND the tag — the consumers cannot see a fix `
            + `that was never published, and their own checks all pass while it isn't.`,
        ).toBe(true);
    });

    it("the current version has a matching tag OR is the pending next release", () => {
        // Catches the OTHER half-state: version bumped, tag never created. The bump alone
        // publishes nothing — Actions runs on the tag — so a version that is neither tagged
        // nor ahead of every tag is a release that stalled halfway.
        const tag = lastReleaseTag();
        if (!tag) return;
        const current = pkgVersion("chart-host");
        const tagged = git("tag", "--list", "v" + current) !== "";
        expect(
            tagged || cmpSemver(current, tag.slice(1)) > 0,
            `version ${current} is behind the newest tag ${tag} and untagged — a rollback `
            + `nobody meant, or a bad merge of package.json`,
        ).toBe(true);
    });
});
