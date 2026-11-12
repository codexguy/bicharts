#!/usr/bin/env node
// A commit message here says what changed and why. It carries no attribution trailer and no identifier from a
// tracker outside this repo (an item or watch number, a plan chunk, a session or agent id): a reader here cannot
// follow any of them, and once a commit is pushed its message cannot be cleaned without rewriting history.
//
// CI runs this over every commit a push or pull request brings; .githooks/commit-msg runs it before a local commit
// exists (enable with `git config core.hooksPath .githooks`).
//
//   node scripts/checkCommitMessages.mjs --file <message-file>   one message, as git's commit-msg hook passes it
//   node scripts/checkCommitMessages.mjs --range <from>..<to>     each commit in the range (CI)
//
// Exit 0 clean, 1 a message breaks a rule (each offending line is printed), 2 usage or git failure.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const RULES = [
    { id: "trailer", source: "\\bco-authored-by\\s*:", flags: "i", why: "carries a Co-Authored-By trailer" },
    { id: "ai-footer", source: "generated with \\[?claude code", flags: "i", why: "carries a generated-with footer" },
    { id: "item", source: "\\bitems?\\s*#?\\d{2,5}\\b", flags: "i", why: "carries a register item number" },
    { id: "watch", source: "\\bW\\d{3}\\b", flags: "", why: "carries a register watch id" },
    { id: "chunk", source: "\\bchunk\\s+[A-Z]\\d+[a-z]?\\b", flags: "", why: "carries a plan chunk id" },
    { id: "uuid", source: "\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b", flags: "i", why: "carries a session or other internal UUID" },
    { id: "agent-id", source: "\\b[0-9a-f]{8}-(?:a\\d{1,3}|orch)\\b", flags: "i", why: "carries an agent id" },
    { id: "session-id", source: "\\b(?:session|agent|orchestrator)(?:\\s+id)?[\\s:#=]+[0-9a-f]{8}\\b", flags: "i", why: "carries a session id" },
];

// Commits at or before this one are not checked: the check starts here and earlier history is left as it is.
export const FLOOR = "969ece1cbb923e0d1d69b327e42e1426c9f610b1";

const compiled = RULES.map((r) => ({ ...r, re: new RegExp(r.source, r.flags) }));

/**
 * One entry per offending line and rule: { line, rule, why, text }. `gitComments: true` reads the message as the
 * commit-msg hook sees it: '#' lines and everything below the scissors line are git's own text.
 */
export function messageProblems(text, { gitComments = false } = {}) {
    const out = [];
    const lines = String(text).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (gitComments) {
            if (/^# -+ >8 -+/.test(line)) break;
            if (line.startsWith("#")) continue;
        }
        for (const r of compiled) if (r.re.test(line)) out.push({ line: i + 1, rule: r.id, why: r.why, text: line.trim().slice(0, 120) });
    }
    return out;
}

const gitIn = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 }).trim();
const exists = (cwd, rev) => { try { gitIn(cwd, "cat-file", "-e", `${rev}^{commit}`); return true; } catch { return false; } };

/**
 * The commits a range brings, minus the floor and its ancestors. A range whose start this clone does not hold (a
 * force push, a new branch's all-zero "before") falls back to everything after the floor.
 */
export function commitsToCheck(range, { cwd = process.cwd() } = {}) {
    let [from, to] = String(range).split("..");
    to = to || "HEAD";
    const args = ["rev-list", to];
    if (from && !/^0+$/.test(from) && exists(cwd, from)) args.push(`^${from}`);
    if (exists(cwd, FLOOR)) args.push(`^${FLOOR}`);
    const out = gitIn(cwd, ...args);
    return out ? out.split("\n") : [];
}

function report(where, problems) {
    console.error(`${where}: the commit message breaks the commit-message rules (see scripts/checkCommitMessages.mjs):`);
    for (const p of problems) console.error(`  line ${p.line}: ${p.why} [${p.rule}]: ${p.text}`);
}

function main(argv) {
    const file = argv[0] === "--file" ? argv[1] : null;
    const range = argv[0] === "--range" ? argv[1] : null;
    if (!file && !range) { console.error("usage: checkCommitMessages.mjs --file <message-file> | --range <from>..<to>"); return 2; }
    if (file) {
        const problems = messageProblems(readFileSync(file, "utf8"), { gitComments: true });
        if (problems.length) { report("this commit", problems); return 1; }
        return 0;
    }
    const shas = commitsToCheck(range);
    let bad = 0;
    for (const sha of shas) {
        const problems = messageProblems(gitIn(process.cwd(), "log", "-1", "--format=%B", sha));
        if (problems.length) { bad++; report(`commit ${sha.slice(0, 12)}`, problems); }
    }
    console.log(`checked ${shas.length} commit message(s): ${bad ? `${bad} break the rules` : "clean"}`);
    return bad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
    try { process.exit(main(process.argv.slice(2))); }
    catch (e) { console.error(e.message); process.exit(2); }
}
