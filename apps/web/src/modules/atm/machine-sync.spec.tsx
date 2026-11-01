// «مقارنة بملف» on /atm/data-edit (2026-11-01): «ضرورى جداً اتأكد إن الماكينات دى متضافه على
// السيستم لفرع المهندسين» — «البنك والكود والأسم والمنطقة». Rendered from a pre-filled cache, as the
// data-edit page is pinned (data-edit-gating.spec.tsx). It pins: the groups a comparison shows and
// their order; an edited machine shows the old value struck through beside the file's; the
// branch's machines the file does not list are shown, never offered for deletion; what an apply
// will write and what it did; a refused upload in the reader's words; and the compare waits for a
// branch picked in the top bar.
import { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  ErrorCodes,
  type AtmMachineSyncDto,
  type AtmRefLabelOptionsDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { ApiError } from '../../shared/lib/api-client';
import { AppliedProblems, GroupTable, MachineSyncDialog } from './components/MachineSyncDialog';
import {
  SYNC_GROUPS,
  appliedCounts,
  appliedProblemLines,
  syncFileRows,
  rowsOfStatus,
  syncErrorText,
  syncWrites,
} from './lib/machine-sync-view';
import { atmRefLabelOptionsKey } from './api/atm-queries';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const DTO: AtmMachineSyncDto = {
  fileName: 'ATM (4).xlsx',
  fileSha256: 'a'.repeat(64),
  planDigest: 'b'.repeat(64),
  branchId: '650000000000000000000401',
  branchName: { ar: 'المهندسين', en: 'Mohandessin' },
  counts: {
    add: 1,
    reactivate: 0,
    update: 1,
    same: 5,
    elsewhere: 1,
    invalid: 1,
    duplicate: 1,
    extra: 1,
  },
  rows: [
    {
      row: 2,
      machineCode: '7101',
      status: 'update',
      file: { bank: 'MISR', name: 'New name', area: 'Dokki' },
      current: { bank: 'NBE', name: 'Old name', area: 'Dokki' },
      changes: ['bank', 'name'],
      issue: null,
      firstRow: null,
      elsewhere: null,
    },
    {
      row: 3,
      machineCode: '7102',
      status: 'add',
      file: { bank: 'NBE', name: 'Brand new', area: 'Giza' },
      current: null,
      changes: [],
      issue: null,
      firstRow: null,
      elsewhere: null,
    },
    {
      row: 4,
      machineCode: '7103',
      status: 'elsewhere',
      file: { bank: 'NBE', name: 'October one', area: 'Giza' },
      current: null,
      changes: [],
      issue: null,
      firstRow: null,
      elsewhere: 'activeElsewhere',
    },
    {
      row: 5,
      machineCode: '7106',
      status: 'invalid',
      file: { bank: 'NOPE', name: 'X', area: 'Dokki' },
      current: null,
      changes: [],
      issue: 'unknownBank',
      firstRow: null,
      elsewhere: null,
    },
    {
      row: 6,
      machineCode: '7102',
      status: 'duplicate',
      file: { bank: 'NBE', name: 'Twice', area: 'Giza' },
      current: null,
      changes: [],
      issue: null,
      firstRow: 3,
      elsewhere: null,
    },
  ],
  extra: [{ machineCode: '7199', bank: 'NBE', name: 'Not in the file', area: 'Zamalek' }],
  applied: null,
};

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: { id: 'u1', permissions: { 'atmMachine.manage': 'organization' } } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const render = (node: ReactNode, qc = new QueryClient()): string =>
  renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const groupOf = (markup: string, group: string): string =>
  new RegExp(`<details[^>]*data-sync-group="${group}"[\\s\\S]*?</details>`).exec(markup)?.[0] ?? '';

describe('the comparison’s pure parts', () => {
  it('shows what an apply writes first, then the rest, and counts the writes', () => {
    expect(SYNC_GROUPS).toEqual([
      'add',
      'reactivate',
      'update',
      'elsewhere',
      'invalid',
      'duplicate',
      'extra',
    ]);
    expect(syncWrites(DTO)).toBe(2);
    expect(rowsOfStatus(DTO, 'update').map((r) => r.machineCode)).toEqual(['7101']);
  });

  it('says what an apply did, zero counts dropped', () => {
    expect(
      appliedCounts({
        added: ['1', '2'],
        reactivated: [],
        updated: ['3'],
        refused: [],
        skipped: [],
        register: { created: [], received: [], linked: [], existing: [], notRecorded: [] },
      }),
    ).toEqual([
      { key: 'added', count: 2 },
      { key: 'updated', count: 1 },
    ]);
  });

  it('counts the file’s rows, not the branch’s extra machines', () => {
    expect(syncFileRows(DTO)).toBe(10);
  });

  it('names what an apply could not do, one line per reason, in the bulk add’s words', () => {
    const applied = {
      added: [],
      reactivated: [],
      updated: [],
      refused: [
        { machineCode: '1', reason: 'activeElsewhere' as const },
        { machineCode: '2', reason: 'openElsewhere' as const },
        { machineCode: '3', reason: 'activeElsewhere' as const },
      ],
      skipped: ['4'],
      register: {
        created: [],
        received: [],
        linked: [],
        existing: [],
        notRecorded: [{ machineCode: '5', reason: 'branchUnmapped' as const }],
      },
    };
    expect(appliedProblemLines(applied)).toEqual([
      { key: 'atm.dataEdit.machinesRefused.activeElsewhere', params: { codes: '1، 3' } },
      { key: 'atm.dataEdit.machinesRefused.openElsewhere', params: { codes: '2' } },
      { key: 'atm.machineSync.skippedCodes', params: { codes: '4' } },
      { key: 'atm.dataEdit.notRecorded.branchUnmapped', params: { codes: '5' } },
    ]);
    const html = render(<AppliedProblems applied={applied} />);
    expect(html).toContain(t('atm.dataEdit.machinesRefused.activeElsewhere', { codes: '1، 3' }));
    expect(html).toContain(t('atm.machineSync.skippedCodes', { codes: '4' }));
    expect(
      render(
        <AppliedProblems
          applied={{
            ...applied,
            refused: [],
            skipped: [],
            register: { ...applied.register, notRecorded: [] },
          }}
        />,
      ),
    ).toBe('');
  });

  it('says a refused upload in the reader’s words', () => {
    const layout = (code: string): ApiError =>
      new ApiError(ErrorCodes.ATM_MACHINE_SYNC_LAYOUT, 'x', 422, [
        { field: 'file', code, message: 'x' },
      ]);
    expect(syncErrorText(layout('MISSING_HEADER'), t, 'ar')).toBe(
      t('atm.machineSync.error.header'),
    );
    expect(syncErrorText(layout('MISSING_SHEET'), t, 'ar')).toBe(t('atm.machineSync.error.sheet'));
    expect(syncErrorText(layout('TOO_LARGE'), t, 'ar')).toBe(t('atm.machineSync.error.tooLarge'));
    expect(
      syncErrorText(
        new ApiError(ErrorCodes.VALIDATION_FAILED, 'x', 422, [
          { field: 'file', code: 'UNREADABLE', message: 'x' },
        ]),
        t,
        'ar',
      ),
    ).toBe(t('atm.machineSync.error.unreadable'));
    expect(
      syncErrorText(new ApiError(ErrorCodes.ATM_MACHINE_SYNC_FILE_CHANGED, 'x', 409), t, 'ar'),
    ).toBe(t('atm.machineSync.error.changed'));
    expect(
      syncErrorText(new ApiError(ErrorCodes.ATM_MACHINE_SYNC_PLAN_CHANGED, 'x', 409), t, 'ar'),
    ).toBe(t('atm.machineSync.error.planChanged'));
    // A business rule in the server's own words — «اختر فرعًا محددًا من القائمة العلوية أولًا.»
    expect(
      syncErrorText(
        new ApiError(
          ErrorCodes.BUSINESS_RULE_VIOLATION,
          'اختر فرعًا محددًا من القائمة العلوية أولًا.',
          422,
        ),
        t,
        'ar',
      ),
    ).toBe('اختر فرعًا محددًا من القائمة العلوية أولًا.');
  });
});

describe('the comparison on screen', () => {
  const all = (): string =>
    render(
      <>
        {SYNC_GROUPS.map((group) => (
          <GroupTable key={group} dto={DTO} group={group} />
        ))}
      </>,
    );

  it('shows an edited machine’s old value struck through beside the file’s', () => {
    const update = groupOf(all(), 'update');
    expect(update).toContain(t('atm.machineSync.group.update'));
    expect(update).toMatch(/data-sync-changed="bank"[\s\S]*<del[^>]*>NBE<\/del>[\s\S]*MISR/u);
    expect(update).toMatch(/data-sync-changed="name"[\s\S]*<del[^>]*>Old name<\/del>/u);
    // The area did not change: shown plain, not struck through.
    expect(update).not.toContain('data-sync-changed="area"');
  });

  it('says why a row is left out, and where a twice-listed code counts', () => {
    const html = all();
    expect(groupOf(html, 'invalid')).toContain(t('atm.machineSync.issue.unknownBank'));
    expect(groupOf(html, 'duplicate')).toContain(t('atm.machineSync.firstRow', { row: 3 }));
    expect(groupOf(html, 'elsewhere')).toContain(t('atm.machineSync.groupHint.elsewhere'));
    expect(groupOf(html, 'elsewhere')).toContain(t('atm.machineSync.elsewhere.activeElsewhere'));
  });

  it('shows the branch’s machines the file does not list — for information, never to delete', () => {
    const extra = groupOf(all(), 'extra');
    expect(extra).toContain('7199');
    expect(extra).toContain(t('atm.machineSync.groupHint.extra'));
    expect(extra).not.toMatch(/<button/u);
  });

  it('keeps the disclosure marker: the summary is not turned into a flex box', () => {
    expect(all()).not.toMatch(/<summary[^>]*class="[^"]*\bflex\b/u);
  });

  it('shows no group with nothing in it', () => {
    expect(all()).not.toContain('data-sync-group="reactivate"');
  });
});

