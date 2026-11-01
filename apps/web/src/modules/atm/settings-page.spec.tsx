// /atm/settings — «إعدادات الصراف الآلي» (2026-10-28). Rendered from a pre-filled query cache, the
// way the data-edit page is pinned (data-edit-gating.spec.tsx); the routes are read as source, the
// way the map's and the settlements' are (atm-map-navigation.spec.ts). It pins:
//   · the page is reached only with `atmSettings.manage` — the route, its header line, the overview
//     card; the server holds the key at organization scope, the screen only hides the way in;
//   · the mailbox card never shows a secret: the box is empty, and a stored one reads «محفوظ —
//     اتركه فارغاً للإبقاء عليه»; a save sends one only when it was typed;
//   · «اختبار الاتصال» and «قراءة الآن» wait for a saved card; the last run reads in Cairo time;
//   · a switched-on branch linked to work as another is marked: its mail, and its row, go to the
//     target;
//   · the links card reads each link as one sentence, «أكتوبر ← يعمل باسم المهندسين», and refuses a
//     pair by the contract's own rules before anything is sent;
//   · every write stales what it changed — a links save the whole ATM tree.
//
// Every id, name and address below is synthetic.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SaveAtmMailboxConfigSchema,
  type AtmBranchLinkDto,
  type AtmBranchLinksDto,
  type AtmMailboxConfigDto,
  type AtmMailPollRunDto,
  type Locale,
  type MeDto,
  type OrgUnitOptionDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { RequirePermission } from '../../platform/router/RequirePermission';
import { formatBusinessDateTime } from '../../shared/lib/format';
import { AtmSettingsPage } from './pages/AtmSettingsPage';
import { ATM_SHORTCUTS, AtmOverviewPage } from './pages/AtmOverviewPage';
import {
  mailboxDraftOf,
  mailboxRowsRemovedOnSave,
  mailboxSaveBody,
  secretMissing,
} from './components/settings/MailboxSettingsCard';
import { branchLinkRefusal } from './components/settings/BranchLinksCard';
import {
  atmBranchLinksKey,
  atmMailboxKey,
  usePollAtmMailboxNow,
  useSaveAtmBranchLinks,
  useSaveAtmMailboxConfig,
} from './api/settings-queries';
import type * as SettingsApiModule from './api/settings-api';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const MOHANDESSIN = '650000000000000000000201';
const OCTOBER = '650000000000000000000202';
const ALEX = '650000000000000000000203';
const KEY = 'atmSettings.manage';

const BRANCHES: OrgUnitOptionDto[] = [
  { id: MOHANDESSIN, code: 'SYN-1', name: { ar: 'المهندسين', en: 'Mohandessin' } },
  { id: OCTOBER, code: 'SYN-2', name: { ar: 'أكتوبر', en: 'October' } },
  { id: ALEX, code: 'SYN-3', name: { ar: 'الإسكندرية', en: 'Alexandria' } },
].map((branch) => ({ ...branch, parentId: null, catalogId: null }));

const RUN: AtmMailPollRunDto = {
  at: '2026-10-28T07:05:00.000Z',
  read: 4,
  created: 2,
  duplicates: 1,
  unmatched: 1,
  failed: 0,
  error: null,
  unmatchedReasons: ['99990009: branch not enabled for mail'],
};

/** A saved mailbox: Mohandessin switched on, a secret stored, one run behind it. */
const CONFIG: AtmMailboxConfigDto = {
  tenantId: 'synthetic.onmicrosoft.com',
  clientId: '00000000-0000-4000-8000-000000000001',
  hasSecret: true,
  userEmail: 'maintenance.mail@example.com',
  enabled: true,
  branches: [
    {
      branchId: MOHANDESSIN,
      branchName: { ar: 'المهندسين', en: 'Mohandessin' },
      category: 'Green Category',
    },
  ],
  lastPoll: RUN,
  version: 3,
};

/** October works as Mohandessin — the owner's own link. */
const OCTOBER_AS_MOHANDESSIN: AtmBranchLinkDto = {
  branchId: OCTOBER,
  branchName: { ar: 'أكتوبر', en: 'October' },
  actsAsBranchId: MOHANDESSIN,
  actsAsBranchName: { ar: 'المهندسين', en: 'Mohandessin' },
};
const LINKS: AtmBranchLinksDto = { links: [OCTOBER_AS_MOHANDESSIN] };

