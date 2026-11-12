#!/usr/bin/env node
// npm run check:render [-- --out <dir>] [--width 1440] [--height 900]
//
// Draws the page on its bundled sample rows in headless Chromium (no tenant, no sign-in, no network beyond localhost)
// and checks what a reader would see:
//   - every widget draws (an svg or canvas of real size, no "Map a field" or failure text in its card);
//   - nothing spills past its card or leaves a scrollbar inside it, at the viewport given;
//   - no axis repeats a numeric tick label, and no label in a row of series labels is empty or lost its series name
//     (a defect in generated code that only regenerating fixes is listed in widgets.json's knownDefects);
//   - a click on a mark sets the page filter (a chip appears), and the filter reaches another widget: a month picked
//     on the trend redraws the template's Vega-Lite ranking, and a category picked on the ranking redraws the trend;
// It saves one screenshot per widget, plus the page before and after the cross-filter, into --out
// (default check-render-output/), and exits 1 when any check fails.
//
// Needs Playwright's Chromium once: npx playwright install chromium

/* global document, getComputedStyle -- the functions handed to page.evaluate run in the browser */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : dflt;
};
const OUT = path.resolve(ROOT, arg("out", "check-render-output"));
const WIDTH = Number(arg("width", 1440));
const HEIGHT = Number(arg("height", 900));
mkdirSync(OUT, { recursive: true });

const freePort = () => new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); });
});

async function startVite() {
    const port = await freePort();
    const vite = spawn(process.execPath, [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--mode", "sample",
        "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    vite.stdout.on("data", (d) => { log += d; });
    vite.stderr.on("data", (d) => { log += d; });
    const url = `http://127.0.0.1:${port}/`;
    for (let i = 0; i < 120; i++) {
        try { if ((await fetch(url)).ok) return { vite, url }; } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 500));
    }
    vite.kill();
    throw new Error(`vite did not start:\n${log}`);
}

const failures = [];
const results = {};
const fail = (what) => { failures.push(what); console.log(`  x ${what}`); };

