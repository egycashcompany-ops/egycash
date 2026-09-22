// Every glyph the Fleet rail asks for is one this client can actually draw.
//
// The names live in the API's navigation seed and the glyphs live here, so nothing but a test
// holds the two together. A name nobody registered does not fail: `resolveNavIcon` falls back
// without complaint, and the row renders the neutral page icon — which reads as a design choice
// rather than a missing entry, and is exactly how a rail ends up with three identical rows.
//
// The seed is read as TEXT rather than imported: it is another package, it pulls in mongoose and
// the whole module registry on import, and all this needs from it is which names it asks for.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveNavIcon } from '../../platform/navigation/app-icon';
import { HomeIcon } from '../../shared/ui/icons';

const SEED = join(__dirname, '../../../../api/src/seed-navigation.ts');

/**
 * The `icon:` values of the Fleet ROWS — from `apps: [` onwards, so the category's own tile is
 * left out: it wears the truck deliberately, and so does السيارات, and a module tile sitting
 * above the rail is not one of the rows being told apart. `previousIcon` is excluded too — that
 * is history, kept only so a live installation can be corrected without stamping on an admin's
 * own choice.
 */
const fleetIconNames = (): string[] => {
  const source = readFileSync(SEED, 'utf8');
  const category = source.indexOf("ar: 'الحركة'");
  expect(category, 'the Fleet category is still in the seed').toBeGreaterThan(-1);
  const start = source.indexOf('apps: [', category);
  expect(start, 'and it still declares its rows').toBeGreaterThan(-1);
  const end = source.indexOf('\n  {\n', start);
  const block = source.slice(start, end === -1 ? undefined : end);
  return [...block.matchAll(/(?<!previous)[Ii]con: '([a-z]+)'/g)].map((m) => m[1] as string);
};

describe('the Fleet rail', () => {
  it('asks for glyphs this client has', () => {
    // A SENTINEL, not a real icon: passing HomeIcon would make the Fleet home row — whose icon IS
    // `home` — indistinguishable from a miss.
    const SENTINEL = (() => null) as unknown as typeof HomeIcon;
    const names = fleetIconNames();
    expect(names.length, 'the block was found and parsed').toBeGreaterThanOrEqual(12);
    for (const name of names) {
      expect(resolveNavIcon(name, SENTINEL), `icon '${name}'`).not.toBe(SENTINEL);
    }
    expect(resolveNavIcon('not-an-icon', SENTINEL), 'and the sentinel really does come back').toBe(
      SENTINEL,
    );
  });

  it('draws a different shape for every screen', () => {
    // A rail is read by shape before word. Two rows sharing a glyph — السائقون and الطقم الثابت
    // both wore `users` — tell a reader the two screens hold the same thing.
    const names = fleetIconNames();
    const glyphs = names.map((name) => resolveNavIcon(name, HomeIcon));
    expect(new Set(glyphs).size, 'one glyph per row').toBe(glyphs.length);
  });
});
