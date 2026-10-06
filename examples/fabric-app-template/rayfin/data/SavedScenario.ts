// Added by the RegiaBI chart server (setup_fabric_app). Yours to edit; it is never rewritten.
import { entity, authenticated, uuid, text, date } from '@microsoft/rayfin-core';

/**
 * A named setting of a chart's own controls (a What-if chart's rate and horizon). `values` is the controls'
 * values as JSON, exactly what useBicControls() reports and set() applies; `summary` is the chart's own words for
 * them ("growth per year +5.5% · horizon 7 years"), so the list shows the unit the chart shows.
 */
@entity()
@authenticated(['read', 'create'])
export class SavedScenario {
  @uuid() id!: string;
  @text({ max: 64 }) chart!: string;
  @text({ max: 120 }) name!: string;
  @text({ max: 2000, optional: true }) comment?: string;
  @text({ max: 4000 }) values!: string;
  @text({ max: 400 }) summary!: string;
  @text({ max: 320 }) author!: string;
  @date() createdAt!: Date;
}
