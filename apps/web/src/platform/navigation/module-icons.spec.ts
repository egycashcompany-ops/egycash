// Every module tile in the launcher says what its module is, and no two look alike.
//
// «بص الأيقونات بتاعت الإدارات مش متناسقة مع مدلول الإدارة … وبعدين فى متكرر ! عايز كل أيقونة تكون
// بتعبر عن اسم الإدارة». The names live in the API's navigation seed and the glyphs live here, so
// only a test holds the two together: a name nobody registered falls back to the neutral building
// without complaint, and two modules can share a glyph without anything failing — which is how
// Operations and Gold Vault both ended up behind the same shield.
//
// The seed is read as TEXT (as `fleet-nav-icons.spec.ts` does): it is another package, and all this
// needs from it is the name each module tile asks for.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveNavIcon } from './app-icon';
import {
  AtmIcon,
  BriefcaseIcon,
  BuildingIcon,
  CashIcon,
  GoldIcon,
  MonitorIcon,
  TruckIcon,
  UsersIcon,
  type HomeIcon,
} from '../../shared/ui/icons';

const SEED = join(__dirname, '../../../../api/src/seed-navigation.ts');

/** `[English name, icon]` for each module tile: the icon line directly above its sortOrder. */
const moduleIcons = (): [string, string][] => {
  const source = readFileSync(SEED, 'utf8');
  const tiles = [
    ...source.matchAll(
      /en: '([^']+)',\n\s*ar: '[^']+',\n(?:\s*\/\/.*\n)*\s*icon: '([a-z]+)',\n\s*sortOrder:/g,
    ),
  ];
  return tiles.map((m) => [m[1] as string, m[2] as string]);
};

// A SENTINEL, not a real icon, so a miss cannot pass for the building the launcher falls back to.
const SENTINEL = (() => null) as unknown as typeof HomeIcon;

describe('the module launcher', () => {
  it('finds every module tile in the seed', () => {
    // Every category block, not just the ones laid out as the parser expects: a tile it skipped
    // would escape the two checks below without failing anything.
    const blocks = readFileSync(SEED, 'utf8').match(/^ {4}apps: \[/gm) ?? [];
    expect(moduleIcons().length, 'every category block was parsed').toBe(blocks.length);
    expect(moduleIcons().map(([en]) => en)).toEqual([
      'HR',
      'Fleet',
      'Operations',
      'Organization',
      'IT',
      'Gold Vault',
      'ATM',
      'Administration',
    ]);
  });

  it('draws each module as what it is', () => {
    const glyphs = Object.fromEntries(
      moduleIcons().map(([en, icon]) => [en, resolveNavIcon(icon, SENTINEL)]),
    );
    expect(glyphs).toEqual({
      HR: UsersIcon,
      Fleet: TruckIcon,
      Operations: CashIcon, // «العمليات تبقي ايقونة فلوس»
      Organization: BuildingIcon, // the owner's choice for this tile (e1166473)
      IT: MonitorIcon,
      'Gold Vault': GoldIcon, // «خزائن الدهب تبقي خزينة او سبيكة»
      ATM: AtmIcon, // «الصراف الآلى تبقي Machine»
      Administration: BriefcaseIcon,
    });
  });

  it('and no two modules look alike', () => {
    const glyphs = moduleIcons().map(([, icon]) => resolveNavIcon(icon, SENTINEL));
    expect(glyphs).not.toContain(SENTINEL);
    expect(glyphs.length - new Set(glyphs).size).toBe(0);
  });
});
