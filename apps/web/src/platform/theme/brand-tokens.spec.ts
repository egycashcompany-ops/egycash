// The brand scale is now a contract between two files, and this holds both ends of it (P12-A).
//
// `styles.css` declares eleven custom properties; `tailwind.config.ts` reads them. Neither file
// can tell on its own that the other still agrees — a shade dropped from the stylesheet leaves the
// config generating `rgb(var(--brand-700) / 1)` against a property nothing defines, and the colour
// simply does not paint. Nothing throws, no build step complains, and the failure shows up as a
// button that lost its background.
//
// The values are pinned as well as the wiring, because the promise of P12-A is that it changes
// WHERE the palette lives and not what it looks like. A refactor that silently shifts the accent
// by a few points is exactly the kind of thing nobody notices until a screenshot is compared with
// an old one.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(HERE, '../../styles.css'), 'utf8');
const CONFIG = readFileSync(resolve(HERE, '../../../tailwind.config.ts'), 'utf8');

/** The stylesheet minus its comments — the prose explains the tokens and names them while doing it. */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The scale as it shipped before P12-A, straight out of the old config.
 *
 * This is the reference the tokens are checked against, so it must stay frozen: if the palette is
 * ever deliberately changed, that is a design decision that edits this table on purpose, not a
 * number that drifts to match whatever the stylesheet happens to say.
 */
const SHIPPED = {
  '50': '#eef2ff',
  '100': '#e0e7ff',
  '200': '#c7d2fe',
  '300': '#a5b4fc',
  '400': '#818cf8',
  '500': '#6366f1',
  '600': '#4f46e5',
  '700': '#4338ca',
  '800': '#3730a3',
  '900': '#312e81',
  '950': '#1e1b4b',
} as const;

const SHADES = Object.keys(SHIPPED);

/** `--brand-500: 99 102 241;` → `{ '500': '99 102 241' }`, over the whole stylesheet. */
const declaredTokens = (): Record<string, string> =>
  Object.fromEntries(
    [...CODE.matchAll(/--brand-(\d+):\s*([^;]+);/g)].map((m) => [m[1] ?? '', (m[2] ?? '').trim()]),
  );

/** `500: 'rgb(var(--brand-500) / <alpha-value>)'` → `{ '500': 'rgb(...)' }`. */
const configuredShades = (): Record<string, string> =>
  Object.fromEntries(
    [...CONFIG.matchAll(/^\s{10}(\d+): '([^']+)',$/gm)].map((m) => [m[1] ?? '', m[2] ?? '']),
  );

const toHex = (channels: string): string =>
  `#${channels
    .split(/\s+/)
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('')}`;

describe('brand tokens', () => {
  it('declares every shade the config asks for, and no others', () => {
    expect(Object.keys(declaredTokens()).sort()).toEqual(SHADES.sort());
    expect(Object.keys(configuredShades()).sort()).toEqual(SHADES.sort());
  });

  // The one that matters for opacity: Tailwind substitutes `<alpha-value>` into this wrapper, and
  // a `#hex` inside the variable would have no slot to receive it. `bg-brand-500/40` is used in
  // dozens of places and would render fully opaque instead of failing loudly.
  it('reads each shade through its variable, with the alpha placeholder intact', () => {
    for (const shade of SHADES) {
      expect(configuredShades()[shade], `brand-${shade}`).toBe(
        `rgb(var(--brand-${shade}) / <alpha-value>)`,
      );
    }
  });

  // Scoped to the `brand` block rather than run over the whole file, because the config legitimately
  // holds other colours — the two shadow tokens are `rgb(15 23 42 / …)` slate tints. A literal that
  // reappears HERE is the regression: half the scale reading the cascade and half of it frozen into
  // the bundle is worse than either, because only half the palette would respond to an override.
  it('carries no colour literal in the brand block any more', () => {
    const block = /brand: \{([\s\S]*?)\n {8}\},/.exec(CONFIG)?.[1];
    expect(block, 'the brand block should still be findable').toBeDefined();
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  // Channel triplets, because that is what `rgb()` above expects. A stray `#` or a comma-separated
  // list here produces an invalid colour that paints as nothing at all.
  it('stores channel triplets that resolve to exactly the palette that shipped', () => {
    const tokens = declaredTokens();
    for (const [shade, hex] of Object.entries(SHIPPED)) {
      const channels = tokens[shade];
      expect(channels, `brand-${shade}`).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
      expect(toHex(channels ?? ''), `brand-${shade}`).toBe(hex);
    }
  });

  // Components choose their own shade per theme (`bg-brand-50 dark:bg-brand-950`), so the scale is
  // theme-independent by design. Overriding it under `.dark` would re-colour every one of those
  // pairs at once — a decision to take deliberately, never a side effect of tokenising.
  //
  // Counted rather than pattern-matched against `.dark`: eleven declarations for eleven shades
  // means each is stated exactly once, wherever a second block might have been put.
  it('declares each shade exactly once, so neither theme overrides the scale', () => {
    const declarations = [...CODE.matchAll(/--brand-\d+:/g)];
    expect(declarations).toHaveLength(SHADES.length);
    expect(CODE.slice(CODE.indexOf(':root'), CODE.indexOf('}', CODE.indexOf(':root')))).toContain(
      '--brand-500:',
    );
  });
});
