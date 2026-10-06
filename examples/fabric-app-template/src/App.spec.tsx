//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import App from "@/App";

// The page runs inside the Fabric portal, signed in, with the theme and the semantic model supplied by the host.
// Here the queries stay loading, so the test needs no tenant.
vi.mock("@/hooks/theme.context", () => ({
    useThemeContext: () => ({ isDark: false, toggleTheme: () => {}, theme: {} }),
}));

vi.mock("@/hooks/auth.context", () => ({
    useAuth: () => ({ session: { user: { email: "tester@example.com" } } }),
}));

vi.mock("@/hooks/use-semantic-model-query", () => ({
    useSemanticModelQuery: () => ({ data: undefined, isLoading: true, error: undefined, refetch: async () => {} }),
}));

describe("App", () => {
    it("renders without throwing", () => {
        expect(() => render(<App />)).not.toThrow();
    });

    it("mounts content into the document", () => {
        render(<App />);
        expect(document.body).not.toBeEmptyDOMElement();
    });
});
