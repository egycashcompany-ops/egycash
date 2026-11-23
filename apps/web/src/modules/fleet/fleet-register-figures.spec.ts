// The violations screen and the register sheets write every figure in Latin digits — in Arabic as
// in English. The owner, 2026-11-23: «اى ارقام خليها بالانجلش حتى لو عربى» / «انا عاوزك تعدل حاجات
// الحركة فقط».
//
// The boards' own tables were already Latin (year-first «2026/10/01», their local `LATIN`s, the
// money formatter); what still reached for the shared Arabic-Indic helpers was the count over each
// table, the counts on the violations boards, the company form's live amount, the detail layer's
// count and day, the dealership invoice's day, and the date column of every Excel / PDF sheet these
// registers write. Those now go through `lib/fleet-figures`, whose English is byte for byte the
// shared helpers' English.
//
// The sheets are built inside click handlers, which `renderToStaticMarkup` never runs, so their
// cells are pinned at the call; the screens that render are read in `fleet-violations-split` and
// `pages/receipts-screen`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translate } from '../../platform/localization/i18n';
import { formatDate, formatNumber } from '../../shared/lib/format';
import { latinDate, latinNumber } from './lib/fleet-figures';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The eleven files of this slice. */
const FILES = [
  'components/CompanyViolationsPanel.tsx',
  'components/CompanyViolationsDetailLayer.tsx',
  'components/DriverViolationsPanel.tsx',
  'pages/DealershipPage.tsx',
  'components/DealershipInvoiceDialog.tsx',
  'pages/ReceiptsPage.tsx',
  'pages/CustodyPage.tsx',
  'pages/FuelCardsPage.tsx',
  'pages/FuelChargingPage.tsx',
  'pages/LicenseExpensesPage.tsx',
  'components/VehicleContractsExport.tsx',
] as const;
type SliceFile = (typeof FILES)[number];

