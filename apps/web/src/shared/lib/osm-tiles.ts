// The OpenStreetMap raster tiles every map in the app draws on (ATM map spec DM-28, D-M3).
//
// One definition, because two screens use it — the operations catalogs' branch picker and the ATM
// machine map — and "never copy-paste across modules" (`docs/02-architecture/module-structure.md`).
//
// `{s}.` stays: the CSP allows `https://*.tile.openstreetmap.org` (`apps/api/src/app.ts`), and a
// wildcard host does not match the bare `tile.openstreetmap.org`. The attribution is a LICENCE
// CONDITION of using these tiles, not decoration — no screen styles it away.

export const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '&copy; OpenStreetMap';
