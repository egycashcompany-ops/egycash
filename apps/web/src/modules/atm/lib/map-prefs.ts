// The map's view preferences, kept per viewer (docs/12-planning/atm-map-zones.md DM-30): which
// layers show, what colours the dots, and how snapping behaves while editing.
//
// THESE ARE NOT FILTERS. A filter changes which machines are counted and belongs in the address
// bar (`useRememberedFilters`); a layer toggle changes only what is drawn, so it is a preference of
// this browser, under its own key, and never part of a link somebody else opens.
//
// Every access is wrapped (the `useRememberedFilters` precedent): private mode or a full quota
// leaves the defaults, and nothing breaks.

export interface MapLayerPrefs {
  pins: boolean;
  zones: boolean;
  names: boolean;
  faded: boolean;
  colorBy: 'zone' | 'bank';
}

export interface MapSnapPrefs {
  on: boolean;
  /** 4–30 px, default 12 (§8.8 `EditPanel`). */
  px: number;
}

export const LAYERS_KEY = 'ecms.atmMap.layers';
export const SNAP_KEY = 'ecms.atmMap.snap';

export const DEFAULT_LAYERS: MapLayerPrefs = {
  pins: true,
  zones: true,
  names: true,
  faded: false,
  colorBy: 'zone',
};

export const SNAP_MIN_PX = 4;
export const SNAP_MAX_PX = 30;
export const DEFAULT_SNAP: MapSnapPrefs = { on: true, px: 12 };

export type PrefStorage = Pick<Storage, 'getItem' | 'setItem'>;

const browserStorage = (): PrefStorage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

const readJson = (key: string, storage: PrefStorage | null): Record<string, unknown> => {
  if (storage === null) return {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const flag = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/** What this browser keeps, value by value; anything missing or malformed is the default. */
export const loadLayerPrefs = (storage: PrefStorage | null = browserStorage()): MapLayerPrefs => {
  const raw = readJson(LAYERS_KEY, storage);
  return {
    pins: flag(raw['pins'], DEFAULT_LAYERS.pins),
    zones: flag(raw['zones'], DEFAULT_LAYERS.zones),
    names: flag(raw['names'], DEFAULT_LAYERS.names),
    faded: flag(raw['faded'], DEFAULT_LAYERS.faded),
    colorBy: raw['colorBy'] === 'bank' ? 'bank' : 'zone',
  };
};

export const clampSnapPx = (px: number): number =>
  Number.isFinite(px)
    ? Math.min(SNAP_MAX_PX, Math.max(SNAP_MIN_PX, Math.round(px)))
    : DEFAULT_SNAP.px;

export const loadSnapPrefs = (storage: PrefStorage | null = browserStorage()): MapSnapPrefs => {
  const raw = readJson(SNAP_KEY, storage);
  return {
    on: flag(raw['on'], DEFAULT_SNAP.on),
    px: typeof raw['px'] === 'number' ? clampSnapPx(raw['px']) : DEFAULT_SNAP.px,
  };
};

const write = (key: string, value: unknown, storage: PrefStorage | null): void => {
  if (storage === null) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* not remembering a layer toggle is not an error worth showing anyone */
  }
};

export const saveLayerPrefs = (
  prefs: MapLayerPrefs,
  storage: PrefStorage | null = browserStorage(),
): void => write(LAYERS_KEY, prefs, storage);

export const saveSnapPrefs = (
  prefs: MapSnapPrefs,
  storage: PrefStorage | null = browserStorage(),
): void => write(SNAP_KEY, { on: prefs.on, px: clampSnapPx(prefs.px) }, storage);
