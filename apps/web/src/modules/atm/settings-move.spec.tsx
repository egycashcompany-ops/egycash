// /atm/settings — «نقل البيانات» (2026-10-28): a linked source branch's ATM data moved to the
// branch it works as, from the links card. The owner's report: machine 27720226 shown only under
// «كل الشركة», its mail too — what was filed under October before the link stays there until it is
// moved. Rendered from a pre-filled query cache like settings-page.spec.tsx, plus the pure rules
// under the dialog. It pins:
//   · each saved link offers «نقل البيانات إلى …» — to a holder of `atmSettings.manage` only;
//   · a banner names every source that still holds rows, and no other;
//   · the dialog lists only the collections holding rows, their total and the merges, and in red
//     what refuses the move with what it names (codes, banks by name, days as the papers print
//     them); «نقل» waits while anything refuses the move or nothing is left to move;
//   · the move names the stored link's source only (GET/POST /atm/branch-links/:source/move, no
//     body), stales the whole ATM tree whether it ran or was refused, and words its 409 itself.
//
// Every id, name and code below is synthetic.
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ATM_MAP_ZONES_PER_BRANCH_MAX,
  ATM_MAP_ZONE_POINTS_PER_BRANCH_MAX,
  ErrorCodes,
  atmBranchMoveTotal,
  emptyAtmBranchMoveCounts,
  emptyAtmBranchMoveMerges,
  type AtmBranchLinkDto,
  type AtmBranchLinksDto,
  type AtmBranchMoveCountsDto,
  type AtmBranchMovePreviewDto,
  type AtmBranchMoveResultDto,
  type Locale,
  type MeDto,
  type OrgUnitOptionDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { ApiError } from '../../shared/lib/api-client';
import type * as ApiClientModule from '../../shared/lib/api-client';
import { formatNumber } from '../../shared/lib/format';
import { BranchLinksCard, linksHoldingData } from './components/settings/BranchLinksCard';
import {
  MoveBranchDataDialog,
  blockerText,
  madeMerges,
  moveAllowed,
  moveErrorText,
  movedCollections,
  movedSummary,
  type BranchMoveSubject,
} from './components/settings/MoveBranchDataDialog';
import {
  atmBranchLinksKey,
  atmBranchMovePreviewKey,
  useAskAtmBranchMovePreview,
  useMoveAtmBranchData,
  useSaveAtmBranchLinks,
} from './api/settings-queries';
import { getBranchMovePreview, moveBranchData } from './api/settings-api';
import { makeBankLookup } from './lib/bank-catalog';

// `Dialog` portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const n = (value: number): string => formatNumber(value, 'ar');

const MOHANDESSIN = '650000000000000000000201';
const OCTOBER = '650000000000000000000202';
const ALEX = '650000000000000000000203';
const KEY = 'atmSettings.manage';

const BRANCHES: OrgUnitOptionDto[] = [
  { id: MOHANDESSIN, code: 'SYN-1', name: { ar: 'المهندسين', en: 'Mohandessin' } },
  { id: OCTOBER, code: 'SYN-2', name: { ar: 'أكتوبر', en: 'October' } },
  { id: ALEX, code: 'SYN-3', name: { ar: 'الإسكندرية', en: 'Alexandria' } },
].map((branch) => ({ ...branch, parentId: null, catalogId: null }));

/** October works as Mohandessin — the owner's own link; Alexandria too, holding nothing. */
const OCTOBER_AS_MOHANDESSIN: AtmBranchLinkDto = {
  branchId: OCTOBER,
  branchName: { ar: 'أكتوبر', en: 'October' },
  actsAsBranchId: MOHANDESSIN,
  actsAsBranchName: { ar: 'المهندسين', en: 'Mohandessin' },
};
const ALEX_AS_MOHANDESSIN: AtmBranchLinkDto = {
  branchId: ALEX,
  branchName: { ar: 'الإسكندرية', en: 'Alexandria' },
  actsAsBranchId: MOHANDESSIN,
  actsAsBranchName: { ar: 'المهندسين', en: 'Mohandessin' },
};
const LINKS: AtmBranchLinksDto = { links: [OCTOBER_AS_MOHANDESSIN, ALEX_AS_MOHANDESSIN] };

