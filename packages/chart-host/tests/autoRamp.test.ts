import { describe, it, expect } from "vitest";
import {
    resolveAutoColorScale, autoRampMinStep, autoRampCanvas,
    AUTO_RAMP_CLASSES, AUTO_RAMP_DRAWN_OPACITY, AUTO_RAMP_MIN_STEP_DELTA_E,
} from "../src/autoRamp";
import { hexToLab, labToHex, deltaE2000, deltaEHex } from "../src/deltaE";
import { SAME_SHADE_DELTA_E } from "../src/colourSpread";
import { resolveOptions } from "../src/defaults";

// The accents a real report or workbook hands the resolver: Excel's Office theme, Power BI's
// default theme, and the awkward ones (a gold, a pure yellow, black, white) that a naive "tint to
// the accent" gets wrong.
const EXCEL = ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47"];
const POWER_BI = ["#118dff", "#12239e", "#e66c37", "#6b007b", "#e044a7", "#744ec2", "#d9b300", "#d64550"];
const AWKWARD = ["#ffff00", "#000000", "#ffffff", "#808080"];
const CANVASES = ["#ffffff", "#f3f2f1", "#1b1b1b", "#252423"];

const painted = (fg: string, canvas: string, alpha: number) => {
    const f = [1, 3, 5].map(i => parseInt(fg.slice(i, i + 2), 16));
    const c = [1, 3, 5].map(i => parseInt(canvas.slice(i, i + 2), 16));
    return "#" + f.map((v, i) => Math.round(v * alpha + c[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("");
};

describe("resolveAutoColorScale - the automatic ramp keeps its classes apart as painted", () => {
    for (const canvas of CANVASES) {
        for (const accent of [...EXCEL, ...POWER_BI, ...AWKWARD]) {
            it(`${accent} on ${canvas}`, () => {
                const { low, high } = resolveAutoColorScale({ palette: [accent, "#264478"], backgroundColor: canvas });
                expect(low).toMatch(/^#[0-9a-f]{6}$/);
                expect(high).toMatch(/^#[0-9a-f]{6}$/);
                // Neighbouring classes, painted at the drawn opacity over this canvas, clear the JND.
                expect(autoRampMinStep(low, high, canvas)).toBeGreaterThanOrEqual(AUTO_RAMP_MIN_STEP_DELTA_E);
                // A chart drawing fewer classes, or painting them opaque, only gets more room.
                expect(autoRampMinStep(low, high, canvas, 6, AUTO_RAMP_DRAWN_OPACITY)).toBeGreaterThanOrEqual(AUTO_RAMP_MIN_STEP_DELTA_E);
                expect(autoRampMinStep(low, high, canvas, AUTO_RAMP_CLASSES, 1)).toBeGreaterThanOrEqual(AUTO_RAMP_MIN_STEP_DELTA_E);
                // The low end never vanishes into the canvas: clearly distinct even at the drawn opacity.
                expect(deltaEHex(painted(low, canvas, AUTO_RAMP_DRAWN_OPACITY), canvas)).toBeGreaterThanOrEqual(SAME_SHADE_DELTA_E - 0.05);
            });
        }
    }
});

describe("resolveAutoColorScale - the chart that raised this", () => {
    it("a green table style: the brighter() lime drew 1.7 apart as painted; the automatic ramp clears the JND", () => {
        // What the generation invented: brighter(1.4) of the accent, six quantile bins at 0.5.
        expect(autoRampMinStep("#b9ff75", "#70ad47", "#ffffff", 6, 0.5)).toBeLessThan(1.8);
        const auto = resolveAutoColorScale({ palette: ["#70ad47", "#264478"], themeBg: "#ffffff" });
        expect(autoRampMinStep(auto.low, auto.high, "#ffffff", 6, 0.5)).toBeGreaterThanOrEqual(AUTO_RAMP_MIN_STEP_DELTA_E);
        // Still anchored on the accent: the high end IS the palette's first colour when it can carry the ramp.
        expect(auto.high).toBe("#70ad47");
        // And the low end is a tint of it, not a lime: lighter than the accent, same hue family.
        const lo = hexToLab(auto.low)!, hi = hexToLab(auto.high)!;
        expect(lo.L).toBeGreaterThan(hi.L);
        expect(Math.sign(lo.a)).toBe(Math.sign(hi.a));
        expect(Math.sign(lo.b)).toBe(Math.sign(hi.b));
    });
});

describe("resolveAutoColorScale - where the accent and the canvas come from", () => {
    it("a light accent is darkened until the ramp clears, never replaced", () => {
        const { high } = resolveAutoColorScale({ palette: ["#ffc000"], backgroundColor: "#ffffff" });
        const h = hexToLab(high)!, gold = hexToLab("#ffc000")!;
        expect(h.L).toBeLessThanOrEqual(gold.L);
        expect(Math.abs(h.b - gold.b)).toBeLessThan(1e-6 + 40);   // walked in lightness, hue kept
    });

    it("a first colour that IS the canvas is skipped for the next one that can carry a ramp", () => {
        const r = resolveAutoColorScale({ palette: ["#ffffff", "#12239e"], backgroundColor: "#ffffff" });
        expect(r.high).toBe("#12239e");
    });

    it("no palette at all still resolves (theme foreground, then a fixed blue)", () => {
        const withFg = resolveAutoColorScale({ palette: [], themeFg: "#252423", themeBg: "#ffffff" });
        expect(withFg.high).toBe("#252423");
        const bare = resolveAutoColorScale({});
        expect(bare.high).toMatch(/^#[0-9a-f]{6}$/);
        expect(autoRampMinStep(bare.low, bare.high, "#ffffff")).toBeGreaterThanOrEqual(AUTO_RAMP_MIN_STEP_DELTA_E);
    });

    it("high contrast builds on the host's HC-safe accent, not the report palette", () => {
        const r = resolveAutoColorScale({ palette: ["#70ad47"], isHighContrast: true, themeAccent: "#ffff00", backgroundColor: "#000000" });
        expect(r.high).toBe("#ffff00");
    });

    it("the canvas is the visual's own background, else the theme's, else white - blank and transparent fall through", () => {
        expect(autoRampCanvas({ backgroundColor: "#1b1b1b", themeBg: "#ffffff" })).toBe("#1b1b1b");
        expect(autoRampCanvas({ backgroundColor: "", themeBg: "#252423" })).toBe("#252423");
        expect(autoRampCanvas({ backgroundColor: "transparent", themeBg: "#FFF" })).toBe("#ffffff");
        expect(autoRampCanvas({})).toBe("#ffffff");
    });

    it("is deterministic, and the same inputs give the same object", () => {
        const a = resolveAutoColorScale({ palette: ["#118dff"], themeBg: "#ffffff" });
        const b = resolveAutoColorScale({ palette: ["#118dff"], themeBg: "#ffffff" });
        expect(b).toEqual(a);
        const c = resolveAutoColorScale({ palette: ["#e66c37"], themeBg: "#ffffff" });
        expect(c.high).not.toBe(a.high);
        expect(resolveAutoColorScale({ palette: ["#118dff"], themeBg: "#ffffff" })).toEqual(a);
    });
});

describe("resolveOptions - every chart is handed the automatic ends", () => {
    it("fills colorScaleAutoLow / High from the palette and canvas it is given, whatever the pickers hold", () => {
        const o = resolveOptions({ palette: ["#70ad47"], themeBg: "#ffffff" });
        const r = resolveAutoColorScale({ palette: ["#70ad47"], themeBg: "#ffffff" });
        expect(o.colorScaleAutoLow).toBe(r.low);
        expect(o.colorScaleAutoHigh).toBe(r.high);
        expect(o.colorScaleLow).toBeUndefined();
        const forced = resolveOptions({ palette: ["#70ad47"], themeBg: "#ffffff", colorScaleLow: "#ff0000" });
        expect(forced.colorScaleLow).toBe("#ff0000");
        expect(forced.colorScaleAutoLow).toBe(r.low);
    });

    it("a palette or theme change moves them, so a live re-render follows the report", () => {
        const light = resolveOptions({ palette: ["#118dff"], themeBg: "#ffffff" });
        const dark = resolveOptions({ palette: ["#118dff"], themeBg: "#1b1b1b" });
        expect(dark.colorScaleAutoLow).not.toBe(light.colorScaleAutoLow);
        expect(hexToLab(dark.colorScaleAutoLow!)!.L).toBeLessThan(hexToLab(light.colorScaleAutoLow!)!.L);
    });
});

describe("labToHex", () => {
    it("inverts hexToLab across the cube", () => {
        for (let r = 0; r <= 255; r += 51) for (let g = 0; g <= 255; g += 51) for (let b = 0; b <= 255; b += 51) {
            const hex = "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
            const back = labToHex(hexToLab(hex)!);
            expect(deltaE2000(hexToLab(back)!, hexToLab(hex)!)).toBeLessThan(0.5);
        }
    });
});