/** A file's source with its comments stripped: a rule about the code must not be met by prose. */
const code = (file: SliceFile): string =>
  readFileSync(join(HERE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const ARABIC_INDIC = /[٠-٬۰-۹]/u;
const COUNT = "t('common.list.count', { count: latinNumber(data.meta.totalItems) })";

describe('every figure in Latin digits — the violations boards and the register sheets', () => {
  it('no file of the slice reaches for the shared Arabic-Indic helpers', () => {
    for (const file of FILES) {
      const source = code(file);
      // Every name taken from `shared/lib/format`, multi-line imports included.
      const shared = [
        ...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[./]*shared\/lib\/format'/gu),
      ].flatMap((m) => (m[1] as string).split(',').map((name) => name.trim()));
      for (const name of [
        'formatNumber',
        'formatDate',
        'formatDateTime',
        'formatBusinessDateTime',
      ]) {
        expect(shared, `${file} imports no shared ${name}`).not.toContain(name);
      }
      expect(source, `${file}: no shared digit call`).not.toMatch(
        /\bformat(?:Number|Date|DateTime|BusinessDateTime)\(/u,
      );
      expect(source, `${file}: no Arabic-numbered Intl`).not.toMatch(/['"]ar-EG['"]/u);
      // «شحن الكروت» writes a balance with `toLocaleString('en-US', …)`, which is Latin by name;
      // what is refused is the reader's locale, or none at all.
      expect(source, `${file}: no locale-default formatting`).not.toMatch(
        /\.toLocale(?:String|DateString|TimeString)\(\s*(?:\)|'ar|locale\b)/u,
      );
      expect(source, `${file}: no Intl built on the reader's locale`).not.toMatch(
        /new Intl\.(?:NumberFormat|DateTimeFormat)\(\s*(?:'ar'|locale\b)/u,
      );
      expect(source, `${file}: no Arabic-Indic literal`).not.toMatch(ARABIC_INDIC);
    }
  });

  it('each figure the reader sees goes through the Fleet helpers', () => {
    const sites: Record<SliceFile, readonly (readonly [string, number])[]> = {
      'components/CompanyViolationsPanel.tsx': [
        // The drop toast, the form's live amount, the badge, the four lines' counts, the tick.
        ['count: latinNumber(moved)', 1],
        ['latinNumber(Number(formValue) * Number(formCount))', 1],
        ['{latinNumber(rows.length)}', 1],
        ['latinNumber(row[total.count] as number)', 1],
        ['collected: latinNumber(row.collectedCount)', 1],
        ['total: latinNumber(row.rowCount)', 1],
      ],
      'components/CompanyViolationsDetailLayer.tsx': [
        ['latinNumber(v.count ?? 0)', 1],
        ['latinDate(v.date, locale)', 1],
      ],
      'components/DriverViolationsPanel.tsx': [
        ['{latinNumber(meta?.totalItems ?? 0)}', 1],
        ['total: latinNumber(loadState.total)', 2],
        ['shown: latinNumber(loadState.shown)', 1],
      ],
      // The Excel text cell and the PDF row write the same day; the count is over the table.
      'pages/DealershipPage.tsx': [
        ['latinDate(row.outDate, locale)', 2],
        [COUNT, 1],
      ],
      'components/DealershipInvoiceDialog.tsx': [['value={latinDate(row.outDate, locale)}', 1]],
      'pages/ReceiptsPage.tsx': [
        ['latinDate(row.date, locale)', 2],
        [COUNT, 1],
      ],
      // One `line()` feeds both the Excel and the PDF.
      'pages/CustodyPage.tsx': [
        ['latinDate(row.date, locale)', 1],
        [COUNT, 1],
      ],
      'pages/FuelCardsPage.tsx': [['latinDate(card.expiresAt, locale)', 1]],
      'pages/FuelChargingPage.tsx': [
        ["card.lastChargedAt === null ? '' : latinDate(card.lastChargedAt, locale)", 1],
      ],
      'pages/LicenseExpensesPage.tsx': [['latinDate(row.date, locale)', 2]],
      // A contract with no deadline keeps its empty cell rather than a «—».
      'components/VehicleContractsExport.tsx': [
        ['latinDate(row.date, locale)', 1],
        ["row.deadline === null ? '' : latinDate(row.deadline, locale)", 1],
      ],
    };
    for (const file of FILES) {
      const source = code(file);
      expect(source, `${file} imports the Fleet helpers`).toMatch(
        /import\s*\{[^}]*\blatin(?:Number|Date)\b[^}]*\}\s*from\s*'\.\.\/lib\/fleet-figures'/u,
      );
      for (const [site, times] of sites[file]) {
        expect(source.split(site).length - 1, `${file}: ${site}`).toBe(times);
      }
    }
  });

  it('their sentences and sheet days carry no Arabic-Indic digit, and English is unchanged', () => {
    const day = '2026-10-01T00:00:00.000Z';
    const sentences: [string, Record<string, string>][] = [
      ['common.list.count', { count: latinNumber(1234) }],
      ['fleet.violations.movedToYear', { count: latinNumber(12), code: '168', year: '2026' }],
      ['fleet.violations.collectedOf', { collected: latinNumber(7), total: latinNumber(1234) }],
      ['fleet.violations.loadedOf', { shown: latinNumber(100), total: latinNumber(440) }],
      ['fleet.violations.allLoaded', { total: latinNumber(1500) }],
    ];
    for (const [key, params] of sentences) {
      const text = translate('ar', key, params);
      expect(text, key).not.toBe(key);
      expect(text, `${key} in Latin digits`).not.toMatch(ARABIC_INDIC);
    }
    expect(translate('ar', 'fleet.violations.loadedOf', { shown: '100', total: '440' })).toBe(
      'معروض 100 من 440',
    );
    // The sheets' day: the shared Arabic order and marks, only the digits Latin — a text cell, so
    // the Excel keeps it as written.
    expect(latinDate(day, 'ar'), 'Latin digits').not.toMatch(ARABIC_INDIC);
    expect(latinDate(day, 'ar')).toBe(
      formatDate(day, 'ar').replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660)),
    );
    // The company form's amount: a 3-decimal input still reads as English always read it.
    expect(latinNumber(112.5 * 3)).toBe(formatNumber(337.5, 'en'));
    expect(latinNumber(1.125)).toBe('1.125');
    // English: the Fleet helpers ARE the shared English, so the sheets are what they were.
    expect(latinDate(day, 'en')).toBe(formatDate(day, 'en'));
    expect(latinNumber(1234)).toBe(formatNumber(1234, 'en'));
  });
});
