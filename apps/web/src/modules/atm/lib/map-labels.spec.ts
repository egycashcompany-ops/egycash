// Zone labels (spec §9.4): off the dots at the centroid, absent when the zone is small on screen or
// the map is zoomed out, and the lower-listed of two colliding labels is the one dropped.
import { describe, expect, it } from 'vitest';
import { placeLabel, resolveCollisions } from './map-labels';

const SQUARE = [
  { x: 0, y: 0 },
  { x: 300, y: 0 },
  { x: 300, y: 300 },
  { x: 0, y: 300 },
];
const LABEL = { width: 100, height: 24 };

describe('placeLabel', () => {
  it('sits at the centre of an empty zone', () => {
    expect(placeLabel(SQUARE, [], LABEL, 12)).toEqual({ x: 150, y: 150 });
  });

  it('moves off a cluster of dots at the centroid', () => {
    const pins = Array.from({ length: 6 }, (_, i) => ({ x: 140 + i * 4, y: 148 + (i % 2) * 4 }));
    const spot = placeLabel(SQUARE, pins, LABEL, 12);
    expect(spot).not.toBeNull();
    const covered = pins.filter(
      (p) => Math.abs(p.x - (spot?.x ?? 0)) <= 50 && Math.abs(p.y - (spot?.y ?? 0)) <= 12,
    );
    expect(covered).toEqual([]);
  });

  it('is absent under 80 px on screen and below zoom 9', () => {
    const small = SQUARE.map((p) => ({ x: p.x / 4, y: p.y / 4 }));
    expect(placeLabel(small, [], LABEL, 12)).toBeNull();
    expect(placeLabel(SQUARE, [], LABEL, 8)).toBeNull();
    expect(placeLabel(SQUARE, [], LABEL, 9)).not.toBeNull();
  });

  it('keeps 8 px from the edges, so a sliver gets no label', () => {
    const sliver = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(placeLabel(sliver, [], LABEL, 12)).toBeNull();
  });
});

describe('resolveCollisions', () => {
  it('drops the later of two overlapping labels, in list order', () => {
    const kept = resolveCollisions([
      { zoneId: 'top', x: 100, y: 100, width: 100, height: 24 },
      { zoneId: 'lower', x: 150, y: 110, width: 100, height: 24 },
      { zoneId: 'apart', x: 400, y: 100, width: 100, height: 24 },
    ]);
    expect(kept.map((l) => l.zoneId)).toEqual(['top', 'apart']);
  });
});
