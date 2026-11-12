//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist", "node_modules", "check-render-output", "widgets-incoming", "src/widgets/*/chart.js"] },
  {
    extends: [eslint.configs.recommended],
    files: ["scripts/visual-input*.mjs", "scripts/semantic-model-query*.mjs", "scripts/validate-visual*.mjs", "scripts/check-render.mjs", "scripts/widgets-refresh.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    // Generated widget hosts export their columns and binding beside the component, by design.
    files: ["src/widgets/*/chart.component.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
);
