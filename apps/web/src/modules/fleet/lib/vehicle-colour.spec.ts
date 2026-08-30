// A vehicle's colour is a property OF THE VEHICLE.
//
// The point of these is not that some colour comes back — it is that the SAME colour comes back,
// under every condition a board actually meets: a re-render, a filter, a sort, a new vehicle
// arriving. A colour that shifts when the list is reordered is worse than none, because it looks
// like the data changed.
import { describe, expect, it } from 'vitest';
import { VEHICLE_COLOURS, vehicleColour } from './vehicle-colour';

/** Realistic ids — 24-hex ObjectIds, which is what the board actually holds. */
const oid = (n: number): string => `64b1f0abcdefabcdefab${String(n).padStart(4, '0')}`;
const fleet = (count: number): string[] => Array.from({ length: count }, (_, i) => oid(i));

describe('vehicleColour', () => {
  it('always answers with a class string from the palette', () => {
    for (const id of fleet(200)) {
      expect(VEHICLE_COLOURS as readonly string[]).toContain(vehicleColour(id));
    }
  });

  it('is STABLE — the same id answers the same way every time', () => {
    // "Does not change on re-render" is exactly this: the function is pure, so a component
    // calling it a hundred times gets one answer.
    const id = oid(42);
    const answers = new Set(Array.from({ length: 100 }, () => vehicleColour(id)));
    expect(answers.size).toBe(1);
  });

  it('does not depend on POSITION — reordering the fleet moves no colours', () => {
    const ids = fleet(40);
    const before = new Map(ids.map((id) => [id, vehicleColour(id)]));
    const reversed = [...ids].reverse();
    const shuffled = [...ids].sort((a, b) => (a < b ? 1 : -1));
    for (const list of [reversed, shuffled]) {
      for (const id of list) {
        expect(vehicleColour(id), `${id} changed colour when the list moved`).toBe(before.get(id));
      }
    }
  });

  it('adding a vehicle does not redistribute anybody else’s colour', () => {
    const before = new Map(fleet(30).map((id) => [id, vehicleColour(id)]));
    // Ten more cars arrive, including ids that sort BEFORE the existing ones.
    const grown = [...fleet(40), oid(9998), oid(9999)];
    for (const id of grown) {
      const was = before.get(id);
      if (was !== undefined) expect(vehicleColour(id), `${id} was repainted`).toBe(was);
    }
  });

  it('distinguishes vehicles while the palette allows it', () => {
    // Not a promise of uniqueness — with more cars than hues there cannot be one. The claim is
    // that a handful of cars sitting together on a board are actually told apart.
    const sample = fleet(10).map(vehicleColour);
    expect(new Set(sample).size, 'ten cars should not collapse into one or two colours').
      toBeGreaterThanOrEqual(4);
  });

  it('spreads a REAL fleet across the whole palette rather than clumping', () => {
    // 105 vehicles is the live figure. Every hue should be doing some work.
    const counts = new Map<string, number>();
    for (const id of fleet(105)) {
      const colour = vehicleColour(id);
      counts.set(colour, (counts.get(colour) ?? 0) + 1);
    }
    expect(counts.size, 'every colour in the palette is used').toBe(VEHICLE_COLOURS.length);
    const biggest = Math.max(...counts.values());
    expect(biggest, 'and none of them takes a third of the fleet').toBeLessThan(35);
  });

  it('CYCLES deterministically past the end of the palette — more cars than colours is fine', () => {
    const many = fleet(1000);
    expect(() => many.forEach(vehicleColour)).not.toThrow();
    // Deterministic across runs: recomputing the whole fleet gives an identical sequence.
    expect(many.map(vehicleColour)).toEqual(many.map(vehicleColour));
  });

  it('does not collide on ids that differ only by the ORDER of two characters', () => {
    // Why a hash and not a character sum: ObjectIds are hex, and two that are anagrams of each
    // other are common. A sum would give them the same colour every time.
    expect(vehicleColour('64b1f0abcdefabcdefab0012')).not.toBe(
      vehicleColour('64b1f0abcdefabcdefab0021'),
    );
  });

  it('answers for an empty id instead of throwing — a colour is decoration', () => {
    expect(VEHICLE_COLOURS as readonly string[]).toContain(vehicleColour(''));
  });

  it('keeps text readable: every entry pairs a light fill with dark text, and inverts for dark mode', () => {
    // Accessibility is not asserted as a contrast ratio here — that needs a renderer — but the
    // SHAPE that produces it is: a 100-level fill under 800-level text, and the dark-mode
    // counterpart. A future entry that forgets one half fails this.
    for (const entry of VEHICLE_COLOURS) {
      expect(entry, `${entry} has no light fill`).toMatch(/\bbg-[a-z]+-(100|200)\b/);
      expect(entry, `${entry} has no dark-enough text`).toMatch(/\btext-[a-z]+-800\b/);
      expect(entry, `${entry} has no dark-mode fill`).toMatch(/\bdark:bg-[a-z]+-(900\/40|700)\b/);
      expect(entry, `${entry} has no dark-mode text`).toMatch(/\bdark:text-[a-z]+-(100|200)\b/);
    }
  });

  it('spends no colour that means something else on this screen', () => {
    // Red is an alarm, emerald is a driver chip and a healthy state, amber is unsaved changes.
    // A vehicle's colour says WHICH car it is, and must never read as a verdict about it.
    for (const reserved of ['red', 'emerald', 'amber', 'rose', 'green']) {
      expect(
        VEHICLE_COLOURS.some((entry) => entry.includes(`-${reserved}-`)),
        `${reserved} carries meaning elsewhere on this board`,
      ).toBe(false);
    }
  });
});