vi.mock('./api/settings-api', async () => {
  const actual = await vi.importActual<typeof SettingsApiModule>('./api/settings-api');
  return {
    ...actual,
    saveMailboxConfig: (): Promise<AtmMailboxConfigDto> => Promise.resolve(CONFIG),
    pollMailboxNow: (): Promise<AtmMailPollRunDto> => Promise.resolve(RUN),
    saveBranchLinks: (): Promise<AtmBranchLinksDto> => Promise.resolve(LINKS),
  };
});

afterEach(() => {
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

/** A client whose two cards' reads (and the branch list) have already answered. */
const clientWith = (
  config: AtmMailboxConfigDto | null,
  links: AtmBranchLinksDto = LINKS,
): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(atmMailboxKey(), config);
  qc.setQueryData(atmBranchLinksKey(), links);
  qc.setQueryData(['organization', 'branches', 'options'], BRANCHES);
  return qc;
};

const render = (node: ReactNode, permissions: readonly string[] = [KEY], qc = clientWith(CONFIG)) =>
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

/** The values a `<select id="…">` offers, in order. */
const optionsOf = (markup: string, id: string): string[] => {
  const select = new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(markup)?.[1];
  return [...(select ?? '').matchAll(/<option[^>]*value="([^"]*)"/g)].map((m) => m[1] as string);
};

// ── The way in ──────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = readFileSync(resolve(HERE, './routes.tsx'), 'utf8');
const SEED = readFileSync(resolve(HERE, '../../../../api/src/seed-navigation.ts'), 'utf8');

describe('the way in is atmSettings.manage', () => {
  it('routes.tsx serves /atm/settings behind that key alone, and its header names it', () => {
    const start = ROUTES.indexOf('path="settings"');
    const block = ROUTES.slice(start, ROUTES.indexOf('<Route', start));
    expect(block).toContain('<AtmSettingsPage />');
    expect(
      [...block.matchAll(/<RequirePermission permission="([^"]+)">/g)].map((m) => m[1]),
    ).toEqual([KEY]);
    expect(ROUTES).toMatch(/\/\/ {3}\/atm\/settings {2,}atmSettings\.manage/);
  });

  it('the guard shows the page to a holder and the forbidden page to anybody else', () => {
    const guarded = (
      <RequirePermission permission={KEY}>
        <AtmSettingsPage />
      </RequirePermission>
    );
    const holder = render(guarded);
    expect(holder).toContain(t('atm.settings.title'));
    expect(holder).toContain(t('atm.settings.mailbox.title'));
    expect(holder).toContain(t('atm.settings.links.title'));

    const other = render(guarded, ['atmMailTicket.view', 'atmMailTicket.decide']);
    expect(other).toContain(t('common.forbidden.title'));
    expect(other).not.toContain(t('atm.settings.mailbox.title'));
  });

  it('the nav row of /atm/settings asks the key its route guard asks', () => {
    const at = SEED.indexOf("route: '/atm/settings'");
    expect(at).toBeGreaterThan(-1);
    expect(/permission: '([^']+)'/.exec(SEED.slice(at, SEED.indexOf('}', at)))?.[1]).toBe(KEY);
  });

  it('the overview card points at /atm/settings, and only a holder sees it', () => {
    expect(ATM_SHORTCUTS.find((s) => s.to === '/atm/settings')).toMatchObject({
      titleKey: 'atm.nav.settings',
      descKey: 'atm.cards.settings',
      permission: KEY,
    });
    expect(render(<AtmOverviewPage />, [KEY, 'atmMailTicket.view'])).toContain(
      'href="/atm/settings"',
    );
    expect(render(<AtmOverviewPage />, ['atmMailTicket.view'])).not.toContain(
      'href="/atm/settings"',
    );
  });
});

