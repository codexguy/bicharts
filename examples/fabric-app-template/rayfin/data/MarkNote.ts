// Added by the RegiaBI chart server (setup_fabric_app). Yours to edit; it is never rewritten.
import { entity, authenticated, uuid, text, date } from '@microsoft/rayfin-core';

/** A reader's note on one chart mark, keyed by the mark's model key (never a row position). */
@entity()
@authenticated(['read', 'create'])
export class MarkNote {
  @uuid() id!: string;
  @text({ max: 64 }) chart!: string;                       // which chart: "region-map", "routes"
  @text({ max: 128 }) markKey!: string;                    // the mark's model key (a country code)
  @text({ max: 128, optional: true }) markKeyTo?: string;  // a route's other end; empty for one mark
  @text({ max: 2000 }) body!: string;
  @text({ max: 320 }) author!: string;
  @date() createdAt!: Date;
}