/** The card's own drawing and anything inside it that scrolls or spills. */
const inspect = (page, id) => page.evaluate((id) => {
    const card = document.querySelector(`[data-widget="${id}"]`);
    if (!card) return { missing: true };
    const r = card.getBoundingClientRect();
    const drawn = [...card.querySelectorAll("svg, canvas")].map((e) => e.getBoundingClientRect())
        .filter((b) => b.width > 40 && b.height > 40);
    const scrolls = [...card.querySelectorAll("*")].filter((e) => {
        const cs = getComputedStyle(e);
        const sx = /(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1;
        const sy = /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1;
        return sx || sy;
    }).length;
    // Drawn content (svg/canvas) whose box runs past the card's own.
    const spills = drawn.filter((b) => b.left < r.left - 1 || b.right > r.right + 1 || b.top < r.top - 1 || b.bottom > r.bottom + 1).length;
    const text = card.textContent ?? "";

    // Text defects. An axis whose adjacent numeric tick labels read the same ("0.3, 0.3"): the format is too coarse for
    // the range, so two ticks claim one value. Month initials ("J, J") carry no digit and are not counted.
    const label = (e) => (e.textContent ?? "").trim();
    const duplicateTicks = [];
    for (const axis of card.querySelectorAll("g")) {
        const ticks = [...axis.children].filter((c) => c.classList?.contains("tick")).map(label);
        for (let i = 1; i < ticks.length; i++) {
            if (ticks[i] && /\d/.test(ticks[i]) && ticks[i] === ticks[i - 1]) duplicateTicks.push(`${ticks[i - 1]}, ${ticks[i]}`);
        }
    }
    // A labelled series row: three or more sibling text labels of one class, one per series. One that is empty, or
    // that is a bare number while its siblings name their series, has lost its name.
    const unnamedLabels = [];
    const groups = new Map();
    for (const t of card.querySelectorAll("svg text[class]")) {
        const k = t.parentNode;
        const key = t.getAttribute("class");
        if (!groups.has(k)) groups.set(k, new Map());
        const byClass = groups.get(k);
        if (!byClass.has(key)) byClass.set(key, []);
        byClass.get(key).push(label(t));
    }
    const bare = (s) => /^[\s\-+−$€£¥%.,0-9KMBkmb()]*$/.test(s);
    for (const byClass of groups.values()) {
        for (const [cls, labels] of byClass) {
            if (labels.length < 3) continue;
            const named = labels.filter((l) => l && !bare(l));
            if (named.length < 2) continue;
            for (const l of labels) if (!l || bare(l)) unnamedLabels.push(`${cls}: "${l}" beside "${named[0]}"`);
        }
    }
    return {
        drawn: drawn.length, scrolls, spills, marks: card.querySelectorAll(".d3-mark, [data-row-idx]").length,
        unmapped: /Map a field to/.test(text), failed: /query failed|could not|went wrong|No data to display|needs \d+ to \d+|too few rows/i.test(text),
        width: Math.round(r.width), height: Math.round(r.height), duplicateTicks, unnamedLabels,
    };
}, id);

const settle = (page, ms = 1500) => page.waitForTimeout(ms);
const tab = async (page, name) => { await page.getByRole("tab", { name }).click(); await settle(page, 2500); };

async function checkWidgets(page, ids) {
    for (const id of ids) {
        const info = await inspect(page, id);
        results[id] = info;
        const card = page.locator(`[data-widget="${id}"]`);
        if (!info.missing) await card.screenshot({ path: path.join(OUT, `${id}.png`) });
        console.log(`- ${id}: ${JSON.stringify(info)}`);
        if (info.missing) { fail(`${id}: not on the page`); continue; }
        if (!info.drawn) fail(`${id}: drew nothing`);
        if (info.unmapped) fail(`${id}: shows an unmapped role`);
        if (info.failed) fail(`${id}: shows a failure`);
        if (info.scrolls) fail(`${id}: ${info.scrolls} element(s) scroll inside the card`);
        if (info.spills) fail(`${id}: its drawing runs past the card`);
        if (info.duplicateTicks.length) defect(id, "duplicate-ticks", `an axis repeats a tick label (${info.duplicateTicks[0]})`);
        else knownButGone(id, "duplicate-ticks");
        if (info.unnamedLabels.length) defect(id, "unnamed-label", `a series label lost its name (${info.unnamedLabels[0]})`);
        else knownButGone(id, "unnamed-label");
    }
}

// A defect in a widget's generated code that no app-side change can fix is listed in widgets.json under knownDefects
// (with why and what fixes it). It is reported, not failed, so newer code can still be checked; once the defect is gone
// the entry must be removed, and the check fails until it is.
const KNOWN = Object.fromEntries(JSON.parse(readFileSync(path.join(ROOT, "src", "widgets", "widgets.json"), "utf8")).widgets
    .map((w) => [w.id, new Set((w.knownDefects ?? []).map((d) => d.check))]));
const known = [];
function defect(id, check, what) {
    if (KNOWN[id]?.has(check)) { known.push(`${id}: ${what}`); console.log(`  ! known: ${id}: ${what}`); }
    else fail(`${id}: ${what}`);
}
function knownButGone(id, check) {
    if (KNOWN[id]?.has(check)) fail(`${id}: its known defect "${check}" no longer shows: remove it from knownDefects in widgets.json`);
}

const visualHash = (page, id) => page.locator(`[data-widget="${id}"]`).screenshot().then((b) => b.toString("base64"));
const chips = (page) => page.evaluate(() => document.querySelector("header")?.innerText ?? "");

async function main() {
    const { vite, url } = await startVite();
    const browser = await chromium.launch({ headless: true });
    const errors = [];
    try {
        const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.goto(url, { waitUntil: "networkidle" });
        await settle(page, 4000);
        const pageScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
        if (pageScroll) fail("the page scrolls sideways");

        console.log("Charts tab");
        await checkWidgets(page, ["ranking", "country-map", "vega-ranking", "trend", "actual-vs-target"]);
        await page.screenshot({ path: path.join(OUT, "charts-page.png"), fullPage: true });

        // A month picked on the trend narrows the template's Vega-Lite ranking.
        const vegaBefore = await visualHash(page, "vega-ranking");
        const month = page.locator('[data-widget="trend"] .d3-mark, [data-widget="trend"] [data-row-idx]').nth(40);
        if (await month.count()) {
            await month.click({ force: true });
            await settle(page, 2500);
            const header = await chips(page);
            const vegaAfter = await visualHash(page, "vega-ranking");
            results.crossFilterTrendToVega = { chip: /Month/.test(header), vegaRedrew: vegaAfter !== vegaBefore };
            console.log(`- trend -> Vega ranking: ${JSON.stringify(results.crossFilterTrendToVega)}`);
            if (!results.crossFilterTrendToVega.chip) fail("a click on the trend set no Month filter");
            if (!results.crossFilterTrendToVega.vegaRedrew) fail("the Month filter did not reach the Vega ranking");
            await page.screenshot({ path: path.join(OUT, "charts-page-month-filter.png"), fullPage: true });
            await month.click({ force: true });
            await settle(page);
        } else fail("the trend has no clickable marks");

        // A category picked on the ranking narrows the trend.
        const trendBefore = await visualHash(page, "trend");
        const bar = page.locator('[data-widget="ranking"] .d3-mark, [data-widget="ranking"] [data-row-idx]').first();
        if (await bar.count()) {
            await bar.click({ force: true });
            await settle(page, 2500);
            const header = await chips(page);
            const trendAfter = await visualHash(page, "trend");
            results.crossFilterRankingToTrend = { chip: /Category/.test(header), trendRedrew: trendAfter !== trendBefore };
            console.log(`- ranking -> trend: ${JSON.stringify(results.crossFilterRankingToTrend)}`);
            if (!results.crossFilterRankingToTrend.chip) fail("a click on the ranking set no Category filter");
            if (!results.crossFilterRankingToTrend.trendRedrew) fail("the Category filter did not reach the trend");
            await page.screenshot({ path: path.join(OUT, "charts-page-category-filter.png"), fullPage: true });
            await bar.click({ force: true });
            await settle(page);
        } else fail("the ranking has no clickable marks");

        console.log("Mini-apps tab");
        await tab(page, "Mini-apps");
        await checkWidgets(page, ["selection-explainer", "budget-allocator", "what-if-projection", "what-if-scenarios"]);
        await page.screenshot({ path: path.join(OUT, "apps-page.png"), fullPage: true });
        if (errors.length) fail(`page errors: ${errors.slice(0, 3).join(" | ")}`);
    } finally {
        await browser.close();
        vite.kill();
    }
    writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ viewport: { width: WIDTH, height: HEIGHT }, results, failures, knownDefects: known }, null, 2));
    if (known.length) console.log(`\n${known.length} known defect(s) in generated code (widgets.json knownDefects): ${known.join("; ")}`);
    console.log(failures.length ? `\n${failures.length} check(s) failed; screenshots in ${OUT}` : `\nAll checks passed; screenshots in ${OUT}`);
    process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