// ── The mailbox card ────────────────────────────────────────────────────────
describe('«بريد الصيانة — بنك مصر»', () => {
  it('shows the stored values, and a stored secret as kept — never as a value', () => {
    const markup = render(<AtmSettingsPage />);
    expect(tagWith(markup, 'input', 'id', 'atm-mailbox-tenant')).toContain(
      'value="synthetic.onmicrosoft.com"',
    );
    expect(tagWith(markup, 'input', 'id', 'atm-mailbox-client')).toContain(
      `value="${CONFIG.clientId}"`,
    );
    expect(tagWith(markup, 'input', 'id', 'atm-mailbox-address')).toContain(
      `value="${CONFIG.userEmail}"`,
    );
    const secret = tagWith(markup, 'input', 'id', 'atm-mailbox-secret');
    expect(secret).toContain('type="password"');
    expect(secret).toContain('value=""');
    expect(markup).toContain(t('atm.settings.mailbox.secretStored'));
    expect(t('atm.settings.mailbox.secretStored')).toBe('محفوظ — اتركه فارغاً للإبقاء عليه');
    expect(tagWith(markup, 'input', 'data-mailbox-enabled', 'true')).toContain('checked=""');
    expect(markup).toContain(t('atm.settings.mailbox.enabled'));
    expect(markup).not.toContain(t('atm.settings.mailbox.notSaved'));
  });

  it('lists the switched-on branches with their category, and offers only the others', () => {
    const markup = render(<AtmSettingsPage />);
    const row = new RegExp(
      `<tr[^>]*data-mailbox-branch="${MOHANDESSIN}"[^>]*>([\\s\\S]*?)</tr>`,
    ).exec(markup)?.[1];
    expect(row).toContain('المهندسين');
    expect(row).toContain('Green Category');
    expect(row).toContain(
      `aria-label="${t('atm.settings.mailbox.removeBranch', { branch: 'المهندسين' })}"`,
    );
    expect(optionsOf(markup, 'atm-mailbox-add-branch')).toEqual(['', OCTOBER, ALEX]);
    // Nothing picked yet: nothing to add.
    expect(tagWith(markup, 'button', 'data-mailbox-action', 'add-branch')).toContain('disabled=""');
  });

  it('marks a switched-on branch that works as another: its mail, its row go to the target', () => {
    const withOctober: AtmMailboxConfigDto = {
      ...CONFIG,
      branches: [
        ...CONFIG.branches,
        { branchId: OCTOBER, branchName: { ar: 'أكتوبر', en: 'October' }, category: null },
      ],
    };
    const markup = render(<AtmSettingsPage />, [KEY], clientWith(withOctober));
    const row = (branchId: string): string =>
      new RegExp(`<tr[^>]*data-mailbox-branch="${branchId}"[^>]*>([\\s\\S]*?)</tr>`).exec(
        markup,
      )?.[1] ?? '';
    // Mohandessin is switched on already: the save REMOVES October's row and keeps Mohandessin's
    // with its category — never «يُحفظ هذا السطر باسم المهندسين» (review finding).
    expect(row(OCTOBER)).toContain(
      t('atm.settings.mailbox.worksAsListed', { target: 'المهندسين' }),
    );
    expect(row(OCTOBER)).not.toContain(t('atm.settings.mailbox.worksAs', { target: 'المهندسين' }));
    expect(row(OCTOBER)).toContain(`data-mailbox-works-as="${MOHANDESSIN}"`);
    // Mohandessin works as itself: nothing to mark.
    expect(row(MOHANDESSIN)).not.toContain('data-mailbox-works-as');

    // October alone: its row IS saved as Mohandessin's.
    const alone: AtmMailboxConfigDto = {
      ...CONFIG,
      branches: [
        { branchId: OCTOBER, branchName: { ar: 'أكتوبر', en: 'October' }, category: 'Blue' },
      ],
    };
    const markupAlone = render(<AtmSettingsPage />, [KEY], clientWith(alone));
    expect(markupAlone).toContain(t('atm.settings.mailbox.worksAs', { target: 'المهندسين' }));
    expect(markupAlone).not.toContain(
      t('atm.settings.mailbox.worksAsListed', { target: 'المهندسين' }),
    );
  });

  it('knows which rows the save removes — the server’s own rule', () => {
    const SHEIKH = '650000000000000000000209';
    const targetOf = (branchId: string): string | null =>
      branchId === OCTOBER || branchId === SHEIKH ? MOHANDESSIN : null;
    const removed = (ids: string[]): string[] =>
      [
        ...mailboxRowsRemovedOnSave(
          ids.map((branchId) => ({ branchId })),
          targetOf,
        ),
      ].sort();
    // Beside the target's own row, wherever it sits on the list.
    expect(removed([MOHANDESSIN, OCTOBER])).toEqual([OCTOBER]);
    expect(removed([OCTOBER, MOHANDESSIN])).toEqual([OCTOBER]);
    // Alone, a source becomes the target's row; a second source of the same target goes.
    expect(removed([OCTOBER])).toEqual([]);
    expect(removed([OCTOBER, SHEIKH])).toEqual([SHEIKH]);
    expect(removed([ALEX])).toEqual([]);
  });

  it('a saved card can be tested and read now; Save waits for a change', () => {
    const markup = render(<AtmSettingsPage />);
    expect(tagWith(markup, 'button', 'data-mailbox-action', 'test')).not.toContain('disabled=""');
    expect(tagWith(markup, 'button', 'data-mailbox-action', 'poll')).not.toContain('disabled=""');
    expect(tagWith(markup, 'button', 'data-mailbox-action', 'save')).toContain('disabled=""');
    expect(markup).toContain(t('atm.settings.mailbox.test'));
    expect(markup).toContain(t('atm.settings.mailbox.pollNow'));
    expect(markup).not.toContain(t('atm.settings.mailbox.readingOffHint'));
  });

  it('switched off, the card can still be tested — that is the point — but not read', () => {
    const off = render(<AtmSettingsPage />, [KEY], clientWith({ ...CONFIG, enabled: false }));
    expect(tagWith(off, 'button', 'data-mailbox-action', 'test')).not.toContain('disabled=""');
    expect(tagWith(off, 'button', 'data-mailbox-action', 'poll')).toContain('disabled=""');
    expect(off).toContain(t('atm.settings.mailbox.readingOffHint'));
  });

  it('reads the last run in Cairo time, with its counts and why mail was left unread', () => {
    const markup = render(<AtmSettingsPage />);
    expect(markup).toContain(
      t('atm.settings.mailbox.lastPollAt', { at: formatBusinessDateTime(RUN.at, 'ar') }),
    );
    for (const key of ['read', 'created', 'duplicates', 'unmatched', 'failed']) {
      expect(markup).toContain(t(`atm.settings.mailbox.counts.${key}`));
    }
    expect(markup).toContain(t('atm.settings.mailbox.unmatchedReasons'));
    expect(markup).toContain(RUN.unmatchedReasons[0]);
    expect(markup).not.toContain('data-mailbox-poll-error');
  });

  it('a run that failed as a whole says why', () => {
    const failed = {
      ...CONFIG,
      lastPoll: { ...RUN, error: 'AADSTS7000215: invalid client secret' },
    };
    const markup = render(<AtmSettingsPage />, [KEY], clientWith(failed));
    expect(markup).toContain(
      t('atm.settings.mailbox.pollFailed', { error: 'AADSTS7000215: invalid client secret' }),
    );
  });

  it('with nothing saved yet: says so, and has nothing to test or read', () => {
    const markup = render(<AtmSettingsPage />, [KEY], clientWith(null));
    expect(markup).toContain(t('atm.settings.mailbox.notSaved'));
    expect(markup).not.toContain(t('atm.settings.mailbox.secretStored'));
    const label = new RegExp('<label[^>]*for="atm-mailbox-secret"[^>]*>([\\s\\S]*?)</label>').exec(
      markup,
    )?.[1];
    // Reading starts switched off, and off the card saves without a secret (the server's rule).
    expect(label).not.toContain(' *');
    for (const id of ['tenant', 'client', 'address', 'secret']) {
      expect(tagWith(markup, 'input', 'id', `atm-mailbox-${id}`)).toContain('value=""');
    }
    expect(tagWith(markup, 'button', 'data-mailbox-action', 'test')).toContain('disabled=""');
    expect(tagWith(markup, 'button', 'data-mailbox-action', 'poll')).toContain('disabled=""');
    expect(markup).toContain(t('atm.settings.mailbox.noBranches'));
    expect(markup).toContain(t('atm.settings.mailbox.neverPolled'));
  });

  it('asks for a secret only to switch reading on with none stored', () => {
    const none = { ...mailboxDraftOf(null), enabled: true };
    expect(secretMissing(none, false)).toBe(true);
    expect(secretMissing({ ...none, clientSecret: '   ' }, false)).toBe(true);
    expect(secretMissing({ ...none, clientSecret: 'syn' }, false)).toBe(false);
    expect(secretMissing(none, true)).toBe(false);
    expect(secretMissing({ ...none, enabled: false }, false)).toBe(false);
  });

  it('sends a secret only when one was typed, and the contract accepts both bodies', () => {
    const kept = mailboxSaveBody(mailboxDraftOf(CONFIG), CONFIG.version);
    expect(kept).not.toHaveProperty('clientSecret');
    expect(kept).toEqual({
      tenantId: CONFIG.tenantId,
      clientId: CONFIG.clientId,
      userEmail: CONFIG.userEmail,
      enabled: true,
      branches: [{ branchId: MOHANDESSIN, category: 'Green Category' }],
      version: 3,
    });
    expect(SaveAtmMailboxConfigSchema.safeParse(kept).success).toBe(true);

    const replaced = mailboxSaveBody(
      { ...mailboxDraftOf(CONFIG), clientSecret: '  syn~secret  ' },
      3,
    );
    expect(replaced.clientSecret).toBe('syn~secret');
    expect(SaveAtmMailboxConfigSchema.safeParse(replaced).success).toBe(true);

    const first = mailboxSaveBody({ ...mailboxDraftOf(CONFIG), clientSecret: 'syn' }, null);
    expect(first.version).toBeNull();
    expect(SaveAtmMailboxConfigSchema.safeParse(first).success).toBe(true);
  });
});

