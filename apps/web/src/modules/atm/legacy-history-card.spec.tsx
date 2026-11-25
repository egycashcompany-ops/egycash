// «استيراد السجل القديم» on /atm/settings (docs/12-planning/atm-legacy-history-import.md), rendered
// from a pre-filled query cache as the other settings cards are pinned. It pins:
//   · one row per source, its branch named as the server names it, its last run and its copies;
//   · the actions a row offers — the preview, «متابعة» for a paused run, «تراجع» while it holds
//     copies — and none for a source with no branch;
//   · the preview held back unless it found rows, decided both kinds' times and has rows to copy,
//     and the body a typed cut makes;
//   · a run's progress counted from the rows it read;
//   · what the preview leaves unsaid (a reason no row met) and how long its code list grows;
//   · the refusals worded in the reader's language, and a busy step told apart from a failure.
//
// Every id, code and name below is synthetic.
import { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  ErrorCodes,
  type AtmLegacyImportPreviewDto,
  type AtmLegacyImportRunDto,
  type AtmLegacyKindPreviewDto,
  type AtmLegacySourceDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { ApiError } from '../../shared/lib/api-client';
import { LegacyHistoryCard } from './components/settings/LegacyHistoryCard';
import {
  cutoverFromLocal,
  isStepBusy,
  legacyErrorText,
  legacyImportAllowed,
  legacyImportBody,
  legacyRunProgress,
  legacySourceStatus,
  percentOf,
  shownSkipReasons,
  unclearKinds,
  unresolvedCodesText,
} from './components/settings/legacy-history-view';
import { atmLegacySourcesKey } from './api/settings-queries';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const ALEX = '650000000000000000000501';

const run = (over: Partial<AtmLegacyImportRunDto> = {}): AtmLegacyImportRunDto => {
  const kind = {
    read: 0,
    written: 0,
    existing: 0,
    skipped: { deleted: 0, noOpenTime: 0, open: 0, afterCutover: 0, unresolved: 0 },
  };
  return {
    id: '650000000000000000000901',
    source: 'alex',
    branchId: ALEX,
    branchName: { ar: 'الاسكندرية', en: 'Alexandria' },
    cutoverAt: '2026-11-23T19:57:01.000Z',
    state: 'done',
    nextKind: null,
    replenishment: { ...kind, read: 62_431, written: 43_000, timeMode: 'cairoLabelled' },
    maintenance: { ...kind, read: 1_000, written: 900, timeMode: 'utc' },
    totals: { replenishment: 62_431, maintenance: 63_671 },
    actorName: 'SYN',
    startedAt: '2026-11-25T10:00:00.000Z',
    lastStepAt: '2026-11-25T10:05:00.000Z',
    finishedAt: null,
    error: null,
    ...over,
  };
};

const source = (over: Partial<AtmLegacySourceDto> = {}): AtmLegacySourceDto => ({
  source: 'alex',
  branchId: ALEX,
  branchName: { ar: 'الاسكندرية', en: 'Alexandria' },
  lastRun: null,
  copiedRows: 0,
  ...over,
});

const kindPreview = (over: Partial<AtmLegacyKindPreviewDto> = {}): AtmLegacyKindPreviewDto => ({
  total: 10,
  skipped: { deleted: 1, noOpenTime: 0, open: 1, afterCutover: 1, unresolved: 0 },
  toImport: 7,
  unresolvedCodes: [],
  timeMode: 'utc',
  evidence: { rows: 10, asWritten: 9, cairoShifted: 0 },
  timeModeClear: true,
  firstOpenedAt: null,
  lastOpenedAt: null,
  ...over,
});

const preview = (over: Partial<AtmLegacyImportPreviewDto> = {}): AtmLegacyImportPreviewDto => ({
  source: 'alex',
  branchId: ALEX,
  branchName: null,
  cutoverAt: null,
  sourceFound: true,
  replenishment: kindPreview(),
  maintenance: kindPreview(),
  ...over,
});

const store = (permissions: Record<string, string>) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: { id: 'u1', permissions } as unknown as MeDto, status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const cardWith = (
  sources: AtmLegacySourceDto[],
  permissions: Record<string, string> = { 'atmSettings.manage': 'organization' },
): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(atmLegacySourcesKey(), sources);
  const node: ReactNode = <LegacyHistoryCard />;
  return renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/atm/settings']}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The markup of one source's row. */
const rowOf = (html: string, name: string): string =>
  new RegExp(`<li[^>]*data-legacy-source="${name}"[^>]*>(.*?)</li>`, 'u').exec(html)?.[1] ?? '';

describe('the legacy history card', () => {
  it('names each source’s branch as the server does, with what it last did', () => {
    const html = cardWith([
      source(),
      source({ source: 'portsaid', branchId: null, branchName: null }),
      source({
        source: 'tanta',
        branchName: { ar: 'طنطا', en: 'Tanta' },
        lastRun: run(),
        copiedRows: 43_900,
      }),
    ]);
    expect(html).toContain(t('atm.settings.legacy.title'));
    expect(rowOf(html, 'alex')).toContain(
      t('atm.settings.legacy.row', { source: 'alex', branch: 'الاسكندرية' }),
    );
    expect(rowOf(html, 'alex')).toContain(t('atm.settings.legacy.never'));
    expect(rowOf(html, 'portsaid')).toContain(t('atm.settings.legacy.noBranch'));
    expect(rowOf(html, 'tanta')).toContain(t('atm.settings.legacy.last.done'));
  });

  it('offers the preview, «متابعة» for a paused run, and «تراجع» only while a source holds copies', () => {
    const html = cardWith([
      source(),
      source({ source: 'tanta', lastRun: run(), copiedRows: 43_900 }),
      source({
        source: 'wsal',
        lastRun: run({ state: 'running', source: 'wsal' }),
        copiedRows: 10,
      }),
    ]);
    const actions = (name: string) =>
      [...rowOf(html, name).matchAll(/data-legacy-action="(\w+)"/gu)].map((m) => m[1]);
    expect(actions('alex')).toEqual(['preview']);
    expect(actions('tanta')).toEqual(['preview', 'undo']);
    // A paused run is carried on, never started over beside itself.
    expect(actions('wsal')).toEqual(['resume']);
    // Each button names its source to a screen reader, its visible word first.
    expect(rowOf(html, 'tanta')).toContain(
      `aria-label="${t('atm.settings.legacy.previewFor', { source: 'tanta' })}"`,
    );
    expect(rowOf(html, 'tanta')).toContain(
      `aria-label="${t('atm.settings.legacy.undoFor', { source: 'tanta' })}"`,
    );
    expect(rowOf(html, 'wsal')).toContain(
      `aria-label="${t('atm.settings.legacy.resumeFor', { source: 'wsal' })}"`,
    );
  });

  it('a source with no branch cannot be previewed', () => {
    const html = cardWith([source({ source: 'portsaid', branchId: null, branchName: null })]);
    expect(
      /<button[^>]*data-legacy-action="preview"[^>]*disabled=""/u.test(html) ||
        /<button[^>]*disabled=""[^>]*data-legacy-action="preview"/u.test(html),
    ).toBe(true);
  });

  it('offers no action to a reader without the key', () => {
    const html = cardWith([source({ lastRun: run(), copiedRows: 5 })], {});
    expect(html).not.toContain('data-legacy-action');
  });

  it('says a paused run’s place and the copies a source holds', () => {
    const status = legacySourceStatus(
      source({ lastRun: run({ state: 'running' }), copiedRows: 1_234 }),
      t,
      'en',
    );
    expect(status).toContain('63,431');
    expect(status).toContain('126,102');
    expect(status).toContain('1,234');
  });
});

describe('a run’s progress', () => {
  it('is the rows read of all the run will read, both kinds', () => {
    expect(legacyRunProgress(run())).toEqual({ done: 63_431, total: 126_102 });
    expect(percentOf(63_431, 126_102)).toBe(50);
    expect(percentOf(0, 0)).toBe(100);
    expect(percentOf(5, 4)).toBe(100);
  });
});

describe('the preview and the body', () => {
  it('a typed cut is sent as the moment it names; an empty box is no cut', () => {
    expect(cutoverFromLocal('2026-11-23T21:57')).toBe(new Date('2026-11-23T21:57').toISOString());
    expect(cutoverFromLocal('')).toBeNull();
    // The server's suggestion travels as it came, to the second.
    // Only «Done» operations are copied: the body carries no switch for open ones.
    expect(legacyImportBody('alex', '2026-11-23T19:57:01.000Z')).toEqual({
      source: 'alex',
      cutoverAt: '2026-11-23T19:57:01.000Z',
    });
  });

  it('«استيراد» waits for rows found, both kinds’ times decided, and something to copy', () => {
    expect(legacyImportAllowed(preview())).toBe(true);
    expect(legacyImportAllowed(preview({ sourceFound: false }))).toBe(false);
    const unclear = preview({ maintenance: kindPreview({ timeModeClear: false }) });
    expect(legacyImportAllowed(unclear)).toBe(false);
    expect(unclearKinds(unclear)).toEqual(['maintenance']);
    expect(
      legacyImportAllowed(
        preview({
          replenishment: kindPreview({ toImport: 0 }),
          maintenance: kindPreview({ toImport: 0 }),
        }),
      ),
    ).toBe(false);
  });

  it('shows only the reasons that left a row out', () => {
    const quiet = preview({
      replenishment: kindPreview({
        skipped: { deleted: 0, noOpenTime: 0, open: 2, afterCutover: 0, unresolved: 0 },
      }),
      maintenance: kindPreview({
        skipped: { deleted: 1, noOpenTime: 0, open: 0, afterCutover: 0, unresolved: 0 },
      }),
    });
    expect(shownSkipReasons(quiet)).toEqual(['deleted', 'open']);
  });

  it('lists ten unresolved codes, then how many more', () => {
    const codes = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ code: `90${String(from + i)}`, rows: 1 }));
    const few = preview({ replenishment: kindPreview({ unresolvedCodes: codes(10, 3) }) });
    expect(unresolvedCodesText(few, t, 'en')).toBe('9010 (1), 9011 (1), 9012 (1)');
    const many = preview({
      replenishment: kindPreview({ unresolvedCodes: codes(10, 8) }),
      maintenance: kindPreview({ unresolvedCodes: codes(30, 5) }),
    });
    const text = unresolvedCodesText(many, t, 'ar');
    expect(text).toContain('9031');
    expect(text).not.toContain('9032');
    expect(text.endsWith(t('atm.settings.move.more', { count: '٣' }))).toBe(true);
    expect(unresolvedCodesText(preview(), t, 'en')).toBe('');
  });

  it('every string the card and its dialog say resolves in both languages', () => {
    for (const locale of ['ar', 'en'] as const) {
      for (const key of [
        'atm.settings.legacy.title',
        'atm.settings.legacy.hint',
        'atm.settings.legacy.row',
        'atm.settings.legacy.noBranch',
        'atm.settings.legacy.never',
        'atm.settings.legacy.paused',
        'atm.settings.legacy.last.done',
        'atm.settings.legacy.last.failed',
        'atm.settings.legacy.last.undone',
        'atm.settings.legacy.copied',
        'atm.settings.legacy.preview',
        'atm.settings.legacy.resume',
        'atm.settings.legacy.undo',
        'atm.settings.legacy.previewFor',
        'atm.settings.legacy.resumeFor',
        'atm.settings.legacy.undoFor',
        'atm.settings.legacy.undoStopped',
        'atm.settings.legacy.noneToCopy',
        'atm.settings.legacy.error.running',
        'atm.settings.legacy.error.state',
        'atm.settings.legacy.error.busy',
        'atm.settings.legacy.error.unreadable',
        'atm.settings.legacy.error.moveRunning',
        'atm.settings.legacy.progress.run',
        'atm.settings.legacy.progress.undo',
        'atm.settings.legacy.done',
        'atm.settings.legacy.summary',
        'atm.settings.legacy.undone',
        'atm.settings.legacy.undoTitle',
        'atm.settings.legacy.undoBody',
        'atm.settings.legacy.dialogTitle',
        'atm.settings.legacy.intro',
        'atm.settings.legacy.keeps',
        'atm.settings.legacy.cutover',
        'atm.settings.legacy.cutoverHint',
        'atm.settings.legacy.confirm',
        'atm.settings.legacy.nothing',
        'atm.settings.legacy.counts',
        'atm.settings.legacy.kind.replenishment',
        'atm.settings.legacy.kind.maintenance',
        'atm.settings.legacy.count.total',
        'atm.settings.legacy.count.deleted',
        'atm.settings.legacy.count.noOpenTime',
        'atm.settings.legacy.count.open',
        'atm.settings.legacy.count.afterCutover',
        'atm.settings.legacy.count.unresolved',
        'atm.settings.legacy.count.toImport',
        'atm.settings.legacy.times',
        'atm.settings.legacy.mode.utc',
        'atm.settings.legacy.mode.cairoLabelled',
        'atm.settings.legacy.unresolved',
        'atm.settings.legacy.unclear',
      ]) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});

describe('a refusal', () => {
  it('is worded in the reader’s language; anything else as the shared helper says it', () => {
    const refused = (code: string) => new ApiError(code, 'server sentence', 409);
    expect(legacyErrorText(refused(ErrorCodes.ATM_LEGACY_IMPORT_RUNNING), t, 'ar')).toBe(
      t('atm.settings.legacy.error.running'),
    );
    expect(legacyErrorText(refused(ErrorCodes.ATM_LEGACY_IMPORT_UNREADABLE), t, 'ar')).toBe(
      t('atm.settings.legacy.error.unreadable'),
    );
    expect(legacyErrorText(refused(ErrorCodes.ATM_BRANCH_MOVE_RUNNING), t, 'ar')).toBe(
      t('atm.settings.legacy.error.moveRunning'),
    );
    expect(legacyErrorText(refused('SOMETHING_ELSE'), t, 'ar')).not.toBe('');
  });

  it('a busy step is waited for, never a failure', () => {
    expect(isStepBusy(new ApiError(ErrorCodes.ATM_LEGACY_IMPORT_STEP_BUSY, 'x', 409))).toBe(true);
    expect(isStepBusy(new ApiError(ErrorCodes.ATM_LEGACY_IMPORT_STATE, 'x', 409))).toBe(false);
    expect(isStepBusy(new Error('network'))).toBe(false);
  });
});
