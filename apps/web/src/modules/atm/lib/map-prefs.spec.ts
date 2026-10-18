// The viewer's layer and snap preferences (DM-30): defaults when nothing or nonsense is stored, and
// a storage that throws never breaks the map.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYERS,
  DEFAULT_SNAP,
  LAYERS_KEY,
  SNAP_KEY,
  clampSnapPx,
  loadLayerPrefs,
  loadSnapPrefs,
  saveLayerPrefs,
  saveSnapPrefs,
  type PrefStorage,
} from './map-prefs';

const memory = (): PrefStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
};

const broken: PrefStorage = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('quota');
  },
};

describe('layer preferences', () => {
  it('opens on the defaults with nothing stored, or with no storage at all', () => {
    expect(loadLayerPrefs(memory())).toEqual(DEFAULT_LAYERS);
    expect(loadLayerPrefs(null)).toEqual(DEFAULT_LAYERS);
    expect(loadLayerPrefs(broken)).toEqual(DEFAULT_LAYERS);
  });

  it('keeps what was saved, and reads a malformed value as the default', () => {
    const storage = memory();
    saveLayerPrefs(
      { pins: false, zones: true, names: false, faded: true, colorBy: 'bank' },
      storage,
    );
    expect(loadLayerPrefs(storage)).toEqual({
      pins: false,
      zones: true,
      names: false,
      faded: true,
      colorBy: 'bank',
    });
    storage.data.set(LAYERS_KEY, '{"pins":"no","colorBy":"area"}');
    expect(loadLayerPrefs(storage)).toEqual(DEFAULT_LAYERS);
    storage.data.set(LAYERS_KEY, 'not json');
    expect(loadLayerPrefs(storage)).toEqual(DEFAULT_LAYERS);
  });

  it('survives a storage that refuses to save', () => {
    expect(() => saveLayerPrefs(DEFAULT_LAYERS, broken)).not.toThrow();
  });
});

describe('snap preferences', () => {
  it('defaults to on at 12 px', () => {
    expect(loadSnapPrefs(memory())).toEqual(DEFAULT_SNAP);
    expect(DEFAULT_SNAP).toEqual({ on: true, px: 12 });
  });

  it('keeps the distance within 4–30 px', () => {
    expect(clampSnapPx(2)).toBe(4);
    expect(clampSnapPx(31)).toBe(30);
    expect(clampSnapPx(12.4)).toBe(12);
    expect(clampSnapPx(Number.NaN)).toBe(12);
    const storage = memory();
    saveSnapPrefs({ on: false, px: 99 }, storage);
    expect(JSON.parse(storage.data.get(SNAP_KEY) ?? '{}')).toEqual({ on: false, px: 30 });
    expect(loadSnapPrefs(storage)).toEqual({ on: false, px: 30 });
  });
});
