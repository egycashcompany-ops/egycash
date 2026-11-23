// The odometer register, the workshop, the maintenance alarms and the makes write every figure in
// Latin digits — in Arabic as in English. The owner, 2026-11-23: «اى ارقام خليها بالانجلش حتى لو
// عربى» / «انا عاوزك تعدل حاجات الحركة فقط».
//
// The boards' own tables were already Latin (their local `LATIN`); what still reached for the
// shared Arabic-Indic helpers was the count over each table, the Excel text dates, and the
// dialogs' hints and warnings («الخادم يتوقع … كم», «دخلت على … كم», «… يوم …»). Those now go
// through `lib/fleet-figures`, whose English is byte for byte the shared helpers' English.
//
// The dialogs seed their fields from effects, which `renderToStaticMarkup` never runs, so their
// sentences are pinned at the call; the makes table renders, and is read.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type FleetVehicleTypeDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { VehicleTypesTable } from './components/VehicleTypesTable';
import { latinDate, latinNumber } from './lib/fleet-figures';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The six files of this slice, and the source of each with its comments stripped. */
const FILES = [
  'pages/OdometerPage.tsx',
  'pages/MaintenancePage.tsx',
  'pages/MaintenanceAlarmsPage.tsx',
  'components/RecordOdometerDialog.tsx',
  'components/MaintenanceDialogs.tsx',
  'components/VehicleTypesTable.tsx',
] as const;
type SliceFile = (typeof FILES)[number];
const code = (file: SliceFile): string =>
  readFileSync(join(HERE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const ARABIC_INDIC = /[٠-٬۰-۹]/u;

describe('every figure in Latin digits — the odometer, workshop, alarms and makes', () => {
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
      // Not called under another import either; AlarmBadge's INJECTED `formatNumber={latin}` prop
      // on the alarms board is a prop, not a call.
      expect(source, `${file}: no shared digit call`).not.toMatch(
        /\bformat(?:Number|Date|DateTime|BusinessDateTime)\(/u,
      );
      expect(source, `${file}: no Arabic-numbered Intl`).not.toMatch(/'ar-EG'(?!-u-nu-latn)/u);
      expect(source, `${file}: no locale-default formatting`).not.toMatch(
        /\.toLocale(?:String|DateString|TimeString)\(/u,
      );
      expect(source, `${file}: no Arabic-Indic literal`).not.toMatch(ARABIC_INDIC);
    }
  });

  it('each figure the reader sees goes through the Fleet helpers', () => {
    const sites: Record<SliceFile, readonly string[]> = {
      'pages/OdometerPage.tsx': [
        // The Excel file's date (a text cell), the count over the table, the delete prompt.
        'latinDate(log.date, locale)',
        "pluralKey('fleet.vehicle.count.odometer', locale, data.meta.totalItems)",
        'count: latinNumber(data.meta.totalItems)',
        'date: latinDate(deleting.date, locale)',
        'reading: latinNumber(deleting.outReading)',
      ],
      'pages/MaintenancePage.tsx': [
        'latinDate(visit.inDate, locale)',
        'latinDate(visit.outDate, locale)',
        "t('common.list.count', { count: latinNumber(data.meta.totalItems) })",
      ],
      'pages/MaintenanceAlarmsPage.tsx': [
        'latinDate(alarm.lastServiceAt, locale)',
        "t('fleet.vehicles.count', { count: latinNumber(rows.length) })",
      ],
      'components/RecordOdometerDialog.tsx': [
        'km: latinNumber(expected.data.expectedReading)',
        "t('fleet.odometer.kmValue', { km: latinNumber(derivedKm) })",
      ],
      'components/MaintenanceDialogs.tsx': [
        'return t(key, { km: latinNumber(km), date: latinDate(at, locale) });',
        'km: latinNumber(expected.data.expectedReading)',
        'km: latinNumber(visit.odometerAtService)',
      ],
      'components/VehicleTypesTable.tsx': ['latinNumber(r.maintenanceIntervalKm)'],
    };
    for (const file of FILES) {
      const source = code(file);
      expect(source, `${file} imports the Fleet helpers`).toMatch(
        /import\s*\{[^}]*\blatin(?:Number|Date)\b[^}]*\}\s*from\s*'\.\.\/lib\/fleet-figures'/u,
      );
      for (const site of sites[file]) expect(source, `${file}: ${site}`).toContain(site);
    }
    // The workshop dialogs: the counter warning, the expected reading, the entry reading, and the
    // four «below the last reading» errors with their day — every one of them.
    const dialogs = code('components/MaintenanceDialogs.tsx');
    expect(dialogs.match(/\blatinNumber\(/gu)?.length, 'seven km figures').toBe(7);
    expect(dialogs.match(/\blatinDate\(/gu)?.length, 'five days').toBe(5);
  });

  it('their sentences carry no Arabic-Indic digit, and English is unchanged', () => {
    const at = '2026-11-07T09:00:00.000Z';
    const sentences: [string, Record<string, string>][] = [
      ['fleet.odometer.expectedHint', { km: latinNumber(150250) }],
      ['fleet.odometer.kmValue', { km: latinNumber(250) }],
      ['fleet.maintenance.exitOdometerHint', { km: latinNumber(120000) }],
      [
        'fleet.maintenance.odometerBelowLast',
        { km: latinNumber(59800), date: latinDate(at, 'ar') },
      ],
      [
        'fleet.maintenance.counterBelowChain',
        { km: latinNumber(59800), date: latinDate(at, 'ar') },
      ],
      [
        'fleet.maintenance.counterAboveChain',
        { km: latinNumber(61200), date: latinDate(at, 'ar') },
      ],
      [
        'fleet.odometer.deleteWhich',
        { code: '150', date: latinDate(at, 'ar'), reading: latinNumber(150250) },
      ],
      ['fleet.vehicles.count', { count: latinNumber(1234) }],
      ['common.list.count', { count: latinNumber(1234) }],
    ];
    for (const [key, params] of sentences) {
      const text = translate('ar', key, params);
      expect(text, key).not.toBe(key);
      expect(text, `${key} in Latin digits`).not.toMatch(ARABIC_INDIC);
    }
    expect(translate('ar', 'fleet.odometer.expectedHint', { km: latinNumber(150250) })).toBe(
      'الخادم يتوقع 150,250 كم أو أكثر',
    );
    // English: the Fleet helpers ARE the shared English, so the sentence is what it was.
    expect(latinNumber(150250)).toBe('150,250');
    expect(latinDate(at, 'en')).toBe('7 Nov 2026');
  });
});

// ── The makes table ──────────────────────────────────────────────────────────

const type = (id: string, km: number, ar: string): FleetVehicleTypeDto => ({
  id,
  name: { ar, en: `Make ${id}` },
  maintenanceIntervalKm: km,
  isActive: true,
  sortOrder: null,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const renderMakes = (locale: Locale): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const items = [
    type('t1', 10_000, 'مرسيدس اسبرانتر 515'),
    type('t2', 7_500, 'تويوتا هاي اس'),
    type('t3', 0, 'ميكروباص'),
  ];
  qc.setQueryData(listKey('fleet', 'vehicleTypes', { pageSize: 100 }), {
    items,
    meta: { page: 1, pageSize: 100, totalItems: items.length, totalPages: 1 },
  });
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: {
        me: {
          id: 'u1',
          permissions: { 'fleetMaintenanceRule.manage': 'organization' },
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <VehicleTypesTable creating={false} onCloseCreate={() => undefined} />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const tbody = (markup: string): string =>
  markup.slice(markup.indexOf('<tbody'), markup.indexOf('</tbody>'));

describe('the makes table — «فترة الصيانة (كم)»', () => {
  it('writes the interval in Latin digits with a comma, in Arabic as in English', () => {
    for (const locale of ['ar', 'en'] as Locale[]) {
      const body = tbody(renderMakes(locale));
      expect(body, `${locale}: rendered`).not.toBe('');
      expect(body, `${locale}: 10,000`).toContain('>10,000<');
      expect(body, `${locale}: 7,500`).toContain('>7,500<');
      // A make with no rule still says so in words, not «0».
      expect(body, `${locale}: no rule`).toContain(translate(locale, 'fleet.settings.noRule'));
      expect(body, `${locale}: no Arabic-Indic digit`).not.toMatch(ARABIC_INDIC);
    }
  });
});
