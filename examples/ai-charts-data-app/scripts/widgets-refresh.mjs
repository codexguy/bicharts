#!/usr/bin/env node
// npm run widgets:refresh [-- --apply] [--stamp] [--widget <id>]...
//
// Keeps the prebuilt widgets (src/widgets/<id>/) current with RegiaBI's chart types, without generating anything.
// For each widget in src/widgets/widgets.json it finds the newest code for the same chart type and the same columns:
//   - a widget copied from a bicharts example ("source": { "kind": "file" }) reads that example's files: from the
//     bicharts checkout this folder sits in, else from the public repository on GitHub;
//   - a widget copied from a saved generation reads widgets-incoming/<id>/, which the maintainers' exporter writes
//     (this template never reads a private database).
// It reports what changed (the code's sha256, its host contract version, its source) and changes nothing.
//
//   --apply   swap the new code in, check that it still reads the columns the field map's roles fill, record it in
//             widgets.json, then run npm run test:widgets and npm run check:render. If either fails, everything is put
//             back as it was and the command exits 1.
//   --stamp   change no code: record each widget's hashes, then run both checks and record the @bicharts/chart-host
//             version they passed on (run it after moving chart-host to a new release).
//
// A widget with nothing newer stays as it is. Generating a new version of a chart type costs model calls, so this
// never does it: it prints the step for someone to approve.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = path.join(ROOT, "src", "widgets", "widgets.json");
const RAW = "https://raw.githubusercontent.com/codexguy/bicharts/main/";
const FILES = ["chart.js", "chart.component.tsx"];

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const STAMP = argv.includes("--stamp");
const ONLY = argv.flatMap((a, i) => (a === "--widget" ? [argv[i + 1]] : []));

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const contractOf = (code) => /host contract v(\d+\.\d+\.\d+)/.exec(code)?.[1] ?? null;
/** The column names a generated component was written for (its `columns` export). */
const columnsOf = (component) => {
    const m = /export const columns = (\[[\s\S]*?\]);/.exec(component);
    return m ? JSON.parse(m[1]).map((c) => c.name) : null;
};
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

/** The bicharts checkout this template sits in (examples/<name>), when it does. */
function repoRoot() {
    const up = path.resolve(ROOT, "..", "..");
    return existsSync(path.join(up, "packages", "chart-host", "package.json")) ? up : null;
}

async function candidate(widget) {
    const src = widget.source ?? {};
    if (src.kind === "file") {
        const root = repoRoot();
        const files = {};
        for (const f of FILES) {
            if (root) files[f] = read(path.join(root, src.path, f));
            else {
                const res = await fetch(RAW + `${src.path}/${f}`);
                files[f] = res.ok ? await res.text() : null;
            }
        }
        return files[FILES[0]] && files[FILES[1]] ? { files, provenance: { source: src } } : null;
    }
    const dir = path.join(ROOT, "widgets-incoming", widget.id);
    const files = Object.fromEntries(FILES.map((f) => [f, read(path.join(dir, f))]));
    const prov = read(path.join(dir, "provenance.json"));
    return files[FILES[0]] && files[FILES[1]] ? { files, provenance: prov ? JSON.parse(prov) : {} } : null;
}

function run(cmd) {
    console.log(`\n> ${cmd}`);
    try { execSync(cmd, { cwd: ROOT, stdio: "inherit" }); return true; } catch { return false; }
}

function installedChartHost() {
    return JSON.parse(readFileSync(path.join(ROOT, "node_modules", "@bicharts", "chart-host", "package.json"), "utf8")).version;
}

function recordFacts(widget) {
    const dir = path.join(ROOT, "src", "widgets", widget.id);
    const code = read(path.join(dir, "chart.js"));
    const component = read(path.join(dir, "chart.component.tsx"));
    widget.codeSha256 = sha256(code);
    widget.componentSha256 = sha256(component);
    widget.hostContract = contractOf(code);
}

