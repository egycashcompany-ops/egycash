// «الحركة» writes every figure in Latin digits, in Arabic as in English — the owner, 2026-11-23:
// «اى ارقام خليها بالانجلش حتى لو عربى» and «انا عاوزك تعدل حاجات الحركة فقط».
//
// This guard reads the whole module, not one slice of it: every non-spec `.ts`/`.tsx` under
// `modules/fleet`, comments stripped (a quotation of the old screen is prose, not code), every
// Arabic `fleet.*` word of the catalogue and every other word Fleet names. What it refuses is each
// way an Arabic-Indic digit used to reach a Fleet reader, or could:
//   (a) the shared `formatNumber` / `formatDate` / `formatDateTime` / `formatBusinessDateTime`,
//       which stay `ar-EG` for every other module — Fleet has `lib/fleet-figures` instead;
//   (b) an `Intl` tag that keeps Arabic-Indic digits — any Arabic tag but a `-u-nu-latn` one
//       (`'ar-EG'`, `'ar-SA'`, `'ar-u-nu-arab'`), or a numbering system other than `latn` —
//       except the five that print a month's or a weekday's NAME;
//   (c) formatting on the reader's locale, or on none: every `Intl` formatter that writes a digit
//       (`NumberFormat`, `DateTimeFormat`, `RelativeTimeFormat`, `DurationFormat`) and every
//       `toLocale…String` names its tag — a quoted tag, a choice between quoted tags, or a
//       constant this file binds to one — and never plain `'ar'`;
//   (d) a digit built from its code point (the custody letters' old Word numerals);
//   (e) an Arabic-Indic digit, «٫», «٬» or «٪» in an Arabic word Fleet shows: every `fleet.*`
//       word, and every other word a Fleet source names (`common.*`, `bulk.*` …);
//   (f) an image viewer that forgets `latinFigures` (its default is the Operations readout «١٠٠٪»);
//   (h) an Arabic-Indic digit or mark written into the code itself — a literal, a `\u0660`-style
//       escape, a `0x0660` code point or an HTML entity — but for the lines that READ one a person
//       typed (the input folds, a plate's own digits);
//   (i) a shared component that writes the reader's digits (`Pagination`, `ListView`,
//       `FileUploadList` …), found by reading `shared/` with rules (a) and (b), not by a list.
// (g) shows each rule bites, and that the shared helpers did not move: other modules still read
// their Arabic-Indic digits.
//
// The exceptions are named here, so that they cannot quietly grow, and each is asserted still
// needed: `ZoomableImage`'s default path (Operations' shipment receipt viewer, «١٠٠٪», key
// `fleet.licenseImage.zoomLevel`), the five month or weekday names, the input folds, and the
// fuel reconcile's file picker (gone the moment a file is picked). Identifiers, typed text and
// numeric Excel cells were Latin already; the native date inputs follow the browser's own language
// and are not ours to write. The platform's chrome around every module (`AppShell`) is not a Fleet
// screen and is not read.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translate } from '../../platform/localization/i18n';
import { formatDate, formatNumber } from '../../shared/lib/format';
import { monthName } from './components/fleet-dashboard/dash-blocks';
import {
  FLEET_DIR,
  OPTS_IN_LATIN,
  fleetSources,
  stripComments,
  zoomableTags,
} from './fleet-source-scan';
import { monthOfDay } from './lib/custody-memo-editor';
import { latinDate, latinNumber } from './lib/fleet-figures';

const HERE = FLEET_DIR;
/** `apps/web/src`. */
const WEB = join(HERE, '../..');
const I18N = join(WEB, 'platform/localization/i18n.ts');

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

// ── (b) a tag or a numbering system that keeps Arabic-Indic digits ─────────────────────────────

