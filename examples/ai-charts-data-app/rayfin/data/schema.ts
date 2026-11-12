// No Rayfin-managed data entities. The app reads a Fabric semantic model through a Rayfin connector (see
// src/fieldMap.ts) and, before one is declared, its bundled sample rows. Add decorated entity classes here, turn on
// services.data in rayfin.yml and set services.data to true in manifest.json if the app later keeps its own records
// (the RegiaBI chart server's setup_fabric_app can add notes on marks and saved scenarios this way).
export const schema = [] as const;

export type Schema = Record<string, never>;
