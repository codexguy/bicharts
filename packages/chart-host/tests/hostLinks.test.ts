import { describe, it, expect } from "vitest";
import { hostLinkServices } from "../src/hostLinks";

/*
    chart-host contract 1.18.0: the host services a chart may call. The grid engine draws a link only where options.openUrl exists and
    copies through options.copyText where it exists; each host builds both here from its own opener and clipboard.
*/
describe("openUrl", () => {
    it("hands http(s) and mailto addresses to launchUrl, trimmed", () => {
        const opened: string[] = [];
        const s = hostLinkServices(u => opened.push(u), undefined);
        s.openUrl!("  https://example.com/a?b=1 ");
        s.openUrl!("http://x.test");
        s.openUrl!("mailto:a@b.test");
        expect(opened).toEqual(["https://example.com/a?b=1", "http://x.test", "mailto:a@b.test"]);
    });

    it("refuses every other scheme: the second wall behind the engine's own", () => {
        const opened: string[] = [];
        const s = hostLinkServices(u => opened.push(u), undefined);
        for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///c:/x", "//example.com", "", "ftp://x"])
            s.openUrl!(bad);
        expect(opened).toEqual([]);
    });

    it("is absent when the host has no launchUrl, so the chart prints a link as text", () => {
        expect("openUrl" in hostLinkServices(undefined, undefined)).toBe(false);
    });
});

describe("copyText", () => {
    it("writes through the clipboard and answers true", async () => {
        let got = "";
        const s = hostLinkServices(undefined, { writeText: async t => { got = t; } });
        expect(await (s.copyText as (t: string) => Promise<boolean>)("a\tb\r\nc\td")).toBe(true);
        expect(got).toBe("a\tb\r\nc\td");
    });

    it("is absent when the host passes no clipboard, so a chart uses the browser's own copy command", () => {
        expect("copyText" in hostLinkServices(undefined, undefined)).toBe(false);
        expect("copyText" in hostLinkServices(() => {}, null)).toBe(false);
    });

    it("answers false when the clipboard refuses or has no writeText, so the engine opens its own copy sheet", async () => {
        const refused = hostLinkServices(undefined, { writeText: () => Promise.reject(new Error("NotAllowedError")) });
        expect(await (refused.copyText as (t: string) => Promise<boolean>)("x")).toBe(false);
        expect((hostLinkServices(undefined, {}).copyText as (t: string) => boolean)("x")).toBe(false);
        const throws = hostLinkServices(undefined, { writeText: () => { throw new Error("sync"); } });
        expect((throws.copyText as (t: string) => boolean)("x")).toBe(false);
    });
});
