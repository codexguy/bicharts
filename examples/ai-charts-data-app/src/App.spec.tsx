//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import App from "@/App";

// The page runs inside the Fabric portal with the theme supplied by the host. Here the widgets draw from the bundled
// sample (no connector is declared), so the test needs no tenant; jsdom has no layout, so no chart is drawn and the
// widget suite (npm run test:widgets) covers the drawing in a real browser.
vi.mock("@/hooks/theme.context", () => ({
    useThemeContext: () => ({ isDark: false, toggleTheme: () => {}, theme: {} }),
}));

// jsdom has no ResizeObserver; the chart panels measure themselves with one.
globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

describe("App", () => {
    it("renders without throwing", () => {
        expect(() => render(<App />)).not.toThrow();
    });

    it("shows the chart cards, then the mini-apps on their tab", () => {
        render(<App />);
        for (const title of ["Ranking", "Country map", "Trend", "Actual against target"]) {
            expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
        }
        fireEvent.click(screen.getByRole("tab", { name: "Mini-apps" }));
        for (const title of ["Selection explainer", "Budget allocator", "What-if projection", "What-if scenarios"]) {
            expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
        }
    });

    it("binds every role on the shipped field map", () => {
        render(<App />);
        expect(screen.queryByText(/Map a field to/)).toBeNull();
    });
});
