// «الحركة» writes every figure in Latin digits, in Arabic as in English — the owner, 2026-11-23:
// «اى ارقام خليها بالانجلش حتى لو عربى» and «انا عاوزك تعدل حاجات الحركة فقط».
//
// This guard reads the whole module, not one slice of it: every non-spec `.ts`/`.tsx` under
// `modules/fleet`, comments stripped (a quotation of the old screen is prose, not code), and every
// Arabic `fleet.*` word of the catalogue. What it refuses is each way an Arabic-Indic digit used to
// reach a Fleet reader:
//   (a) the shared `formatNumber` / `formatDate` / `formatDateTime` / `formatBusinessDateTime`,
//       which stay `ar-EG` for every other module — Fleet has `lib/fleet-figures` instead;
//   (b) an `Intl` built on plain `'ar-EG'`, except the five that print a month's or a weekday's NAME;
//   (c) formatting on the reader's locale, or on none (`toLocaleString()`, `Intl.NumberFormat('ar')`);
//   (d) a digit or «٫» built from its code point (the custody letters' old Word numerals);
//   (e) an Arabic-Indic digit, «٫», «٬» or «٪» in an Arabic `fleet.*` value;
//   (f) an image viewer that forgets `latinFigures` (its default is the Operations readout «١٠٠٪»).
// (g) shows each rule bites, and that the shared helpers did not move: other modules still read
// their Arabic-Indic digits.
//
// The two exceptions are named here, so that they cannot quietly grow: `ZoomableImage`'s default
// path (Operations' shipment receipt viewer, «١٠٠٪», key `fleet.licenseImage.zoomLevel`), and the
// five month or weekday names. Identifiers, typed text and numeric Excel cells were Latin already;
// the native date inputs follow the browser's own language and are not ours to write.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translate } from '../../platform/localization/i18n';
import { formatDate, formatNumber } from '../../shared/lib/format';
import { monthName } from './components/fleet-dashboard/dash-blocks';
import { monthOfDay } from './lib/custody-memo-editor';
import { latinDate, latinNumber } from './lib/fleet-figures';

const HERE = dirname(fileURLToPath(import.meta.url));
const I18N = join(HERE, '../../platform/localization/i18n.ts');

/** Every non-spec .ts/.tsx under `modules/fleet`, as a `/`-separated path relative to it. */
const fleetSources = (dir: string = HERE): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return fleetSources(path);
    return /\.tsx?$/u.test(name) && !/\.spec\.tsx?$/u.test(name)
      ? [relative(HERE, path).split(sep).join('/')]
      : [];
  });

/**
 * A source with its comments blanked. A block comment opens after a space, a brace or a bracket
 * (so `'image/*'` is not one); a line comment never follows a colon or a quote (so `https://` and
 * `'//'` stay code).
 */
