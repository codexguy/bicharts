import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { messageProblems, commitsToCheck, FLOOR } from "../scripts/checkCommitMessages.mjs";

// COMMIT MESSAGES SAY WHAT CHANGED, NOTHING ELSE. A pushed message cannot be cleaned without rewriting history, so the
// check runs before a commit exists (the commit-msg hook) and again on every push (ci.yml).

const SCRIPT = resolve(__dirname, "../scripts/checkCommitMessages.mjs");

describe("what a commit message may not carry", () => {
    it.each([
        ["an attribution trailer", "Fix the legend\n\nCo-Authored-By: Someone <someone@example.com>"],
        ["a trailer in any case", "Fix\n\nco-authored-by: someone"],
        ["a generated-with footer", "Fix\n\nGenerated with [Claude Code](https://claude.com/claude-code)"],
        ["an item number", "chart-host: a view-state store (item 4242)"],
        ["an item range", "Fix items 4200-4210"],
        ["an item with a hash", "Closes item #63"],
        ["a watch id", "watch W123 held"],
        ["a plan chunk", "the store, chunk B7a"],
        ["a full UUID", "from 0123abcd-4567-89ab-cdef-0123456789ab"],
        ["an agent id", "by 0123abcd-a12"],
        ["an orchestrator id", "see abcd1234-orch"],
        ["a labelled session id", "per session 0123abcd"],
        ["a labelled agent id", "agent id: 0123abcd"],
    ])("refuses %s", (_, msg) => {
        expect(messageProblems(msg).length).toBeGreaterThan(0);
    });

    it.each([
        "Move ai-charts-data-app to @bicharts/chart-host 0.6.118",
        "chart-host + shape-core 0.6.118: version only, in lockstep with chart-mcp",
        "Revert 969ece1 and 3e3a436cbb92",
        "Use #4C78A8 and #f58518 for the first two series",
        "Keep items in the list in the order they arrived",
        "A table of 12 items; the 3 items above it",
        "Item order follows the sort key",
        "contract 1.25.0, Node 20/22/24",
        "a session's view state survives a redraw",
        "The agent picks the chart; the host draws it",
    ])("accepts %j", (msg) => {
        expect(messageProblems(msg)).toEqual([]);
    });

    it("names the offending line and rule", () => {
        expect(messageProblems("Fix\n\nCo-Authored-By: x")).toEqual([
            { line: 3, rule: "trailer", why: "carries a Co-Authored-By trailer", text: "Co-Authored-By: x" },
        ]);
    });

    it("skips git's own comment lines and the verbose diff in the hook", () => {
        const msg = "Fix the legend\n# Please enter the commit message (item 12 here is git's text)\n# ------------------------ >8 ------------------------\n+Co-Authored-By: x\n";
        expect(messageProblems(msg, { gitComments: true })).toEqual([]);
        expect(messageProblems(msg).length).toBeGreaterThan(0);
    });
});

describe("the range CI checks", () => {
    let repo = "";
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: repo, encoding: "utf8" }).trim();
    const commit = (msg: string) => { git("commit", "-q", "--allow-empty", "-m", msg); return git("rev-parse", "HEAD"); };
    const run = (...a: string[]) => spawnSync("node", [SCRIPT, ...a], { cwd: repo, encoding: "utf8" });
    let clean = "", bad = "";

    beforeAll(() => {
        repo = mkdtempSync(join(tmpdir(), "commit-msgs-"));
        git("init", "-q");
        commit("root");
        clean = commit("A clean change");
        bad = commit("A change\n\nCo-Authored-By: x");
    });
    afterAll(() => rmSync(repo, { recursive: true, force: true }));

    it("lists the commits a push brings, and falls back when the start is all zeros or unknown", () => {
        expect(commitsToCheck(`${clean}..${bad}`, { cwd: repo })).toEqual([bad]);
        expect(commitsToCheck(`${"0".repeat(40)}..${bad}`, { cwd: repo })).toHaveLength(3);
        expect(commitsToCheck(`${"1".repeat(40)}..${bad}`, { cwd: repo })).toHaveLength(3);
    });

    it("exits 1 on a range holding a bad message and 0 on a clean one", () => {
        const r = run("--range", `${clean}..${bad}`);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain("Co-Authored-By trailer");
        expect(run("--range", `HEAD~2..${clean}`).status).toBe(0);
    });

    it("checks a message file the way the commit-msg hook passes it", () => {
        const f = join(repo, "MSG");
        writeFileSync(f, "Fix\n\nCo-Authored-By: x\n");
        expect(run("--file", f).status).toBe(1);
        writeFileSync(f, "Fix the legend\n# item 12 in a comment is git's\n");
        expect(run("--file", f).status).toBe(0);
    });

    it("starts after the floor: the commits before it are history, not checked", () => {
        expect(FLOOR).toMatch(/^[0-9a-f]{40}$/);
    });
});

describe("ci.yml and the hook run it", () => {
    it("ci.yml checks the pushed range with full history", () => {
        const wf = readFileSync(resolve(__dirname, "../.github/workflows/ci.yml"), "utf8");
        expect(wf).toContain("node scripts/checkCommitMessages.mjs --range");
        expect(wf).toMatch(/fetch-depth:\s*0/);
    });
    it("the commit-msg hook calls it with the message file", () => {
        expect(readFileSync(resolve(__dirname, "../.githooks/commit-msg"), "utf8")).toContain('node scripts/checkCommitMessages.mjs --file "$1"');
    });
});