// ── The links card ──────────────────────────────────────────────────────────
describe('«فروع تعمل معاً»', () => {
  it('reads each link as one sentence with its own remove, under the line explaining it', () => {
    const markup = render(<AtmSettingsPage />);
    expect(markup).toContain('أكتوبر ← يعمل باسم المهندسين');
    expect(markup).toContain(t('atm.settings.links.hint'));
    const remove = tagWith(markup, 'button', 'data-branch-links-action', 'remove');
    expect(remove).toContain(
      `aria-label="${t('atm.settings.links.remove', { branch: 'أكتوبر' })}"`,
    );
    expect(optionsOf(markup, 'atm-link-branch')).toEqual(['', MOHANDESSIN, OCTOBER, ALEX]);
    expect(optionsOf(markup, 'atm-link-acts-as')).toEqual(['', MOHANDESSIN, OCTOBER, ALEX]);
    expect(tagWith(markup, 'button', 'data-branch-links-action', 'add')).toContain('disabled=""');
  });

  it('says when nothing is linked, and names a branch that no longer exists as such', () => {
    expect(render(<AtmSettingsPage />, [KEY], clientWith(CONFIG, { links: [] }))).toContain(
      t('atm.settings.links.none'),
    );
    const gone = {
      links: [
        { ...OCTOBER_AS_MOHANDESSIN, branchId: '650000000000000000000299', branchName: null },
      ],
    };
    expect(render(<AtmSettingsPage />, [KEY], clientWith(CONFIG, gone))).toContain(
      `${t('atm.settings.unknownBranch')} ← يعمل باسم المهندسين`,
    );
  });

  it('refuses a pair by the contract’s rules before sending it; a target may be shared', () => {
    const october = [{ branchId: OCTOBER, actsAsBranchId: MOHANDESSIN }];
    expect(branchLinkRefusal([], { branchId: ALEX, actsAsBranchId: ALEX })).toBe('sameBranch');
    expect(branchLinkRefusal(october, { branchId: OCTOBER, actsAsBranchId: ALEX })).toBe(
      'duplicateSource',
    );
    // Alexandria as October, while October is Mohandessin.
    expect(branchLinkRefusal(october, { branchId: ALEX, actsAsBranchId: OCTOBER })).toBe('chain');
    // Mohandessin as Alexandria, while October works as Mohandessin.
    expect(branchLinkRefusal(october, { branchId: MOHANDESSIN, actsAsBranchId: ALEX })).toBe(
      'chain',
    );
    expect(branchLinkRefusal(october, { branchId: ALEX, actsAsBranchId: MOHANDESSIN })).toBeNull();
  });
});

// ── What each write stales ──────────────────────────────────────────────────
/** Render once to hold a hook's mutation, the way the card holds it. */
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

describe('every write stales what it changed', () => {
  it('a mailbox save re-reads the card', async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await held(qc, useSaveAtmMailboxConfig).mutateAsync(mailboxSaveBody(mailboxDraftOf(CONFIG), 3));
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ['atm', 'mailbox'],
    ]);
  });

  it('«قراءة الآن» re-reads the card and the mail tickets it may have filed', async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await held(qc, usePollAtmMailboxNow).mutateAsync();
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ['atm', 'mailbox'],
      ['atm', 'mailTickets'],
    ]);
  });

  it('a links save re-reads the whole ATM tree: linked people see another branch', async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await held(qc, useSaveAtmBranchLinks).mutateAsync({ links: [] });
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([['atm']]);
  });
});