const stripComments = (text: string): string =>
  text.replace(/(^|[\s{(,;])\/\*[\s\S]*?\*\//gu, '$1').replace(/(^|[^:'"`\\])\/\/[^\n]*/gu, '$1');

const FILES = fleetSources();
const CODE: ReadonlyMap<string, string> = new Map(
  FILES.map((file) => [file, stripComments(readFileSync(join(HERE, file), 'utf8'))]),
);
const codeOf = (file: string): string => {
  const text = CODE.get(file);
  if (text === undefined) throw new Error(`not a Fleet source: ${file}`);
  return text;
};

// ── (a) the shared digit helpers ───────────────────────────────────────────────────────────────

const SHARED_DIGIT_HELPERS = [
  'formatNumber',
  'formatDate',
  'formatDateTime',
  'formatBusinessDateTime',
] as const;
const SHARED_FORMAT = String.raw`['"][^'"\n]*\/shared\/lib\/format(?:\.tsx?)?['"]`;

/**
 * The shared digit helpers a source takes from `shared/lib/format` — named imports and re-exports
 * (multi-line, `type`, `as` included), a namespace import used by name, or a dynamic import.
 */
const sharedDigitImports = (code: string): string[] => {
  const found = new Set<string>();
  const named = new RegExp(
    String.raw`\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*${SHARED_FORMAT}`,
    'gu',
  );
  for (const match of code.matchAll(named)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name =
        part
          .trim()
          .replace(/^type\s+/u, '')
          .split(/\s+as\s+/u)[0] ?? '';
      if ((SHARED_DIGIT_HELPERS as readonly string[]).includes(name)) found.add(name);
    }
  }
  const namespace = new RegExp(
    String.raw`\bimport\s+\*\s+as\s+(\w+)\s+from\s*${SHARED_FORMAT}`,
    'gu',
  );
  for (const match of code.matchAll(namespace)) {
    for (const name of SHARED_DIGIT_HELPERS) {
      if (new RegExp(String.raw`\b${match[1] ?? ''}\.${name}\b`, 'u').test(code)) found.add(name);
    }
  }
  if (new RegExp(String.raw`\bimport\(\s*${SHARED_FORMAT}`, 'u').test(code)) found.add('import()');
  return [...found].sort();
};

/**
 * The one file allowed a shared digit helper, and which: the zoom readout's DEFAULT path, which
 * Operations' shipment receipt viewer renders («١٠٠٪»). Every Fleet host passes `latinFigures`.
 */
const SHARED_HELPER_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  'components/ZoomableImage.tsx': ['formatNumber'],
};

// ── (b) `ar-EG` without `-u-nu-latn` ───────────────────────────────────────────────────────────

/** Each quoted `ar-EG` tag that keeps Arabic-Indic digits (any tag but `ar-EG-u-nu-latn`). */
const arEgAt = (code: string): number[] =>
  [...code.matchAll(/['"`]ar-EG(?!-u-nu-latn\b)/gu)].map((match) => match.index);

/** The files whose `ar-EG` writes a NAME only — a month («نوفمبر») or a weekday («الأحد»). */
const NAME_ONLY = [
  'components/fleet-dashboard/dash-blocks.tsx',
  'components/fleet-dashboard/km-chart.tsx',
  'components/fleet-dashboard/tab-fuel-chart.tsx',
  'components/roster/roster-parts.tsx',
  'lib/custody-memo-editor.ts',
] as const;

/** The options object an `Intl` call passes after the tag at `at`: from its `{` to its `}`. */
const optionsAfter = (code: string, at: number): string => {
  const open = code.indexOf('{', at);
  const close = code.indexOf('}', open);
  return open < 0 || close < 0 ? '' : code.slice(open, close + 1);
};
const NAME_OPTION = /\b(?:month|weekday):\s*'long'/u;
const DIGIT_OPTION = /\b(?:day|year|hour|minute|second|dateStyle|timeStyle|era)\b|numeric|2-digit/u;

// ── (c) the reader's locale, or none ───────────────────────────────────────────────────────────

const LOCALE_DEFAULT: readonly RegExp[] = [
  // `x.toLocaleString()`, `(…, 'ar')`, `(locale)`, `(undefined, …)` — the reader's digits.
  /\.toLocale(?:String|DateString|TimeString)\(\s*(?:\)|['"]ar['"]|undefined\b|locale\b(?!\s*[!=]==?))/u,
  /\bIntl\.(?:NumberFormat|DateTimeFormat)\(\s*(?:\)|['"]ar['"]|undefined\b|locale\b(?!\s*[!=]==?))/u,
  // … or a choice that lands on plain 'ar': `Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en')`.
  /\.toLocale(?:String|DateString|TimeString)\([^,)]*\?\s*['"]ar['"]/u,
  /\bIntl\.(?:NumberFormat|DateTimeFormat)\([^,)]*\?\s*['"]ar['"]/u,
];
const localeDefaults = (code: string): string[] =>
  LOCALE_DEFAULT.flatMap((rule) => code.match(rule) ?? []);

// ── (d) digits built from their code points ────────────────────────────────────────────────────

const CODE_POINT_DIGIT = /fromC(?:harCode|odePoint)\([^)]*(?:0x066|0x06[fF])/u;
const ARABIC_DECIMAL = /٫|0x066[bB]|\\u066[bB]/u;

// ── (e) the catalogue ──────────────────────────────────────────────────────────────────────────

/** Arabic-Indic and Persian digits, and the Arabic decimal and thousands marks. */
const ARABIC_INDIC = /[٠-٩۰-۹٫٬]/u;
const ARABIC_PERCENT = '٪';
/** The one Fleet word allowed «٪»: the zoom readout Operations reads («١٠٠٪»). */
const PERCENT_ALLOWED = 'fleet.licenseImage.zoomLevel';

/** Every `fleet.*` key of the Arabic catalogue — a value may sit on the line after its key. */
const arabicFleetKeys = (): string[] => {
  const text = readFileSync(I18N, 'utf8');
  const start = text.indexOf('\nconst ar: Record<string, string> = {');
  const end = text.indexOf('\n};', start);
  expect(start, 'the Arabic catalogue is found').toBeGreaterThan(-1);
  return [...text.slice(start, end).matchAll(/^\s*'(fleet\.[^']+)':/gmu)].map((m) => m[1] ?? '');
};

/** The Arabic `fleet.*` words that carry an Arabic-Indic figure or mark. */
const arabicIndicWords = (words: ReadonlyMap<string, string>): string[] =>
  [...words]
    .filter(
      ([key, value]) =>
        ARABIC_INDIC.test(value) || (value.includes(ARABIC_PERCENT) && key !== PERCENT_ALLOWED),
    )
    .map(([key, value]) => `${key}: ${value}`);

// ── (f) the image viewers ──────────────────────────────────────────────────────────────────────

/** Each `<ZoomableImage …>` opening tag, whole — props may wrap and hold `{…}` with `>` inside. */
const zoomableTags = (code: string): string[] =>
  code
    .split(/<ZoomableImage\b/u)
    .slice(1)
    .map((rest) => {
      let depth = 0;
      for (let i = 0; i < rest.length; i += 1) {
        const c = rest[i];
        if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        else if (c === '>' && depth === 0) return rest.slice(0, i);
      }
      return rest;
    });
const OPTS_IN = /(?:^|\s)latinFigures(?:\s|\/|$|=\{true\})/u;

// ── the rules ──────────────────────────────────────────────────────────────────────────────────

describe('every figure in «الحركة» is in Latin digits — the owner, 2026-11-23', () => {
  it('reads the whole module', () => {
    // Not a ceiling — the module grows — but a scan that found nothing would pass everything.
    expect(FILES.length).toBeGreaterThan(300);
    expect(FILES).toContain('lib/fleet-figures.ts');
    expect(FILES).toContain('pages/VehicleDetailPage.tsx');
    expect(FILES.some((file) => file.includes('.spec.'))).toBe(false);
  });

  it('(a) takes no shared digit helper — Fleet has `lib/fleet-figures`', () => {
    const offenders = FILES.flatMap((file) =>
      sharedDigitImports(codeOf(file))
        .filter((name) => !(SHARED_HELPER_ALLOWED[file] ?? []).includes(name))
        .map((name) => `${file}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it('(a) the one exception is still needed — it bites both ways', () => {
    for (const [file, names] of Object.entries(SHARED_HELPER_ALLOWED)) {
      expect(sharedDigitImports(codeOf(file)), `${file} still takes ${names.join(', ')}`).toEqual(
        [...names].sort(),
      );
    }
    // The default readout is the Operations one, and only Operations renders it.
    const zoom = codeOf('components/ZoomableImage.tsx');
    expect(zoom).toContain("'fleet.licenseImage.zoomLevel'");
    expect(zoom).toContain("t('fleet.licenseImage.zoomPercent', { value: latinNumber(");
  });

  it('(b) builds no Arabic-Indic `ar-EG` — only the five month and weekday names', () => {
    const offenders = FILES.filter(
      (file) => !(NAME_ONLY as readonly string[]).includes(file) && arEgAt(codeOf(file)).length > 0,
    );
    expect(offenders).toEqual([]);
  });

  it('(b) each of the five writes a name and nothing a digit could reach', () => {
    for (const file of NAME_ONLY) {
      const code = codeOf(file);
      const sites = arEgAt(code);
      expect(sites.length, `${file} still needs its exception`).toBeGreaterThan(0);
      for (const at of sites) {
        const options = optionsAfter(code, at);
        expect(options, `${file}: a month or a weekday`).toMatch(NAME_OPTION);
        expect(options, `${file}: nothing but the name`).not.toMatch(DIGIT_OPTION);
        expect(
          options
            .replace(/[{}\s]/gu, '')
            .split(',')
            .filter(Boolean)
            .every((option) => /^(?:month|weekday):'long'$|^timeZone:/u.test(option)),
          `${file}: ${options}`,
        ).toBe(true);
      }
    }
    // And at run time: the names carry no digit at all; the year beside one is Latin.
    expect(monthName('2026-11-07', 'ar')).toBe('نوفمبر');
    expect(monthName('2026-11-07', 'ar')).not.toMatch(/[٠-٩]/u);
    expect(monthOfDay('2026-11-07', 'ar')).toBe('نوفمبر 2026');
    expect(monthOfDay('2026-11-07', 'ar')).not.toMatch(/[٠-٩]/u);
  });

  it('(c) never formats on the reader’s locale, or on none', () => {
    const offenders = FILES.flatMap((file) =>
      localeDefaults(codeOf(file)).map((hit) => `${file}: ${hit}`),
    );
    expect(offenders).toEqual([]);
  });

  it('(d) builds no digit, and no «٫», from its code point', () => {
    const offenders = FILES.filter(
      (file) => CODE_POINT_DIGIT.test(codeOf(file)) || ARABIC_DECIMAL.test(codeOf(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('(e) no Arabic `fleet.*` word carries an Arabic-Indic digit or mark — no allowlist', () => {
    const keys = arabicFleetKeys();
    expect(keys.length, 'the scan found the Fleet words').toBeGreaterThan(3000);
    const words = new Map(keys.map((key) => [key, translate('ar', key)]));
    for (const [key, value] of words) expect(value, `${key} exists`).not.toBe(key);
    expect(arabicIndicWords(words)).toEqual([]);
    // The one «٪» is the Operations readout, and it is still there; Fleet's own ends in «%».
    expect(translate('ar', PERCENT_ALLOWED)).toBe('{{value}}٪');
    expect(translate('ar', 'fleet.licenseImage.zoomPercent')).toBe('{{value}}%');
    expect(translate('en', 'fleet.licenseImage.zoomPercent')).toBe(
      translate('en', PERCENT_ALLOWED),
    );
  });

  it('(f) every image viewer in Fleet passes `latinFigures`', () => {
    const sites = FILES.flatMap((file) => zoomableTags(codeOf(file)).map((tag) => ({ file, tag })));
    // Not a ceiling: the nine viewers the owner sees today, and any new one.
    expect(sites.length).toBeGreaterThanOrEqual(9);
    const offenders = sites
      .filter(({ tag }) => !OPTS_IN.test(tag))
      .map(({ file, tag }) => `${file}: <ZoomableImage${tag}>`);
    expect(offenders).toEqual([]);
  });
});

describe('(g) the guard bites — and the shared helpers did not move', () => {
  it('reports a shared digit helper, however it is imported', () => {
    expect(
      sharedDigitImports("import { formatNumber } from '../../../shared/lib/format';"),
    ).toEqual(['formatNumber']);
    expect(
      sharedDigitImports(
        "import {\n  formatMoney,\n  formatDate as day,\n  type Locale,\n} from '../../shared/lib/format';",
      ),
    ).toEqual(['formatDate']);
    expect(
      sharedDigitImports(
        "import * as fmt from '../../../shared/lib/format';\nconst x = fmt.formatDateTime(at, locale);",
      ),
    ).toEqual(['formatDateTime']);
    expect(
      sharedDigitImports("export { formatBusinessDateTime } from '../shared/lib/format';"),
    ).toEqual(['formatBusinessDateTime']);
    // Money and the localized name stay allowed; so does a PROP that happens to be named alike
    // (AlarmBadge's injected `formatNumber={latin}`).
    expect(
      sharedDigitImports(
        "import { formatMoney, localized } from '../../../shared/lib/format';\n<AlarmBadge formatNumber={latin} />",
      ),
    ).toEqual([]);
  });

  it('reports an Arabic-Indic `ar-EG`, the reader’s locale, and a code-point digit', () => {
    expect(arEgAt("new Intl.NumberFormat('ar-EG')")).toHaveLength(1);
    expect(arEgAt("new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium' })")).toEqual(
      [],
    );
    expect(optionsAfter("Intl.DateTimeFormat('ar-EG', { day: 'numeric' })", 0)).toMatch(
      DIGIT_OPTION,
    );
    for (const text of [
      'n.toLocaleString()',
      "n.toLocaleString('ar')",
      'd.toLocaleDateString(locale)',
      'n.toLocaleString(undefined, { maximumFractionDigits: 2 })',
      'new Intl.NumberFormat(locale).format(n)',
      "Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en').format(n)",
    ]) {
      expect(localeDefaults(text), text).not.toEqual([]);
    }
    for (const text of [
      "n.toLocaleString('en-US')",
      "new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB')",
      'name.toLocaleLowerCase()',
    ]) {
      expect(localeDefaults(text), text).toEqual([]);
    }
    expect(CODE_POINT_DIGIT.test('String.fromCharCode(0x0660 + d)')).toBe(true);
    expect(CODE_POINT_DIGIT.test('String.fromCodePoint(0x06f0 + d)')).toBe(true);
    expect(ARABIC_DECIMAL.test("const AR_DECIMAL = '\\u066B';")).toBe(true);
    expect(ARABIC_DECIMAL.test("value.replace('.', '٫')")).toBe(true);
  });

  it('reports an Arabic-Indic word, and a «٪» outside the Operations readout', () => {
    expect(arabicIndicWords(new Map([['fleet.synthetic.count', '٣ سيارات']]))).toEqual([
      'fleet.synthetic.count: ٣ سيارات',
    ]);
    expect(arabicIndicWords(new Map([['fleet.synthetic.share', '{{value}}٪']]))).toHaveLength(1);
    expect(arabicIndicWords(new Map([['fleet.synthetic.count', '3 سيارات']]))).toEqual([]);
    expect(arabicIndicWords(new Map([[PERCENT_ALLOWED, '{{value}}٪']]))).toEqual([]);
  });

  it('reports a viewer without `latinFigures`, and passes one with it', () => {
    const tags = zoomableTags(
      '<ZoomableImage src={url} alt={t(`x`)} />\n<ZoomableImage\n  src={url}\n  onLoad={() => a > b}\n  latinFigures\n/>',
    );
    expect(tags).toHaveLength(2);
    expect(OPTS_IN.test(tags[0] ?? '')).toBe(false);
    expect(OPTS_IN.test(tags[1] ?? '')).toBe(true);
    expect(OPTS_IN.test('src={url} latinFigures={false} ')).toBe(false);
  });

  it('strips comments, not code', () => {
    expect(
      stripComments("// import { formatNumber } from '../shared/lib/format';\nconst a = 1;"),
    ).not.toContain('formatNumber');
    expect(stripComments("accept: 'image/*', // the scans\nconst b = 2; /* note */")).toContain(
      "accept: 'image/*',",
    );
    expect(stripComments("const url = 'https://example.test/a';")).toContain(
      'https://example.test/a',
    );
  });

  it('the shared helpers still write Arabic-Indic digits for the other modules', () => {
    expect(formatNumber(1000, 'ar')).toMatch(/[٠-٩]/u);
    expect(formatDate('2026-11-07T10:00:00.000Z', 'ar')).toMatch(/[٠-٩]/u);
    // Fleet's twins: Latin in Arabic, and the shared English byte for byte.
    expect(latinNumber(1000)).toBe('1,000');
    expect(latinNumber(1000)).toBe(formatNumber(1000, 'en'));
    expect(latinDate('2026-11-07T10:00:00.000Z', 'ar')).not.toMatch(/[٠-٩]/u);
    expect(latinDate('2026-11-07T10:00:00.000Z', 'en')).toBe(
      formatDate('2026-11-07T10:00:00.000Z', 'en'),
    );
  });
});
