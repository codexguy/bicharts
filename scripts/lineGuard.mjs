// ONE NUMBER LINE, ENFORCED AT THE TAG.
//
// @bicharts/shape-core, @bicharts/chart-host and @bicharts/chart-mcp share one version line.
// chart-mcp can be released on its own, and when it is, these two packages skip that number.
// So a tag here must be ABOVE every version chart-mcp has published (rule "above"); chart-mcp's
// own release refuses a number below these packages' (rule "not-below"). A version that is
// already published for the tagged package is a re-run and always passes - the publish step
// skips it.
//
//   node scripts/lineGuard.mjs <version> --self <package> --other <package> --rule above|not-below
//   (release.yml runs it with --self @bicharts/shape-core --other @bicharts/chart-mcp --rule above)

import { pathToFileURL } from "node:url";

const plain = (v) => /^\d+\.\d+\.\d+$/.test(v);
const cmp = (a, b) => {
    const x = a.split(".").map(Number), y = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
};

async function versionsOf(name, fetchImpl) {
    const res = await fetchImpl(`https://registry.npmjs.org/${name}`, { headers: { accept: "application/vnd.npm.install-v1+json" } });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`npm answered HTTP ${res.status} for ${name}`);
    return Object.keys((await res.json()).versions ?? {}).filter(plain);
}

/** @returns {Promise<{ok: boolean, reason: string}>} */
export async function lineGuard({ version, self, other, rule, fetchImpl = fetch }) {
    if (!plain(version)) return { ok: false, reason: `"${version}" is not a plain x.y.z version` };
    if (rule !== "above" && rule !== "not-below") throw new Error(`unknown rule "${rule}"`);
    if ((await versionsOf(self, fetchImpl)).includes(version)) {
        return { ok: true, reason: `${self}@${version} is already published - a re-run, which the publish step skips` };
    }
    const top = (await versionsOf(other, fetchImpl)).reduce((m, v) => (m === null || cmp(v, m) > 0 ? v : m), null);
    if (top === null) return { ok: true, reason: `${other} has published nothing yet` };
    const d = cmp(version, top);
    if (rule === "above" && d <= 0) {
        const [a, b, c] = top.split(".").map(Number);
        return { ok: false, reason: `${version} is not above ${other} ${top}, the line's highest version. `
            + `The line shares one number and ${other} has taken ${top}: release ${a}.${b}.${c + 1}.` };
    }
    if (rule === "not-below" && d < 0) {
        return { ok: false, reason: `${version} is below ${other} ${top}. The line shares one number: `
            + `release ${self} at ${top} with it, or above it on its own.` };
    }
    return { ok: true, reason: `${version} is ${rule === "above" ? "above" : "not below"} ${other} ${top} - on the line` };
}

export function parseArgs(argv) {
    const [version, ...rest] = argv;
    const opt = {};
    for (let i = 0; i < rest.length; i += 2) {
        const k = rest[i]?.replace(/^--/, "");
        if (!["self", "other", "rule"].includes(k) || rest[i + 1] === undefined) throw new Error(`bad argument "${rest[i]}"`);
        opt[k] = rest[i + 1];
    }
    if (!version || !opt.self || !opt.other || !opt.rule) throw new Error("usage: lineGuard.mjs <version> --self <pkg> --other <pkg> --rule above|not-below");
    return { version, ...opt };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    const r = await lineGuard(parseArgs(process.argv.slice(2)));
    console.log(r.ok ? `OK  ${r.reason}` : `::error::${r.reason}`);
    process.exitCode = r.ok ? 0 : 1;
}
