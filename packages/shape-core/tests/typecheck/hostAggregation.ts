// COMPILE-TIME ONLY - included by this package's tsconfig.json, so `npm run typecheck` (run by every release) fails when
// a column can no longer say that its host aggregated it. The server reads only whether the field is present on a measure:
// then a refusal for too few raw rows also tells the reader to set the measures to Don't summarize.
import type { LLMColumnWithValue } from "../../src/index";

type Column = LLMColumnWithValue extends readonly (infer C)[] ? C : LLMColumnWithValue;

export const summed: Pick<Column, "hostAggregation"> = { hostAggregation: "Sum" };
export const none: Pick<Column, "hostAggregation"> = {};
// @ts-expect-error - the host's aggregation name is text
export const wrong: Pick<Column, "hostAggregation"> = { hostAggregation: 1 };
