// node check.mjs http://localhost:5080/  - drive the running app in headless Chromium and check each chart
// answers a selection the way its role says: the clicked chart shows its mark, a highlight member shows the
// sibling's rows with the same classes, a filtering member redraws with fewer rows. Exits 1 on any failure.
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:5080/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
let failed = 0;
const check = (ok, what) => { console.log((ok ? "PASS  " : "FAIL  ") + what); if (!ok) failed++; };

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForFunction(() => {
    const cs = [...document.querySelectorAll("[data-bic-chart]")];
    return cs.length >= 2 && cs.every(c => c.querySelector(".d3-mark[data-row-idx]"));
}, null, { timeout: 30000 });

// Per chart: its distinct SINGLE-row marks (a legend swatch or a header lists several rows, comma-joined),
// whether it shows a selection, and how many marks are lit.
const state = () => page.$$eval("[data-bic-chart]", cs => cs.map(c => {
    const rows = [...c.querySelectorAll(".d3-mark[data-row-idx]")].map(m => m.getAttribute("data-row-idx"))
        .filter(v => v && !v.includes(","));
    return { rows: [...new Set(rows)], selected: c.classList.contains("lch-has-selection"),
             lit: c.querySelectorAll(".lch-mark-selected").length };
}));
const click = (chart, row, modifiers = []) =>
    page.locator("[data-bic-chart]").nth(chart).locator(`.d3-mark[data-row-idx="${row}"]`).first()
        .click({ force: true, modifiers });                 // force: an overlay may sit over a mark
const settle = () => page.waitForTimeout(600);
const clear = async () => { await page.click("[data-bic-clear]"); await settle(); };

const rest = await state();
for (const [src, dst] of [[0, 1], [1, 0]]) {
    await click(src, rest[src].rows.at(-1));
    await settle();
    const now = await state();
    check(now[src].selected && now[src].lit > 0, `chart ${src + 1} shows the mark it was clicked on`);
    // A highlight member shows the classes; a filtering member redraws with fewer rows.
    check(now[dst].selected || now[dst].rows.length < rest[dst].rows.length, `chart ${dst + 1} answers it`);
    await clear();
    const back = await state();
    check(!back[src].selected && back[dst].rows.length === rest[dst].rows.length, `Clear restores both`);
}

await click(0, rest[0].rows[0]); await settle();
const one = (await state())[0].lit;
await click(0, rest[0].rows[1], ["ControlOrMeta"]); await settle();
check((await state())[0].lit > one, "Ctrl-click adds a mark");
await click(0, rest[0].rows[1], ["ControlOrMeta"]); await settle();
check((await state())[0].lit === one, "Ctrl-click on a selected mark removes just that one");
await clear();

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
process.exit(failed ? 1 : 0);