/** A quoted Arabic tag with a subtag — `'ar-EG'`, `'ar-SA'`, `'ar-u-nu-arab'`, `'ar-EG-u-nu-latn'`. */
const ARABIC_TAG = /(['"`])(ar-[A-Za-z0-9-]+)\1/gu;
/**
 * Where each quoted Arabic tag that keeps Arabic-Indic digits starts — every one but those ending
 * in `-u-nu-latn`. Plain `'ar'` is everywhere a locale is compared (`locale === 'ar'`), so it is
 * (c)'s: refused where it is handed to a formatter.
 */
const arabicTagAt = (code: string): number[] =>
  [...code.matchAll(ARABIC_TAG)]
    .filter((match) => !/-u-nu-latn$/u.test(match[2] ?? ''))
    .map((match) => match.index);

/**
 * A numbering system other than Latin, in any language: `numberingSystem: 'arab'` (or one held in
 * a variable), or a `-nu-` keyword in a tag (`'en-u-nu-arab'`) — `ar`'s digits in English clothes.
 */
const NUMBERING_SYSTEM = [
  /\bnumberingSystem\s*:(?!\s*['"`]latn['"`])/u,
  /['"`][A-Za-z0-9-]*-nu-(?!latn\b)[A-Za-z0-9]+/u,
] as const;
const foreignNumbering = (code: string): string[] =>
  NUMBERING_SYSTEM.flatMap((rule) => code.match(rule) ?? []);

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

/**
 * Every call that writes digits in the tag it is handed. `Intl.PluralRules`, `Collator`,
 * `ListFormat` and `DisplayNames` write none, and `toLocaleLowerCase` is not a figure.
 */
const FORMATTER_CALL =
  /\b(?:Intl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|DurationFormat)|\.toLocale(?:String|DateString|TimeString))\(/gu;

/** The first argument of the call whose `(` is just before `open`: to its `,` or `)` at depth 0. */
const firstArgument = (code: string, open: number): string => {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < code.length; i += 1) {
    const c = code[i] ?? '';
    if (quote !== null) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) {
      if (depth === 0) return code.slice(open, i).trim();
      depth -= 1;
    } else if (c === ',' && depth === 0) return code.slice(open, i).trim();
  }
  return code.slice(open).trim();
};

const QUOTED_TAG = /^(['"`])([^'"`$\n]*)\1$/u;
const CHOICE = /^[^?]+\?\s*([^:]+?)\s*:\s*([\s\S]+)$/u;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;

/**
 * Why a formatter's tag argument is not one this file names, or `null` when it is: a quoted tag
 * (an Arabic one is (b)'s to judge — plain `'ar'` is refused here), a choice between quoted tags,
 * or a `const`/`let` this file binds to one of those (`const tag = locale === 'ar' ?
 * 'ar-EG-u-nu-latn' : 'en-GB'`). Anything else — nothing, `undefined`, the reader's `locale`, a
 * call (`intlLocale(locale)`), a lookup (`TAGS[locale]`), a built string — is the reader's digits
 * or nobody's knowing, and is refused.
 */
const tagProblem = (
  code: string,
  arg: string,
  seen: ReadonlySet<string> = new Set(),
): string | null => {
  if (arg === '') return 'no tag — the reader’s own locale';
  const quoted = QUOTED_TAG.exec(arg);
  if (quoted !== null) return quoted[2] === 'ar' ? "plain 'ar' — Arabic-Indic digits" : null;
  const choice = CHOICE.exec(arg);
  if (choice !== null) {
    return (
      tagProblem(code, (choice[1] ?? '').trim(), seen) ??
      tagProblem(code, (choice[2] ?? '').trim(), seen)
    );
  }
  if (IDENTIFIER.test(arg) && arg !== 'undefined' && !seen.has(arg)) {
    const binding = new RegExp(
      String.raw`\b(?:const|let|var)\s+${arg.replace(/\$/gu, '\\$')}\b\s*(?::[^=;]+)?=\s*([^;]+)`,
      'u',
    ).exec(code);
    if (binding !== null)
      return tagProblem(code, (binding[1] ?? '').trim(), new Set([...seen, arg]));
  }
  return `\`${arg}\` — not a tag this file names`;
};

/** Each formatter call in `code` whose tag is not named, as `call(arg) — why`. */
const localeDefaults = (code: string): string[] =>
  [...code.matchAll(FORMATTER_CALL)].flatMap((match) => {
    const open = match.index + match[0].length;
    const arg = firstArgument(code, open);
    const problem = tagProblem(code, arg);
    return problem === null ? [] : [`${match[0]}${arg}) — ${problem}`];
  });

// ── (d) digits built from their code points ────────────────────────────────────────────────────

/**
 * `String.fromCharCode` / `fromCodePoint` handed an Arabic-Indic or Persian code point — as hex
 * (`0x0660`), as decimal (`1632`, `1776`) — or another character's code point (`'٠'.charCodeAt(0)`,
 * `zero.codePointAt(0)`), the shape every digit builder takes.
 */
const CODE_POINT_DIGIT =
  /fromC(?:harCode|odePoint)\([^)]*(?:0x0*6[6fF]|\b16(?:3[2-9]|4[0-4])\b|\b17(?:7[6-9]|8[0-5])\b|charCodeAt|codePointAt)/u;

// ── (e) the catalogue ──────────────────────────────────────────────────────────────────────────

/** Arabic-Indic and Persian digits, and the Arabic decimal and thousands marks. */
const ARABIC_INDIC = /[٠-٩۰-۹٫٬]/u;
const ARABIC_PERCENT = '٪';
/** The one Fleet word allowed «٪»: the zoom readout Operations reads («١٠٠٪»). */
const PERCENT_ALLOWED = 'fleet.licenseImage.zoomLevel';

/** Every key of the Arabic catalogue — a value may sit on the line after its key. */
const arabicKeys = (): string[] => {
  const text = readFileSync(I18N, 'utf8');
  const start = text.indexOf('\nconst ar: Record<string, string> = {');
  const end = text.indexOf('\n};', start);
  expect(start, 'the Arabic catalogue is found').toBeGreaterThan(-1);
  return [...text.slice(start, end).matchAll(/^\s*'([^']+)':/gmu)].map((m) => m[1] ?? '');
};

/**
 * The words a source names outright — every quoted string that IS a catalogue key, Fleet's or not
 * (`t('common.list.count', …)`, `label: 'bulk.selected'`) — and every key of a family it builds
 * (`` `common.status.${x}` ``) outside `fleet.*`, which is read whole anyway.
 */
const namedWords = (code: string, keys: ReadonlySet<string>): string[] => {
  const named = [...code.matchAll(/(['"`])([A-Za-z][\w-]*(?:\.[\w-]+)+)\1/gu)]
    .map((m) => m[2] ?? '')
    .filter((key) => keys.has(key));
  const families = [...code.matchAll(/`([A-Za-z][\w-]*\.(?:[\w-]+\.)*)\$\{/gu)]
    .map((m) => m[1] ?? '')
    .filter((prefix) => !prefix.startsWith('fleet.'))
    .flatMap((prefix) => [...keys].filter((key) => key.startsWith(prefix)));
  return [...named, ...families];
};

/** The Arabic words that carry an Arabic-Indic figure or mark. */
const arabicIndicWords = (words: ReadonlyMap<string, string>): string[] =>
  [...words]
    .filter(
      ([key, value]) =>
        ARABIC_INDIC.test(value) || (value.includes(ARABIC_PERCENT) && key !== PERCENT_ALLOWED),
    )
    .map(([key, value]) => `${key}: ${value}`);

// ── (h) figures written into the code ──────────────────────────────────────────────────────────

/**
 * An Arabic-Indic or Persian digit, or «٪ ٫ ٬», in the code itself — written out, as a `\u0660` /
 * `\u{6F0}` escape, as a `0x0660` code point, or as an HTML entity (`&#x660;`, `&#1632;`) in a
 * paper's markup.
 */
const ARABIC_FIGURE_IN_CODE =
  /[٠-٩۰-۹٪٫٬]|\\u0*6(?:6[0-9a-c]|f[0-9])|\\u\{0*6(?:6[0-9a-c]|f[0-9])\}|\b0x0*6(?:6[0-9a-c]|f[0-9])\b|&#(?:x0*6(?:6[0-9a-c]|f[0-9])|16(?:3[2-9]|4[0-4])|17(?:7[6-9]|8[0-5]));/iu;

/** The lines of `code` that write an Arabic-Indic figure or mark, trimmed. */
const figureLines = (code: string): string[] =>
  code
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => ARABIC_FIGURE_IN_CODE.test(line));

/**
 * The lines allowed one, word for word: each READS a figure a person typed or a scan carries —
 * to fold it to Latin, or to find a plate's own digits (a plate is an identifier, kept as written)
 * — and none writes one. A new line, or a changed one, is refused until it is named here.
 */
const READS_ARABIC_FIGURES: Readonly<Record<string, readonly string[]>> = {
  // The insurer form's typed date and number, folded before they are read.
  'lib/notice-setup.ts': [
    'const ARABIC_DIGITS = /[٠-٩]/gu;',
    'const plain = text.trim().replace(ARABIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0660));',
  ],
  // A plate split into its letters and its digits, which stay the plate's own.
  'lib/notice-render.ts': [
    "const digits = (value.match(/[0-9٠-٩]+/gu) ?? []).join('');",
    ".replace(/[0-9٠-٩]/gu, '')",
  ],
  // The custody letter's typed reason: «١٢٫٥» prints «12.5», «١٬٢٠٠» prints «1,200».
  'lib/custody-paper-letters.ts': [
    'const TYPED_DECIMAL_MARK = /(?<=\\d)٫(?=\\d)/gu;',
    'const TYPED_THOUSANDS_MARK = /(?<=\\d)٬(?=\\d)/gu;',
  ],
};

// ── (i) shared components that write the reader's digits ───────────────────────────────────────

/** A static import or re-export: what it names (`*` for a namespace or a barrel) and from where. */
interface Import {
  readonly spec: string;
  readonly names: readonly string[];
}
const STATIC_IMPORT = /\b(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*['"]([^'"]+)['"]/gu;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/gu;

/** The values a module takes from others — type-only imports write nothing and are left out. */
const importsOf = (code: string): Import[] => [
  ...[...code.matchAll(STATIC_IMPORT)].flatMap((match): Import[] => {
    if (match[1] !== undefined) return [];
    const clause = match[2] ?? '';
    const braces = /\{([^}]*)\}/u.exec(clause);
    const named = (braces?.[1] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '' && !part.startsWith('type '))
      .map((part) => part.split(/\s+as\s+/u)[0] ?? '');
    const whole = clause
      .replace(/\{[^}]*\}/u, '')
      .replace(/,/gu, '')
      .trim();
    const names = [...named, ...(whole === '' ? [] : ['*'])];
    return names.length === 0 ? [] : [{ spec: match[3] ?? '', names }];
  }),
  ...[...code.matchAll(DYNAMIC_IMPORT)].map((match) => ({ spec: match[1] ?? '', names: ['*'] })),
];

/** A relative import of `fromFile` (a path under `apps/web/src`), as a path under it — or null. */
const resolveImport = (fromFile: string, spec: string): string | null => {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(join(WEB, fromFile)), spec);
  for (const path of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(path) && statSync(path).isFile())
      return relative(WEB, path).split(sep).join('/');
  }
  return null;
};

/**
 * The modules of `shared/` that write a figure in the reader's locale: those that take a shared
 * digit helper (rule (a)) or build an Arabic-Indic tag (rule (b)) — and, by closure, every shared
 * module that takes a value from one of them (a barrel, a wrapper). `shared/lib/format` itself is
 * rule (a)'s.
 */
const sharedDigitWriters = (): ReadonlySet<string> => {
  const sources = new Map(
    fleetSources(join(WEB, 'shared')).map((file) => {
      const path = `shared/${file}`;
      return [path, stripComments(readFileSync(join(WEB, path), 'utf8'))] as const;
    }),
  );
  const imports = new Map(
    [...sources].map(([path, code]) => [
      path,
      importsOf(code).flatMap(({ spec, names }) => {
        const target = resolveImport(path, spec);
        return target === null ? [] : [{ target, names }];
      }),
    ]),
  );
  const writers = new Set(
    [...sources]
      .filter(([path]) => path !== 'shared/lib/format.ts')
      .filter(
        ([path, code]) =>
          arabicTagAt(code).length > 0 ||
          (imports.get(path) ?? []).some(
            ({ target, names }) =>
              target === 'shared/lib/format.ts' &&
              names.some((name) => (SHARED_DIGIT_HELPERS as readonly string[]).includes(name)),
          ),
      )
      .map(([path]) => path),
  );
  for (let grew = true; grew;) {
    grew = false;
    for (const [path, taken] of imports) {
      if (writers.has(path) || path === 'shared/lib/format.ts') continue;
      if (taken.some(({ target }) => writers.has(target))) {
        writers.add(path);
        grew = true;
      }
    }
  }
  return writers;
};

/** What a Fleet source takes from a shared digit writer, as `target: name` each. */
const writerImports = (file: string, code: string, writers: ReadonlySet<string>): string[] =>
  importsOf(code).flatMap(({ spec, names }) => {
    const target = resolveImport(`modules/fleet/${file}`, spec);
    return target !== null && writers.has(target) ? names.map((name) => `${target}: ${name}`) : [];
  });

/**
 * The one shared digit writer Fleet takes, and what: the fuel reconcile's file picker. Its list of
 * picked files writes their sizes in `ar-EG`, but the card unmounts the picker the moment a file is
 * picked (`file === null ? <FileUpload …/> : …`) and writes the chosen file's size itself, in
 * `en-US` — so that list never reaches the reader. `FileUploadList` stays refused.
 */
const SHARED_WRITER_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  'components/fuel-reconcile/ReconcileUploadCard.tsx': ['shared/ui/FileUpload.tsx: FileUpload'],
};

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

  it('(b) builds no Arabic-Indic tag — only the five month and weekday names', () => {
    const offenders = FILES.filter(
      (file) =>
        !(NAME_ONLY as readonly string[]).includes(file) && arabicTagAt(codeOf(file)).length > 0,
    );
    expect(offenders).toEqual([]);
  });

  it('(b) asks for no numbering system but Latin, in any language', () => {
    const offenders = FILES.flatMap((file) =>
      foreignNumbering(codeOf(file)).map((hit) => `${file}: ${hit}`),
    );
    expect(offenders).toEqual([]);
  });

  it('(b) each of the five writes a name and nothing a digit could reach', () => {
    for (const file of NAME_ONLY) {
      const code = codeOf(file);
      const sites = arabicTagAt(code);
      expect(sites.length, `${file} still needs its exception`).toBeGreaterThan(0);
      for (const at of sites) {
        expect(code.slice(at, at + 7), `${file}: the name's tag is plain ar-EG`).toBe("'ar-EG'");
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

  it('(c) never formats on the reader’s locale, or on none — every formatter names its tag', () => {
    const offenders = FILES.flatMap((file) =>
      localeDefaults(codeOf(file)).map((hit) => `${file}: ${hit}`),
    );
    expect(offenders).toEqual([]);
    // The scan reads real calls: Fleet formats in dozens of places, a tag held in a constant
    // among them (the month filters' `tag`, Latin in Arabic).
    const calls = FILES.flatMap((file) => [...codeOf(file).matchAll(FORMATTER_CALL)]);
    expect(calls.length).toBeGreaterThan(40);
    expect(codeOf('lib/licence-months.ts')).toContain('new Intl.NumberFormat(tag)');
  });

  it('(d) builds no digit from its code point', () => {
    const offenders = FILES.filter((file) => CODE_POINT_DIGIT.test(codeOf(file)));
    expect(offenders).toEqual([]);
  });

  it('(e) no Arabic `fleet.*` word carries an Arabic-Indic digit or mark — no allowlist', () => {
    const keys = arabicKeys().filter((key) => key.startsWith('fleet.'));
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

  it('(e) nor does any other word a Fleet source names — `common.*`, `bulk.*` and the rest', () => {
    const keys = new Set(arabicKeys());
    const named = new Set(FILES.flatMap((file) => namedWords(codeOf(file), keys)));
    const others = [...named].filter((key) => !key.startsWith('fleet.'));
    // The shared words Fleet shows today — the list count, the pager, «إلغاء» … — are read.
    expect(others.length, 'the scan found the shared words').toBeGreaterThan(20);
    expect(others).toContain('common.list.count');
    expect(arabicIndicWords(new Map(others.map((key) => [key, translate('ar', key)])))).toEqual([]);
  });

  it('(f) every image viewer in Fleet passes `latinFigures`', () => {
    const sites = FILES.flatMap((file) => zoomableTags(codeOf(file)).map((tag) => ({ file, tag })));
    // Not a ceiling: the nine viewers the owner sees today, and any new one.
    expect(sites.length).toBeGreaterThanOrEqual(9);
    const offenders = sites
      .filter(({ tag }) => !OPTS_IN_LATIN.test(tag))
      .map(({ file, tag }) => `${file}: <ZoomableImage${tag}>`);
    expect(offenders).toEqual([]);
  });

  it('(h) writes no Arabic-Indic digit or mark into the code — but the lines that read one', () => {
    const offenders = FILES.flatMap((file) =>
      figureLines(codeOf(file))
        .filter((line) => !(READS_ARABIC_FIGURES[file] ?? []).includes(line))
        .map((line) => `${file}: ${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it('(h) each line that reads one is still there, still reads, and writes nothing', () => {
    for (const [file, lines] of Object.entries(READS_ARABIC_FIGURES)) {
      const found = figureLines(codeOf(file));
      for (const line of lines) {
        expect(found, `${file} still needs «${line}»`).toContain(line);
        // A character class or a lookaround inside a regular expression, or a subtraction from
        // the zero's code point: the figure is matched or measured, never produced.
        expect(line, `${file}: «${line}» reads`).toMatch(
          /\/[^/\n]*(?:\[[^\]\n]*[٠-٩٫٬][^\]\n]*\]|\)[٫٬]\(\?=)[^/\n]*\/[a-z]*|-\s*0x0660\b/u,
        );
      }
    }
  });

  it('(i) takes no shared component that writes the reader’s digits', () => {
    const writers = sharedDigitWriters();
    const offenders = FILES.flatMap((file) =>
      writerImports(file, codeOf(file), writers)
        .filter((hit) => !(SHARED_WRITER_ALLOWED[file] ?? []).includes(hit))
        .map((hit) => `${file} takes ${hit}`),
    );
    expect(offenders).toEqual([]);
  });

  it('(i) the one exception is still needed, and the picker is gone once a file is picked', () => {
    const writers = sharedDigitWriters();
    for (const [file, hits] of Object.entries(SHARED_WRITER_ALLOWED)) {
      expect(writerImports(file, codeOf(file), writers), file).toEqual([...hits]);
    }
    const card = codeOf('components/fuel-reconcile/ReconcileUploadCard.tsx');
    expect(card).toMatch(/\{file === null \? \(\s*<div[^>]*>\s*<FileUpload\b/u);
    expect(card.match(/<FileUpload\b/gu)).toHaveLength(1);
    expect(card).not.toMatch(/<FileUploadList\b/u);
    // The chosen file's size, which the card writes in place of the picker's list, is Latin.
    expect(card).toContain(".toLocaleString('en-US', { maximumFractionDigits: 1 })} KB");
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

  it('reports every Arabic tag that keeps Arabic-Indic digits, and a foreign numbering system', () => {
    for (const text of [
      "new Intl.NumberFormat('ar-EG')",
      "new Intl.NumberFormat('ar-SA')",
      'new Intl.NumberFormat("ar-u-nu-arab")',
      "new Intl.DateTimeFormat(`ar-EG-u-nu-arab`, { dateStyle: 'medium' })",
    ]) {
      expect(arabicTagAt(text), text).toHaveLength(1);
    }
    for (const text of [
      "new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium' })",
      "new Intl.NumberFormat('ar-u-nu-latn')",
      "locale === 'ar' ? x : y",
    ]) {
      expect(arabicTagAt(text), text).toEqual([]);
    }
    expect(optionsAfter("Intl.DateTimeFormat('ar-EG', { day: 'numeric' })", 0)).toMatch(
      DIGIT_OPTION,
    );
    for (const text of [
      "new Intl.NumberFormat('en-US', { numberingSystem: 'arab' })",
      'new Intl.NumberFormat(tag, { numberingSystem: system })',
      "new Intl.NumberFormat('en-u-nu-arab')",
    ]) {
      expect(foreignNumbering(text), text).not.toEqual([]);
    }
    for (const text of [
      "new Intl.NumberFormat('en-US', { numberingSystem: 'latn' })",
      "new Intl.NumberFormat('ar-EG-u-nu-latn')",
    ]) {
      expect(foreignNumbering(text), text).toEqual([]);
    }
  });

  it('reports a formatter on the reader’s locale, on none, or on a tag it does not name', () => {
    for (const text of [
      'n.toLocaleString()',
      "n.toLocaleString('ar')",
      'd.toLocaleDateString(locale)',
      'n.toLocaleString(undefined, { maximumFractionDigits: 2 })',
      'new Intl.NumberFormat(locale).format(n)',
      "Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en').format(n)",
      "new Intl.RelativeTimeFormat('ar', { numeric: 'auto' })",
      "new Intl.DurationFormat('ar')",
      'n.toLocaleString(lang)',
      'new Intl.NumberFormat(intlLocale(locale))',
      'new Intl.NumberFormat(TAGS[locale])',
      'new Intl.NumberFormat(`ar-${region}`)',
      'const locale = useAppSelector((s) => s.locale.locale);\nn.toLocaleString(locale)',
    ]) {
      expect(localeDefaults(text), text).not.toEqual([]);
    }
    for (const text of [
      "n.toLocaleString('en-US')",
      "new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB')",
      "const tag = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';\nnew Intl.NumberFormat(tag)",
      "new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' })",
      "new Intl.PluralRules('ar')",
      'name.toLocaleLowerCase()',
    ]) {
      expect(localeDefaults(text), text).toEqual([]);
    }
  });

  it('reports a digit built from its code point', () => {
    for (const text of [
      'String.fromCharCode(0x0660 + d)',
      'String.fromCodePoint(0x06f0 + d)',
      'String.fromCharCode(1632 + d)',
      'String.fromCodePoint(1776 + d)',
      "String.fromCharCode('٠'.charCodeAt(0) + d)",
      'String.fromCharCode(zero.codePointAt(0) + d)',
    ]) {
      expect(CODE_POINT_DIGIT.test(text), text).toBe(true);
    }
    // A Latin letter for a sheet's column is not a figure.
    expect(CODE_POINT_DIGIT.test('String.fromCharCode(65 + column)')).toBe(false);
  });

  it('reports an Arabic-Indic figure or mark written into the code, however it is written', () => {
    for (const text of [
      "const n = '٣ سيارات';",
      "const digit = '٠١٢٣٤٥٦٧٨٩'[d];",
      "const persian = '۱۲';",
      "value.replace('.', '٫')",
      "value.replace(',', '٬')",
      'const share = `${n}٪`;',
      "const AR_DECIMAL = '\\u066B';",
      "const zero = '\\u0660';",
      "const zero = '\\u{6F0}';",
      'const base = 0x0660;',
      "html += '&#x0663;';",
      "html += '&#1635;';",
    ]) {
      expect(figureLines(text), text).toHaveLength(1);
    }
    for (const text of [
      "const n = '3 سيارات';",
      'const share = `${n}%`;',
      "const rlm = '\\u200F';",
      'const amount = 1640;',
    ]) {
      expect(figureLines(text), text).toEqual([]);
    }
  });

  it('reports an Arabic-Indic word, Fleet’s or not, and a «٪» outside the Operations readout', () => {
    expect(arabicIndicWords(new Map([['fleet.synthetic.count', '٣ سيارات']]))).toEqual([
      'fleet.synthetic.count: ٣ سيارات',
    ]);
    expect(arabicIndicWords(new Map([['fleet.synthetic.share', '{{value}}٪']]))).toHaveLength(1);
    expect(arabicIndicWords(new Map([['common.synthetic.page', 'صفحة ١']]))).toHaveLength(1);
    expect(arabicIndicWords(new Map([['fleet.synthetic.count', '3 سيارات']]))).toEqual([]);
    expect(arabicIndicWords(new Map([[PERCENT_ALLOWED, '{{value}}٪']]))).toEqual([]);
    // A word is read whether it is handed to `t` or kept in a constant, and a family by its prefix.
    const keys = new Set([
      'common.list.count',
      'bulk.selected',
      'common.status.a',
      'common.status.b',
    ]);
    expect(
      namedWords(
        "t('common.list.count', { count });\nconst LABEL = 'bulk.selected';\nt(`common.status.${s}`);",
        keys,
      ).sort(),
    ).toEqual(['bulk.selected', 'common.list.count', 'common.status.a', 'common.status.b']);
  });

  it('reports a viewer without `latinFigures`, and passes one with it', () => {
    const tags = zoomableTags(
      '<ZoomableImage src={url} alt={t(`x`)} />\n<ZoomableImage\n  src={url}\n  onLoad={() => a > b}\n  latinFigures\n/>',
    );
    expect(tags).toHaveLength(2);
    expect(OPTS_IN_LATIN.test(tags[0] ?? '')).toBe(false);
    expect(OPTS_IN_LATIN.test(tags[1] ?? '')).toBe(true);
    expect(OPTS_IN_LATIN.test('src={url} latinFigures={false} ')).toBe(false);
  });

  it('finds the shared components that write the reader’s digits, and reports Fleet taking one', () => {
    const writers = sharedDigitWriters();
    // Read from `shared/`, not listed: the pager and the list's count (shared `formatNumber`),
    // the picker's file sizes (`ar-EG`), and the barrel that re-exports them.
    for (const path of [
      'shared/ui/Pagination.tsx',
      'shared/ui/ListView.tsx',
      'shared/ui/FileUpload.tsx',
      'shared/ui/index.ts',
    ]) {
      expect(writers.has(path), path).toBe(true);
    }
    // …and not the ones Fleet draws its figures with.
    for (const path of [
      'shared/ui/NumberedPager.tsx',
      'shared/ui/DataTable.tsx',
      'shared/lib/format.ts',
    ]) {
      expect(writers.has(path), path).toBe(false);
    }
    const file = 'components/SyntheticBoard.tsx';
    expect(
      writerImports(
        file,
        "import { Pagination } from '../../../shared/ui/Pagination';\n" +
          "import { FileUpload, FileUploadList } from '../../../shared/ui/FileUpload';\n" +
          "import { NumberedPager } from '../../../shared/ui/NumberedPager';\n" +
          "import { type ListViewProps } from '../../../shared/ui/ListView';\n" +
          "const Lazy = lazy(() => import('../../../shared/ui/ListView'));",
        writers,
      ),
    ).toEqual([
      'shared/ui/Pagination.tsx: Pagination',
      'shared/ui/FileUpload.tsx: FileUpload',
      'shared/ui/FileUpload.tsx: FileUploadList',
      'shared/ui/ListView.tsx: *',
    ]);
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
