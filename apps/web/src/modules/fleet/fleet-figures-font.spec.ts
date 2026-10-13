// «الارقام ال0 … ميكونش جوا شرطه»: ON EVERY FLEET SCREEN A ZERO IS A PLAIN ZERO.
//
// The monospace faces the Fleet screens used to set their figures in — Tailwind's `font-mono`
// (Consolas on Windows), the system stacks (`ui-monospace, SFMono-Regular, Menlo, Monaco,
// Consolas`) and JetBrains Mono — draw a zero with a slash or a dot inside it. The owner approved
// the heavy card-number look in Azeret Mono instead, whose zero is plain: Tailwind's
// `font-figures`, and `FIGURES_FONT` where a class has to win over a `'Cairo'` stack.
//
// This is a SOURCE-LEVEL guard because nothing fails when it breaks: a cell given `font-mono`
// again renders perfectly well, with the struck-through zero the owner asked to be rid of.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIGURES_FONT, NUM } from './components/FuelCardBoard';
import { MONO } from './components/FuelCardDialog';
import { DARK_TABLE, ERROR_ID_AS_FIGURES, PLAIN_CELLS } from './pages/VehiclesListPage';

const HERE = __dirname;

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.(?:tsx?|css|html)$/u.test(entry.name) && !/\.spec\.tsx?$/u.test(entry.name)
      ? [full]
      : [];
  });

/**
 * Source with its comments stripped — a rule about the code must not be broken by prose that
 * says «the boards' monospace». Only comments that open a line (or a JSX `{/* … *\/}`) are taken
 * out, so a string such as `'image/*'` is never read as the start of one.
 */
const code = (path: string): string =>
  readFileSync(path, 'utf8')
    .replace(/^\s*\/\*[\s\S]*?\*\//gmu, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/gu, '')
    .replace(/(^|\s)\/\/.*$/gmu, '$1');

const read = (path: string): string => readFileSync(join(HERE, path), 'utf8');

/** What draws a zero with something inside it, and why each is caught. */
const FORBIDDEN: readonly (readonly [string, RegExp])[] = [
  // Tailwind's `mono` — also as a selector, `[&_td_.font-mono]`.
  ['font-mono', /\bfont-mono\b/u],
  // The fuel dialogs' old face, and its `@fontsource` package.
  ['JetBrains Mono', /jetbrains/iu],
  // The system monospace stacks, by their named faces…
  [
    'a system monospace face',
    /\b(?:ui-monospace|SFMono-Regular|Consolas|Menlo|Monaco|Courier)\b/iu,
  ],
  // …and the generic `monospace` at the end of any stack: `,monospace]`, `, monospace;`,
  // `:monospace`, `'monospace'`.
  ['the generic monospace', /[,:]\s*['"]?monospace\b|['"]monospace['"]/iu],
];

describe('Fleet figures — a plain zero everywhere («الارقام ال0 … ميكونش جوا شرطه»)', () => {
  const sources = files(HERE);

  it('reads the whole module', () => {
    // A guard that silently reads nothing passes for ever.
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.map((path) => relative(HERE, path))).toContain('pages/VehiclesListPage.tsx');
  });

  it.each(FORBIDDEN)('no Fleet file sets a figure in %s', (_label, pattern) => {
    // The one sanctioned mention: the selector that takes the shared error panel's `font-mono`
    // OUT of monospace — pinned on its own below.
    const offenders = sources
      .filter((path) => pattern.test(code(path).split(ERROR_ID_AS_FIGURES).join('')))
      .map((path) => relative(HERE, path));
    expect(offenders).toEqual([]);
  });

  it('sets the shared error panel’s request id in the figures’ face on the boards’ table', () => {
    // `ErrorState` (shared, left alone) writes it `font-mono`; inside `DARK_TABLE` it is the
    // figures' face, at the sizes the table gave it before — and nothing else.
    expect(DARK_TABLE).toContain(ERROR_ID_AS_FIGURES);
    expect(ERROR_ID_AS_FIGURES.split(' ')).toEqual([
      `[&_td_.font-mono]:${FIGURES_FONT}`,
      'min-[1750px]:[&_td_.font-mono]:!text-base',
      'max-[1749px]:[&_td_.font-mono]:!text-[12.5px]',
    ]);
  });

  it('sets the figures in Azeret Mono, Arabic falling through to Cairo', () => {
    expect(FIGURES_FONT).toBe("[font-family:Azeret_Mono,'Cairo',ui-sans-serif,sans-serif]");
    expect(NUM.startsWith(`${FIGURES_FONT} `)).toBe(true);
    expect(MONO).toBe(FIGURES_FONT);
    // Unquoted, so Tailwind's alphabetical order of arbitrary properties still puts it after a
    // `'Cairo'` stack on the same element, as the monospace stack it replaced was.
    expect(FIGURES_FONT > "[font-family:'Cairo',sans-serif]").toBe(true);
    expect(FIGURES_FONT > "[font-family:'Cairo',ui-sans-serif,sans-serif]").toBe(true);
  });

  it('serves Azeret Mono from the bundle, at every weight the figures are written in', () => {
    for (const file of ['components/FuelCardBoard.tsx', 'components/FuelCardDialog.tsx']) {
      const source = read(file);
      for (const weight of [400, 500, 600, 700, 800]) {
        expect(source, `${file} ${weight}`).toContain(
          `import '@fontsource/azeret-mono/${weight}.css';`,
        );
      }
    }
  });

  it('adds `font-figures` to Tailwind and leaves `mono` as the other modules have it', () => {
    const config = readFileSync(join(HERE, '../../../tailwind.config.ts'), 'utf8');
    expect(config).toContain(`figures: ['"Azeret Mono"', 'Cairo', 'ui-sans-serif', 'sans-serif'],`);
    expect(config).not.toMatch(/\bmono\s*:/u);
  });
});

