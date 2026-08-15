// Measure what a consumer of @bicharts/chart-host EAGERLY downloads.
//
// Naively checking the size of dist/index.mjs proves nothing: the build uses code
// splitting, so index.mjs is a 1.8 KB re-export shim in front of ~1.6 MB of chunks.
// The number that matters is the transitive closure of STATIC imports — dynamic
// import() is what geoLazy.ts uses to keep the ~1.3 MB of map geometry off the wire
// for the vast majority of charts, which are not maps.
//
// So: walk `import`/`export ... from` (static) and stop at `import(...)` (lazy).
//
// Usage: node scripts/checkEagerSize.mjs [entry] [limitKB]

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

// The default is a TRIPWIRE for geometry reaching the eager path, not a size target. Most of
// the closure is the place-name gazetteer, which is eager by design and grows as the tables
// improve; the smallest map asset is ~228 KB, so any ceiling below (closure + 228) still
// catches one being statically imported. Keep the headroom generous — a budget that goes red
// on ordinary growth stops being read, and a gate nobody reads catches nothing.
const entry = resolve(process.argv[2] ?? "packages/chart-host/dist/index.mjs");
const limitKB = Number(process.argv[3] ?? 560);

if (!existsSync(entry)) {
    console.error(`no build at ${entry} — run \`npm run build\` first`);
    process.exit(1);
}

// Static forms only. `import("x")` has a paren after the keyword and is deliberately
// excluded by requiring a quote or a from-clause instead.
const STATIC = /(?:^|[;\n}])\s*(?:import|export)\s+(?:[^"';()]*?\sfrom\s*)?["']([^"']+)["']/g;

const seen = new Set();
const stack = [entry];
let total = 0;
const files = [];

while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    const src = readFileSync(file, "utf8");
    const bytes = Buffer.byteLength(src);
    total += bytes;
    files.push([bytes, file]);

    for (const m of src.matchAll(STATIC)) {
        const spec = m[1];
        if (!spec.startsWith(".")) continue; // bare specifier = peer/external, not our weight
        const next = resolve(dirname(file), spec);
        if (existsSync(next)) stack.push(next);
    }
}

files.sort((a, b) => b[0] - a[0]);
console.log(`eager closure from ${entry}:`);
for (const [b, f] of files.slice(0, 8)) console.log(`  ${String(Math.round(b / 1024)).padStart(6)} KB  ${f.split(/[\\/]/).pop()}`);
console.log(`  ${"-".repeat(30)}`);
console.log(`  ${String(Math.round(total / 1024)).padStart(6)} KB  TOTAL across ${files.length} file(s)`);

// Sanity floor: a walker that resolves nothing would report the 1.8 KB shim and pass
// every threshold forever. If the closure is implausibly small, the walker is broken —
// which is a louder failure than the one it exists to catch.
if (total < 20_000) {
    console.error(`\nFAIL: closure of ${total} bytes is too small to be real — the import walker is not resolving.`);
    process.exit(1);
}

if (total > limitKB * 1024) {
    console.error(`\nFAIL: ${Math.round(total / 1024)} KB eagerly loaded, limit ${limitKB} KB.`);
    console.error("Something that should be behind a dynamic import() is now statically imported.");
    console.error("The usual cause: a top-level `import` of a geo asset instead of loadGeo() in geoLazy.ts.");
    process.exit(1);
}

console.log(`\nOK: under the ${limitKB} KB eager-load budget.`);
