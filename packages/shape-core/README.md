# @bicharts/shape-core

> **Make Generative AI for Charts *Better*.**

That is what **RegiaBI** is for; this package is the part that measures your data so the
rest of it can be honest about what your data will actually support.

A **host-agnostic data-shape profiler**. Feed it a dataset's rows through the
`IValueCollection.addRow` seam; read back the measured shape as an
`LLMColumnWithValue[]` payload — the exact contract the
[Business Intelligence Champions](https://bizintelligencechampions.com) (BIC) backend
consumes to select and generate a chart.

The Power BI visual and the MCP client both feed this **same engine** through their own
thin adapters, so the server receives an identical shape payload regardless of which
front-end produced it — it cannot tell them apart.

```bash
npm install @bicharts/shape-core
```

## What's in scope

This package is **measurement only**:

- `IndexedText` — the engine. Ingests rows, computes per-column primitives
  (distinct/blank counts, ranges, median, top-N categories, format) **and**
  full-dataset derived signals (association η², shared-value ratios, nesting
  ratios, categorical pair stats, leaf cardinality) — the signals that require a
  pass over every row, which the server never gets.
- Pure classifiers — `classifyNumericValueNature`, `classifyTemporal`,
  `classifyAdditivity`, `hostAggHint`, `isIdentifierName`.
- Column-detail helpers — ordinal-domain / format detection, localized month names.
- The wire types — `LLMColumnWithValue` and friends.

## What's deliberately NOT here

The **policy** that decides what a measured shape *means* for chart selection —
eligibility gates, weighting, prompt assembly, the guardrail corpus — lives
server-side and is not in this package. Profiling is commodity; the policy is the
moat, which is exactly why the profiler can be open source and the policy cannot.

## Consuming it

```ts
import { IndexedText, IValueCollection, LLMColumnWithValue } from "@bicharts/shape-core";
// An adapter registers columns, pushes rows via addRow(values, originalIdx),
// then reads the enriched LLMColumnWithValue[] back out as the shape payload.
```

An **adapter** is whatever turns your source of rows into `addRow` calls. Two exist
today and they share this engine exactly:

- the **Power BI visual**, whose adapter walks a `dataView`;
- the **MCP client**, whose adapter reads a CSV, DataFrame or Arrow table.

Because the measurement is identical, the server cannot tell which front-end produced
a payload — which is the property that makes a chart behave the same in both.

## Determinism

The emitted **shape statistics are deterministic** across runs and across hosts —
that's what lets the two front-ends agree. Only the optional *obfuscated sample
text* uses `GET_RANDOM` and therefore varies; stat derivation never does. A
byte-identity test (same rows through both adapters → identical shape JSON) is the
intended guard once the MCP adapter exists.

## Tests

`shape-core/tests/` is included in the repo's root vitest run. The engine's
behavioral coverage currently lives in `../tests/indexedText.test.ts` and
`../tests/ordinalDetector.test.ts` (they import from this package); they can move
here over time.