async function main() {
    const registryText = readFileSync(REGISTRY, "utf8");
    const registry = JSON.parse(registryText);
    const widgets = registry.widgets.filter((w) => !ONLY.length || ONLY.includes(w.id));
    const backups = [];
    const changed = [];
    let problems = 0;

    for (const w of widgets) {
        const dir = path.join(ROOT, "src", "widgets", w.id);
        const current = Object.fromEntries(FILES.map((f) => [f, read(path.join(dir, f))]));
        if (STAMP) { recordFacts(w); continue; }
        const next = await candidate(w);
        if (!next) {
            console.log(`- ${w.id}: nothing newer to compare (${w.source?.kind === "file" ? `${w.source.path} not found` : "no widgets-incoming/" + w.id})`);
            continue;
        }
        const oldSha = sha256(current["chart.js"] ?? ""), newSha = sha256(next.files["chart.js"]);
        const want = w.columns.map((c) => c.name), got = columnsOf(next.files["chart.component.tsx"]);
        const same = oldSha === newSha && sha256(current["chart.component.tsx"] ?? "") === sha256(next.files["chart.component.tsx"]);
        if (same) { console.log(`- ${w.id}: unchanged (${oldSha.slice(0, 12)})`); continue; }
        console.log(`* ${w.id}: ${w.chartType} changed`);
        console.log(`    code     ${oldSha.slice(0, 12)} -> ${newSha.slice(0, 12)}`);
        console.log(`    contract ${contractOf(current["chart.js"] ?? "") ?? "?"} -> ${contractOf(next.files["chart.js"]) ?? "?"}`);
        if (next.provenance.source) console.log(`    source   ${JSON.stringify(w.source)} -> ${JSON.stringify(next.provenance.source)}`);
        if (!got || got.join("\u0001") !== want.join("\u0001")) {
            console.error(`    x the new code reads [${(got ?? []).join(", ")}], the field map's roles fill [${want.join(", ")}]: not applied`);
            problems++;
            continue;
        }
        changed.push(w.id);
        if (APPLY) {
            backups.push({ dir, current });
            for (const f of FILES) writeFileSync(path.join(dir, f), next.files[f], "utf8");
            // The hashes are recomputed from the files written; the rest is where the code came from.
            Object.assign(w, Object.fromEntries(Object.entries(next.provenance).filter(([k]) => !/Sha256$/.test(k))));
            recordFacts(w);
        }
    }

    if (!APPLY && !STAMP) {
        console.log(changed.length
            ? `\n${changed.length} widget(s) have newer code. Run npm run widgets:refresh -- --apply to take it and re-check.`
            : "\nEvery widget is current with what it can be compared against.");
        console.log("A chart type whose saved code no longer suits a widget is regenerated with the RegiaBI chart server's "
            + "generate_chart; that costs model calls, so it needs someone's approval first.");
        process.exit(problems ? 1 : 0);
    }
    if (APPLY && !changed.length) { console.log("\nNothing to apply."); process.exit(problems ? 1 : 0); }

    writeFileSync(REGISTRY, JSON.stringify(registry, null, 2) + "\n", "utf8");
    const ok = run("npm run test:widgets") && run("npm run check:render");
    if (!ok) {
        for (const b of backups) for (const f of FILES) if (b.current[f] !== null) writeFileSync(path.join(b.dir, f), b.current[f], "utf8");
        writeFileSync(REGISTRY, registryText, "utf8");
        console.error("\nx A check failed: every widget file and widgets.json are back as they were.");
        process.exit(1);
    }
    const version = installedChartHost();
    for (const w of widgets) if (STAMP || changed.includes(w.id)) w.chartHost = version;
    writeFileSync(REGISTRY, JSON.stringify(registry, null, 2) + "\n", "utf8");
    console.log(`\nDone: ${STAMP ? "every widget" : changed.join(", ")} checked on @bicharts/chart-host ${version} and recorded in widgets.json.`);
    process.exit(problems ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
