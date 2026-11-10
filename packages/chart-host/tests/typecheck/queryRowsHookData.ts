// queryRows takes a semantic-model query hook's `data` as the Fabric data app template types it, with no cast.
import { queryRows } from "../../src/dax";

type HookTable = { columns: { name: string }[]; rows: unknown[][] };
declare const data: { status: "success"; table: HookTable } | { status: "error"; error: { message: string } } | undefined;
declare const table: HookTable;

export const fromData: Record<string, unknown>[] = queryRows(data);
export const fromTable: Record<string, unknown>[] = queryRows(table);