const countsOf = (over: Partial<AtmBranchMoveCountsDto>): AtmBranchMoveCountsDto => ({
  ...emptyAtmBranchMoveCounts(),
  ...over,
});

/** October's rows as the workbook import left them: the EGYCASH-1 machines, entries and mail. */
const COUNTS = countsOf({ machines: 475, registerEntries: 1061, mailTickets: 12, refLabels: 9 });
const PREVIEW: AtmBranchMovePreviewDto = {
  sourceBranchId: OCTOBER,
  sourceBranchName: { ar: 'أكتوبر', en: 'October' },
  targetBranchId: MOHANDESSIN,
  targetBranchName: { ar: 'المهندسين', en: 'Mohandessin' },
  counts: COUNTS,
  total: atmBranchMoveTotal(COUNTS),
  merges: { ...emptyAtmBranchMoveMerges(), labelsMerged: 4, mailboxRepointed: 1 },
  blockers: [],
  canMove: true,
};
const NOTHING: AtmBranchMovePreviewDto = {
  ...PREVIEW,
  sourceBranchId: ALEX,
  sourceBranchName: { ar: 'الإسكندرية', en: 'Alexandria' },
  counts: emptyAtmBranchMoveCounts(),
  total: 0,
  merges: emptyAtmBranchMoveMerges(),
};

/** Eleven codes: one more than a refusal lists before «و… أخرى». */
const CODES = Array.from({ length: 11 }, (_unused, i) => `9999${String(i).padStart(4, '0')}`);
const BLOCKED: AtmBranchMovePreviewDto = {
  ...PREVIEW,
  blockers: [
    { kind: 'machineActiveInBoth', codes: CODES },
    { kind: 'machineTwinOpen', codes: ['27720226'] },
    { kind: 'planSerialCollision', bankCodes: ['BRK'] },
    { kind: 'planSameDay', items: [{ bankCode: 'NBE', replenishDate: '2026-10-28' }] },
    { kind: 'zoneCaps', zones: 214, points: 20_500 },
    { kind: 'layoutImportRunning', bankCodes: ['BM'] },
    { kind: 'moveRunning' },
  ],
  canMove: false,
};

const RESULT: AtmBranchMoveResultDto = {
  runId: '650000000000000000000e01',
  sourceBranchId: OCTOBER,
  sourceBranchName: PREVIEW.sourceBranchName,
  targetBranchId: MOHANDESSIN,
  targetBranchName: PREVIEW.targetBranchName,
  moved: COUNTS,
  total: PREVIEW.total,
  merges: PREVIEW.merges,
  remaining: emptyAtmBranchMoveCounts(),
};

// ── The server, as the api client reaches it ──────────────────────────────────
const sent: { method: 'get' | 'post' | 'put'; path: string; body?: unknown }[] = [];
/** What the next POST answers: the run, or a refusal. */
let postAnswer: () => Promise<unknown> = () => Promise.resolve(RESULT);
/** What a links save answers: the list the server stored. */
let putAnswer: AtmBranchLinksDto = LINKS;

vi.mock('../../shared/lib/api-client', async () => {
  const actual = await vi.importActual<typeof ApiClientModule>('../../shared/lib/api-client');
  return {
    ...actual,
    get: (path: string) => {
      sent.push({ method: 'get', path });
      return Promise.resolve(PREVIEW);
    },
    post: (path: string, body: unknown) => {
      sent.push({ method: 'post', path, body });
      return postAnswer();
    },
    put: (path: string, body: unknown) => {
      sent.push({ method: 'put', path, body });
      return Promise.resolve(putAnswer);
    },
  };
});

afterEach(() => {
  sent.length = 0;
  postAnswer = () => Promise.resolve(RESULT);
  putAnswer = LINKS;
  vi.restoreAllMocks();
});