describe('the dialog', () => {
  const withBranch = (branch: AtmRefLabelOptionsDto['branch']): QueryClient => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(atmRefLabelOptionsKey(null), {
      banks: [],
      areas: [],
      branch,
      registerMapped: true,
    } as unknown as AtmRefLabelOptionsDto);
    return qc;
  };

  it('names the branch the comparison is against, and waits for a file', () => {
    const html = render(
      <MachineSyncDialog open onClose={() => undefined} />,
      withBranch({ id: 'b1', name: { ar: 'المهندسين', en: 'Mohandessin' } }),
    );
    expect(html).toContain(t('atm.dataEdit.addInBranch', { name: 'المهندسين' }));
    expect(html).toContain(t('atm.machineSync.intro'));
    const compare = /<button[^>]*data-sync-action="compare"[^>]*>/u.exec(html)?.[0] ?? '';
    expect(compare).toContain('disabled=""');
    // No apply before a comparison.
    expect(html).not.toContain('data-sync-action="apply"');
  });

  it('asks for a branch first on «كل الشركة»', () => {
    const html = render(<MachineSyncDialog open onClose={() => undefined} />, withBranch(null));
    expect(html).toContain(t('atm.dataEdit.chooseBranch'));
  });

  it('in both languages', () => {
    const keys = [
      'open',
      'title',
      'intro',
      'compare',
      'apply',
      'nothingToApply',
      'summary',
      'allMatch',
      'appliedLine',
      'appliedNothing',
      'applied.added',
      'applied.reactivated',
      'applied.updated',
      'applied.refused',
      'applied.skipped',
      'row',
      'name',
      'why',
      'firstRow',
      ...SYNC_GROUPS.flatMap((g) => [`group.${g}`, `groupHint.${g}`]),
      'issue.noCode',
      'issue.noName',
      'issue.noArea',
      'issue.noBank',
      'issue.unknownBank',
      'issue.archivedBank',
      'error.header',
      'error.sheet',
      'error.unreadable',
      'error.tooLarge',
      'error.changed',
      'error.planChanged',
      'error.read',
      'changeFile',
      'repickHint',
      'skippedCodes',
      'elsewhere.activeElsewhere',
      'elsewhere.openElsewhere',
    ].map((k) => `atm.machineSync.${k}`);
    for (const locale of ['ar', 'en'] as const) {
      for (const key of keys) expect(translate(locale, key)).not.toBe(key);
    }
  });
});