describe('the licensing chassis column («الشاسيه»)', () => {
  it('is bold, at the plate column’s size and in its type', () => {
    const source = code(join(HERE, 'pages/LicensingPage.tsx'));
    const plate = /<td className=\{(`[^`]*`)\} dir="ltr">\s*\{row\.plateNumber\}/u.exec(source);
    const chassis = /<td className=\{(`[^`]*`)\} dir="ltr">\s*\{row\.chassisNumber\}/u.exec(source);
    expect(plate?.[1]).toBe('`${cell} text-center`');
    expect(chassis?.[1]).toBe(plate?.[1]);
    expect(source).toMatch(/const cell = '[^']*\btext-sm\b[^']*\bfont-bold\b/u);
  });
});

describe('the vehicles, drivers and maintenance tables', () => {
  const PAGES = ['VehiclesListPage', 'DriversListPage', 'MaintenancePage'] as const;

  it('write every value in the normal weight, the car’s code too («كود العربية يفضل عادي»)', () => {
    // `tbody td` outweighs `DARK_TABLE`'s `td` and any weight a cell gives itself; the headings,
    // in `thead`, keep theirs.
    expect(PLAIN_CELLS).toBe('[&_tbody_td]:!font-normal [&_tbody_td_*]:!font-normal');
    for (const page of PAGES) {
      const source = code(join(HERE, `pages/${page}.tsx`));
      expect(source, page).toMatch(/DARK_TABLE,[\s\S]{0,600}PLAIN_CELLS,/u);
      expect(source, `${page}: no heavy override of its own`).not.toContain('[&_td_*]:!font-bold');
    }
  });

  it('draw the vehicles table’s line between the columns («زى السيارات ما بين العواميد خط»)', () => {
    const vehicles = read('pages/VehiclesListPage.tsx');
    expect(vehicles).toContain(
      '[&_td+td]:border-s [&_th+th]:border-s [&_td+td]:border-slate-200/70 [&_th+th]:border-slate-200/70 dark:[&_td+td]:border-slate-700/40 dark:[&_th+th]:border-slate-700/40',
    );
    for (const page of PAGES) {
      expect(code(join(HERE, `pages/${page}.tsx`)), page).not.toContain('!border-s-0');
    }
  });
});