const store = (permissions: readonly string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((p) => [p, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

/**
 * A client whose reads have answered: the links, the branch list and each preview given. Fresh
 * for good, so a preview on screen is the one the server has just given — what «نقل» is judged on.
 */
const clientWith = (previews: readonly AtmBranchMovePreviewDto[] = []): QueryClient => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  qc.setQueryData(atmBranchLinksKey(), LINKS);
  qc.setQueryData(['organization', 'branches', 'options'], BRANCHES);
  for (const preview of previews) {
    qc.setQueryData(atmBranchMovePreviewKey(preview.sourceBranchId), preview);
  }
  return qc;
};

const render = (node: ReactNode, permissions: readonly string[], qc: QueryClient): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/atm/settings']}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

/** The one opening tag of the element carrying `attr="value"`. */
const tagWith = (markup: string, element: string, attr: string, value: string): string =>
  new RegExp(`<${element}[^>]*${attr}="${value}"[^>]*>`).exec(markup)?.[0] ?? '';

/** The markup inside the first `<element … attr="value">…</element>`. */
const inside = (markup: string, element: string, attr: string, value: string): string =>
  new RegExp(`<${element}[^>]*${attr}="${value}"[^>]*>([\\s\\S]*?)</${element}>`).exec(
    markup,
  )?.[1] ?? '';

const SUBJECT: BranchMoveSubject = {
  sourceBranchId: OCTOBER,
  source: 'أكتوبر',
  target: 'المهندسين',
};
const dialog = (preview: AtmBranchMovePreviewDto): string =>
  render(
    <MoveBranchDataDialog
      subject={{ ...SUBJECT, sourceBranchId: preview.sourceBranchId }}
      onClose={() => undefined}
    />,
    [KEY],
    clientWith([preview]),
  );

// ── The links card ──────────────────────────────────────────────────────────
describe('«نقل البيانات إلى …» on each saved link', () => {
  it('a holder of the key is offered the move on every link, named by its target', () => {
    const markup = render(<BranchLinksCard />, [KEY], clientWith());
    for (const source of [OCTOBER, ALEX]) {
      const row = inside(markup, 'li', 'data-branch-link', source);
      expect(row).toContain('data-branch-links-action="move"');
      expect(row).toContain(t('atm.settings.move.action', { target: 'المهندسين' }));
    }
    expect(t('atm.settings.move.action', { target: 'المهندسين' })).toBe(
      'نقل البيانات إلى المهندسين',
    );
    // Closed until a row asks for it.
    expect(markup).not.toContain('data-branch-move-dialog');
  });

  it('without the key the card offers no move and no banner — whatever the cache holds', () => {
    const markup = render(<BranchLinksCard />, ['atmMailTicket.view'], clientWith([PREVIEW]));
    expect(markup).toContain('أكتوبر ← يعمل باسم المهندسين');
    expect(markup).not.toContain('data-branch-links-action="move"');
    expect(markup).not.toContain('data-branch-move-banner');
    expect(markup).not.toContain(
      t('atm.settings.move.banner', { source: 'أكتوبر', target: 'المهندسين' }),
    );
  });
});

describe('the banner names every source still holding rows', () => {
  it('October holds rows, Alexandria none: the banner says October, only', () => {
    const markup = render(<BranchLinksCard />, [KEY], clientWith([PREVIEW, NOTHING]));
    const banner = inside(markup, 'div', 'data-branch-move-banner', 'true');
    expect(banner).toContain(
      t('atm.settings.move.banner', { source: 'أكتوبر', target: 'المهندسين' }),
    );
    expect(banner).toContain(`data-branch-move-pending="${OCTOBER}"`);
    expect(banner).not.toContain(ALEX);
    expect(tagWith(markup, 'div', 'data-branch-move-banner', 'true')).toContain('role="status"');
  });

  it('nothing left under any source — or no answer yet — is no banner', () => {
    expect(render(<BranchLinksCard />, [KEY], clientWith([NOTHING]))).not.toContain(
      'data-branch-move-banner',
    );
    expect(render(<BranchLinksCard />, [KEY], clientWith())).not.toContain(
      'data-branch-move-banner',
    );
  });

  it('lines each answer up with its link, in the list’s order', () => {
    expect(linksHoldingData(LINKS.links, [PREVIEW, NOTHING])).toEqual([OCTOBER_AS_MOHANDESSIN]);
    expect(linksHoldingData(LINKS.links, [NOTHING, { ...PREVIEW, sourceBranchId: ALEX }])).toEqual([
      ALEX_AS_MOHANDESSIN,
    ]);
    expect(linksHoldingData(LINKS.links, [undefined, undefined])).toEqual([]);
  });
});

// ── The dialog ──────────────────────────────────────────────────────────────
describe('the move dialog', () => {
  it('lists only the collections holding rows, their total and the merges; offers «نقل»', () => {
    const markup = dialog(PREVIEW);
    expect(markup).toContain(
      t('atm.settings.move.title', { source: 'أكتوبر', target: 'المهندسين' }),
    );
    expect(markup).toContain(
      t('atm.settings.move.intro', { source: 'أكتوبر', target: 'المهندسين' }),
    );
    expect(markup).toContain(t('atm.settings.move.counts', { source: 'أكتوبر' }));
    expect([...markup.matchAll(/data-branch-move-count="([^"]+)"/g)].map((m) => m[1])).toEqual([
      'machines',
      'registerEntries',
      'mailTickets',
      'refLabels',
    ]);
    const machines = inside(markup, 'tr', 'data-branch-move-count', 'machines');
    expect(machines).toContain(t('atm.settings.move.collection.machines'));
    expect(machines).toContain(n(475));
    expect(inside(markup, 'p', 'data-branch-move-total', 'true')).toBe(
      t('atm.settings.move.total', { count: n(1557) }),
    );
    expect([...markup.matchAll(/data-branch-move-merge="([^"]+)"/g)].map((m) => m[1])).toEqual([
      'labelsMerged',
      'mailboxRepointed',
    ]);
    expect(markup).toContain(
      t('atm.settings.move.merge.labelsMerged', { count: n(4), target: 'المهندسين' }),
    );
    expect(markup).toContain(
      t('atm.settings.move.merge.mailboxRepointed', { source: 'أكتوبر', target: 'المهندسين' }),
    );
    expect(markup).not.toContain('data-branch-move-blockers');
    expect(tagWith(markup, 'button', 'data-branch-move-action', 'confirm')).not.toContain(
      'disabled=""',
    );
    expect(markup).toContain(t('atm.settings.move.confirm'));
  });

  it('says in red what refuses the move, with what it names, and holds «نقل» back', () => {
    const markup = dialog(BLOCKED);
    const box = inside(markup, 'section', 'data-branch-move-blockers', 'true');
    const opening = tagWith(markup, 'section', 'data-branch-move-blockers', 'true');
    expect(opening).toContain('role="alert"');
    expect(opening).toContain('bg-red-50');
    expect(box).toContain(t('atm.settings.move.blockers'));
    expect(box).toContain(t('atm.settings.move.blockersHint'));
    expect([...box.matchAll(/data-branch-move-blocker="([^"]+)"/g)].map((m) => m[1])).toEqual([
      'machineActiveInBoth',
      'machineTwinOpen',
      'planSerialCollision',
      'planSameDay',
      'zoneCaps',
      'layoutImportRunning',
      'moveRunning',
    ]);
    // Ten codes, then how many more.
    expect(box).toContain(
      t('atm.settings.move.blocker.machineActiveInBoth', {
        codes: `${CODES.slice(0, 10).join('، ')} ${t('atm.settings.move.more', { count: n(1) })}`,
      }),
    );
    expect(box).not.toContain('99990010');
    expect(box).toContain(t('atm.settings.move.blocker.machineTwinOpen', { codes: '27720226' }));
    // Banks by their names, days as the papers print them.
    expect(box).toContain(
      t('atm.settings.move.blocker.planSerialCollision', { banks: 'بنك البركة' }),
    );
    expect(box).toContain(
      t('atm.settings.move.blocker.planSameDay', { items: 'البنك الأهلي المصري 28/10/2026' }),
    );
    expect(box).toContain(
      t('atm.settings.move.blocker.zoneCaps', {
        target: 'المهندسين',
        zones: n(214),
        maxZones: n(ATM_MAP_ZONES_PER_BRANCH_MAX),
        points: n(20_500),
        maxPoints: n(ATM_MAP_ZONE_POINTS_PER_BRANCH_MAX),
      }),
    );
    expect(box).toContain(
      t('atm.settings.move.blocker.layoutImportRunning', { source: 'أكتوبر', banks: 'بنك مصر' }),
    );
    expect(box).toContain(t('atm.settings.move.blocker.moveRunning'));
    expect(box).not.toMatch(/\{\{/);
    // What moves is still said; only the move waits.
    expect(markup).toContain('data-branch-move-count="machines"');
    expect(tagWith(markup, 'button', 'data-branch-move-action', 'confirm')).toContain(
      'disabled=""',
    );
  });

  it('with nothing filed under the source it says so, and has nothing to move', () => {
    const markup = dialog({ ...NOTHING, sourceBranchId: OCTOBER });
    expect(inside(markup, 'p', 'data-branch-move-nothing', 'true')).toBe(
      t('atm.settings.move.nothing', { source: 'أكتوبر' }),
    );
    expect(markup).not.toContain('data-branch-move-count');
    expect(markup).not.toContain('data-branch-move-total');
    expect(tagWith(markup, 'button', 'data-branch-move-action', 'confirm')).toContain(
      'disabled=""',
    );
  });

  it('«نقل» needs the server’s go, no refusal and something left to move', () => {
    expect(moveAllowed(PREVIEW)).toBe(true);
    expect(moveAllowed(BLOCKED)).toBe(false);
    expect(moveAllowed({ ...PREVIEW, canMove: false })).toBe(false);
    expect(moveAllowed({ ...PREVIEW, blockers: [{ kind: 'moveRunning' }] })).toBe(false);
    expect(moveAllowed(NOTHING)).toBe(false);
  });

  it('keeps the contract’s order and drops the zeros', () => {
    expect(movedCollections(countsOf({ refLabels: 2, machines: 1 }))).toEqual([
      'machines',
      'refLabels',
    ]);
    expect(movedCollections(emptyAtmBranchMoveCounts())).toEqual([]);
    expect(
      madeMerges({ ...emptyAtmBranchMoveMerges(), settingsRepointed: 2, labelsMerged: 1 }),
    ).toEqual(['labelsMerged', 'settingsRepointed']);
  });

  it('a run is summed up collection by collection under its total', () => {
    const machines = `${t('atm.settings.move.collection.machines')}: ${n(475)}`;
    const labels = `${t('atm.settings.move.collection.refLabels')}: ${n(9)}`;
    expect(movedSummary(countsOf({ refLabels: 9, machines: 475 }), t, 'ar')).toBe(
      `${machines}، ${labels}`,
    );
    expect(movedSummary(emptyAtmBranchMoveCounts(), t, 'ar')).toBe('');
  });

  it('a refusal reads in English too, with every placeholder filled', () => {
    const en = (key: string, params?: Record<string, string | number>): string =>
      translate('en', key, params);
    const banks = makeBankLookup();
    const names = { source: 'October', target: 'Mohandessin' };
    for (const blocker of BLOCKED.blockers) {
      expect(blockerText(blocker, names, (code) => banks.name(code, 'en'), en, 'en')).not.toMatch(
        /\{\{|atm\.settings/,
      );
    }
    const many = { kind: 'machineActiveInBoth', codes: CODES } as const;
    expect(blockerText(many, names, (code) => banks.name(code, 'en'), en, 'en')).toContain(
      `${CODES.slice(0, 10).join(', ')} and 1 more`,
    );
  });
});

// ── The calls and what they stale ───────────────────────────────────────────
/** Render once to hold a hook's value, the way the card holds it. */
const held = <T,>(qc: QueryClient, hook: () => T): T => {
  let result: T | undefined;
  const Probe = (): null => {
    result = hook();
    return null;
  };
  renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
  if (result === undefined) throw new Error('the hook did not run');
  return result;
};

describe('the move names the stored link’s source, and stales the ATM tree', () => {
  it('both calls name the source in the path; the move sends no pair', async () => {
    await getBranchMovePreview(OCTOBER);
    await moveBranchData(OCTOBER);
    expect(sent).toEqual([
      { method: 'get', path: `/atm/branch-links/${OCTOBER}/move` },
      { method: 'post', path: `/atm/branch-links/${OCTOBER}/move`, body: {} },
    ]);
  });

  it('a move stales the whole ATM tree — rows changed branch on every ATM screen', async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await expect(held(qc, useMoveAtmBranchData).mutateAsync(OCTOBER)).resolves.toEqual(RESULT);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([['atm']]);
  });

  it('a refused move stales it too, and its 409 is worded by the dialog', async () => {
    const refusal = new ApiError(ErrorCodes.ATM_BRANCH_MOVE_BLOCKED, 'refused', 409, [
      { field: 'blockers', code: 'moveRunning', message: 'another move is running' },
    ]);
    postAnswer = () => Promise.reject(refusal);
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await expect(held(qc, useMoveAtmBranchData).mutateAsync(OCTOBER)).rejects.toBe(refusal);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([['atm']]);
    const names = { source: 'أكتوبر' };
    expect(moveErrorText(refusal, names, t, 'ar')).toBe(t('atm.settings.move.blocked'));
    // Anything else in the reader's own words, never the server's English sentence.
    expect(
      moveErrorText(new ApiError(ErrorCodes.NOT_FOUND, 'no such link', 404), names, t, 'ar'),
    ).toBe('تعذّر العثور على هذا العنصر.');
  });

  // A blocker met part-way through the run: the earlier steps' rows are under the target already,
  // so the reader is never told the move did not run (review finding).
  it('a run stopped part-way says what moved stays moved, and names the source still holding rows', () => {
    const stopped = new ApiError(ErrorCodes.ATM_BRANCH_MOVE_STOPPED, 'stopped', 409, [
      { field: 'blockers', code: 'planSameDay', message: 'a plan of NBE on 2026-11-05 in both' },
    ]);
    const text = moveErrorText(stopped, { source: 'أكتوبر' }, t, 'ar');
    expect(text).toBe(t('atm.settings.move.stopped', { source: 'أكتوبر' }));
    expect(text).toContain('أكتوبر');
    expect(text).not.toBe(t('atm.settings.move.blocked'));
    expect(translate('en', 'atm.settings.move.stopped', { source: 'October' })).toContain(
      'What it moved stays moved',
    );
  });

  it('a new link’s preview is asked at once and kept where the dialog reads it', async () => {
    const qc = new QueryClient();
    const preview = await held(qc, useAskAtmBranchMovePreview)(OCTOBER);
    expect(preview.total).toBeGreaterThan(0);
    expect(sent).toEqual([{ method: 'get', path: `/atm/branch-links/${OCTOBER}/move` }]);
    expect(qc.getQueryData(atmBranchMovePreviewKey(OCTOBER))).toEqual(PREVIEW);
  });

  // A preview exists for a STORED source only (404 otherwise): one asked again for a link just
  // removed, while its row is still on screen, would toast that 404 to the reader who removed it.
  const cached = (qc: QueryClient, sourceBranchId: string): boolean =>
    qc.getQueryCache().find({ queryKey: atmBranchMovePreviewKey(sourceBranchId) }) !== undefined;

  it('a links save forgets the preview of a source it unlinked, and keeps the others', async () => {
    putAnswer = { links: [OCTOBER_AS_MOHANDESSIN] };
    const qc = clientWith([PREVIEW, NOTHING]);
    await held(qc, useSaveAtmBranchLinks).mutateAsync({
      links: [{ branchId: OCTOBER, actsAsBranchId: MOHANDESSIN }],
    });
    expect(cached(qc, OCTOBER)).toBe(true);
    expect(cached(qc, ALEX)).toBe(false);
  });

  it('a move refused 404 — the link removed meanwhile — forgets that preview', async () => {
    postAnswer = () => Promise.reject(new ApiError(ErrorCodes.NOT_FOUND, 'no such link', 404));
    const qc = clientWith([PREVIEW]);
    await expect(held(qc, useMoveAtmBranchData).mutateAsync(OCTOBER)).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(cached(qc, OCTOBER)).toBe(false);
  });
});
