// /atm/data-edit's catalog work (DEC-35 … DEC-38), as the reader meets it — rendered from a pre-filled
// query cache like the gating spec, plus the pure rules under each dialog:
//
//   · the bank dialog: both names, a code of the catalog's shape (upper-cased), read-only on edit;
//     only what changed is sent, and the edit says what a new Operations label and an archive mean;
//   · the area dialog: a NEW area needs Arabic AND English, and says which name machines will store
//     (the owner: «الإنجليزي تمام» — the English one);
//   · the machine dialogs: banks grouped by catalog bank, areas in the reader's language, and the
//     machine's CURRENT bank and area always offered (critic gap 3);
//   · the spellings tab's callout of bank texts no bank answers to, each one click from being linked;
//   · what an add tells the reader: recorded in the register as «بيانات ناقصة», linked, for
//     Operations only — and why a refused add was refused.
//
// Every code, name and label below is synthetic.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import {
  ATM_BANK_SEED,
  CreateAtmBankSchema,
  CreateAtmRefLabelSchema,
  ErrorCodes,
  UpdateAtmBankSchema,
  UpdateAtmRefLabelSchema,
  type AtmBankDto,
  type AtmMachineCreateResultDto,
  type AtmMachineDto,
  type AtmRefLabelDto,
  type AtmRefLabelOptionsDto,
  type BulkCreateAtmMachinesResultDto,
  type Locale,
  type MeDto,
  type Paginated,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { ApiError } from '../../shared/lib/api-client';
import { DataEditPage } from './pages/DataEditPage';
import {
  BulkMachinesDialog,
  MachineDialog,
  RefLabelDialog,
  bulkAddToasts,
  machineAddErrorText,
  machineAddToast,
  refLabelCreateBody,
  refLabelErrorText,
  refLabelFormComplete,
  refLabelFormOf,
  refLabelUpdateBody,
} from './components/DataEditDialogs';
import {
  BankDialog,
  bankDialogNotes,
  bankErrorText,
  bankFormComplete,
  bankFormOf,
  createBankBody,
  suggestedBankColor,
  updateBankBody,
  type BankForm,
} from './components/catalog/BankDialog';
import { atmBanksKey, atmRefLabelOptionsKey } from './api/atm-queries';
import { makeBankLookup } from './lib/bank-catalog';

// `Dialog` portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const ALEX = '650000000000000000000104';
const STAMP = '2026-01-12T08:00:00.000Z';

const bankDto = (over: Partial<AtmBankDto> & Pick<AtmBankDto, 'code'>): AtmBankDto => ({
  id: `650000000000000000000d${over.code.padEnd(2, '0').slice(0, 2)}`,
  name: { ar: over.code, en: over.code },
  opsLabel: over.code,
  formerOpsLabels: [],
  color: '#000000',
  sortOrder: 100,
  isActive: true,
  isSeed: false,
  hasIdFormat: false,
  version: 3,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});

const QNB = bankDto({
  code: 'QNB',
  name: { ar: 'بنك تجريبي سابع', en: 'SYN Seventh Bank' },
  color: '#7030A0',
  sortOrder: 70,
});
const CATALOG: AtmBankDto[] = [
  ...ATM_BANK_SEED.map((seed) => bankDto({ ...seed, isSeed: true, hasIdFormat: true })),
  QNB,
];
const LOOKUP = makeBankLookup(CATALOG);

const OPTIONS: AtmRefLabelOptionsDto = {
  branchId: ALEX,
  registerMapped: true,
  banks: [
    { value: 'NBE', bankCode: 'NBE', kind: 'bank' },
    { value: 'MISR', bankCode: 'BM', kind: 'bank' },
    { value: 'QNB', bankCode: 'QNB', kind: 'bank' },
    { value: 'NBE FOREX', bankCode: 'NBE', kind: 'spelling' },
  ],
  areas: [
    { name: 'MOHNDESSEN', nameAr: 'المهندسين', nameEn: 'Mohandessin' },
    { name: 'ALEX', nameAr: null, nameEn: null },
  ],
  unmappedBankNames: [],
};

const machine = (over: Partial<AtmMachineDto> = {}): AtmMachineDto => ({
  id: '650000000000000000000b01',
  branchId: ALEX,
  bankName: 'NBE FOREX',
  machineCode: '99990001',
  name: 'Synthetic ATM 01',
  zone: '',
  area: 'MOHNDESSEN',
  isActive: true,
  version: 4,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});

const refLabel = (over: Partial<AtmRefLabelDto> = {}): AtmRefLabelDto => ({
  id: '650000000000000000000c01',
  branchId: ALEX,
  kind: 'area',
  name: 'MOHNDESSEN',
  nameAr: null,
  nameEn: null,
  formerNames: [],
  bankCode: null,
  origin: 'backfill',
  isActive: true,
  version: 2,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
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

const MANAGE = ['atmMachine.view', 'atmMachine.manage'];
const OPERATIONS = ['atmMachine.view', 'atmRefLabel.create', 'atmRefLabel.edit'];

const render = (
  permissions: readonly string[],
  node: ReactNode,
  fill: (qc: QueryClient) => void = () => undefined,
  url = '/',
): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(atmBanksKey(), CATALOG);
  qc.setQueryData(atmRefLabelOptionsKey(null), OPTIONS);
  qc.setQueryData(atmRefLabelOptionsKey(ALEX), OPTIONS);
  fill(qc);
  return renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The opening tag of the element carrying `attr="value"`. */
const tagWith = (markup: string, element: string, attr: string, value: string): string =>
  new RegExp(`<${element}[^>]*${attr}="${value}"[^>]*>`).exec(markup)?.[0] ?? '';

// ── The bank dialog ─────────────────────────────────────────────────────────────────────────────

describe('the bank dialog', () => {
  const form = (over: Partial<BankForm> = {}): BankForm => ({
    code: 'qnb ',
    nameAr: ' بنك تجريبي ',
    nameEn: 'SYN Bank',
    opsLabel: '',
    color: '#7030a0',
    isActive: true,
    ...over,
  });

  it('a new bank needs both names and a code of the catalog shape', () => {
    expect(bankFormComplete(form(), true)).toBe(true);
    expect(bankFormComplete(form({ nameAr: '  ' }), true)).toBe(false);
    expect(bankFormComplete(form({ nameEn: '' }), true)).toBe(false);
    for (const code of ['', 'Q', '1QNB', 'ABCDEFGHIJK', 'QN-B']) {
      expect(bankFormComplete(form({ code }), true), code).toBe(false);
    }
    expect(bankFormComplete(form({ color: 'purple' }), true)).toBe(false);
  });

  it('sends the code upper-cased, both names trimmed, the colour upper-cased, no empty label', () => {
    const body = createBankBody(form());
    expect(body).toEqual({
      code: 'QNB',
      name: { ar: 'بنك تجريبي', en: 'SYN Bank' },
      color: '#7030A0',
    });
    // The server fills the Operations label with the code when it is left out.
    expect(CreateAtmBankSchema.parse(body).opsLabel).toBe('QNB');
    expect(createBankBody(form({ opsLabel: ' QNB ALEX ' })).opsLabel).toBe('QNB ALEX');
  });

  it('an edit sends only what changed, and the version', () => {
    const edited = { ...bankFormOf(QNB, LOOKUP), nameEn: 'SYN Bank Renamed' };
    const body = updateBankBody(QNB, edited);
    expect(body).toEqual({ name: { ar: QNB.name.ar, en: 'SYN Bank Renamed' }, version: 3 });
    expect(UpdateAtmBankSchema.safeParse(body).success).toBe(true);
    // An untouched form changes nothing — not even the Operations label's history.
    expect(updateBankBody(QNB, bankFormOf(QNB, LOOKUP))).toEqual({ version: 3 });
    expect(updateBankBody(QNB, { ...bankFormOf(QNB, LOOKUP), isActive: false })).toEqual({
      isActive: false,
      version: 3,
    });
  });

  it('warns that machines keep an old label, and that an archive does not leave settlements', () => {
    const open = bankFormOf(QNB, LOOKUP);
    expect(bankDialogNotes(QNB, open, ['QNB'])).toEqual({
      labelChanged: false,
      archivingEnabled: false,
    });
    expect(bankDialogNotes(QNB, { ...open, opsLabel: 'QNB NEW' }, []).labelChanged).toBe(true);
    expect(bankDialogNotes(QNB, { ...open, isActive: false }, ['QNB']).archivingEnabled).toBe(true);
    expect(bankDialogNotes(QNB, { ...open, isActive: false }, ['BRK']).archivingEnabled).toBe(
      false,
    );
  });

  it('a new bank is offered the first colour no bank uses yet', () => {
    // QNB took #7030A0, the first extra colour; the next one is offered.
    expect(suggestedBankColor(LOOKUP)).toBe('#00B0F0');
    expect(suggestedBankColor(makeBankLookup())).toBe('#7030A0');
  });

  it('names its three refusals, and says anything else as itself', () => {
    const tr = (key: string): string => translate('ar', key);
    for (const code of [
      ErrorCodes.ATM_BANK_CODE_TAKEN,
      ErrorCodes.ATM_BANK_LABEL_TAKEN,
      ErrorCodes.ATM_BANK_NAME_TAKEN,
    ]) {
      const text = bankErrorText(new ApiError(code, 'taken', 409), tr, 'ar');
      expect(text).toBe(tr(`atm.bankCatalog.error.${code}`));
      expect(text).not.toBe(`atm.bankCatalog.error.${code}`);
    }
    expect(bankErrorText(new ApiError('FORBIDDEN', 'Forbidden', 403), tr, 'ar')).toBe(
      'ليس لديك صلاحية للقيام بذلك.',
    );
  });

  it('on add: the code is typed; on edit: it is read-only and said to be the bank’s key', () => {
    const add = render(
      [...MANAGE, 'atmBank.create'],
      <BankDialog open onClose={() => undefined} bank={null} />,
    );
    expect(add).toContain(t('atm.bankCatalog.add'));
    expect(add).toContain(t('atm.bankCatalog.codeHint'));
    expect(add).toContain(t('atm.bankCatalog.nameAr'));
    expect(add).toContain(t('atm.bankCatalog.nameEn'));
    expect(add).toContain('type="color"');
    expect(add).not.toContain(t('atm.bankCatalog.isActive'));
    // Nothing typed yet: the save waits.
    expect(tagWith(add, 'button', 'type', 'submit')).toContain('disabled=""');

    const edit = render(
      [...MANAGE, 'atmBank.edit'],
      <BankDialog open onClose={() => undefined} bank={QNB} />,
    );
    expect(edit).toContain(t('atm.bankCatalog.edit'));
    expect(tagWith(edit, 'input', 'value', 'QNB')).toContain('disabled=""');
    expect(edit).toContain(t('atm.bankCatalog.codeFixed'));
    expect(edit).toContain(t('atm.bankCatalog.activeHint'));
    expect(tagWith(edit, 'button', 'type', 'submit')).not.toContain('disabled=""');
  });
});

// ── The area and spelling dialog ────────────────────────────────────────────────────────────────

describe('the area dialog', () => {
  it('a new area needs Arabic AND English, and the English name is the one machines store', () => {
    const blank = refLabelFormOf(null);
    expect(refLabelFormComplete('area', true, { ...blank, nameAr: 'المهندسين' })).toBe(false);
    expect(refLabelFormComplete('area', true, { ...blank, nameEn: 'Mohandessin' })).toBe(false);
    const both = { ...blank, nameAr: ' المهندسين ', nameEn: ' Mohandessin ' };
    expect(refLabelFormComplete('area', true, both)).toBe(true);
    const body = refLabelCreateBody('area', both);
    expect(body).toEqual({ nameAr: 'المهندسين', nameEn: 'Mohandessin' });
    expect(CreateAtmRefLabelSchema.safeParse(body).success).toBe(true);
  });

  it('asks for the two names and says, before the click, which name machines will carry', () => {
    const markup = render(
      OPERATIONS,
      <RefLabelDialog open onClose={() => undefined} kind="area" label={null} />,
    );
    expect(markup).toContain(t('atm.dataEdit.addArea'));
    expect(markup).toContain(t('atm.dataEdit.nameAr'));
    expect(markup).toContain(t('atm.dataEdit.nameEn'));
    expect(markup).not.toContain(t('atm.dataEdit.storedName'));
    expect(markup).toContain(t('atm.dataEdit.storedAs', { name: '—' }));
    expect(tagWith(markup, 'input', 'dir', 'rtl')).toContain('required=""');
    expect(tagWith(markup, 'input', 'dir', 'ltr')).toContain('required=""');
  });

  it('the edit shows the stored name beside both translations, which are optional', () => {
    const label = refLabel({ nameAr: 'المهندسين' });
    const markup = render(
      OPERATIONS,
      <RefLabelDialog open onClose={() => undefined} kind="area" label={label} />,
    );
    expect(markup).toContain(t('atm.dataEdit.storedName'));
    expect(tagWith(markup, 'input', 'value', 'MOHNDESSEN')).not.toContain('disabled=""');
    expect(tagWith(markup, 'input', 'value', 'المهندسين')).not.toContain('required=""');
    expect(markup).toContain(t('atm.dataEdit.displayNameHint'));
    // The rename rule is said before any rename: machines keep the old name.
    expect(markup).toContain(t('atm.dataEdit.renameKeepsMachines'));
  });

  it('an edit that only adds a translation sends no rename', () => {
    const label = refLabel();
    const body = refLabelUpdateBody('area', label, {
      ...refLabelFormOf(label),
      nameEn: 'Mohandessin',
    });
    expect(body).toEqual({ nameEn: 'Mohandessin', isActive: true, version: 2 });
    expect(UpdateAtmRefLabelSchema.safeParse(body).success).toBe(true);
    const renamed = refLabelUpdateBody('area', label, {
      ...refLabelFormOf(label),
      name: 'MOHANDESSIN',
    });
    expect(renamed.name).toBe('MOHANDESSIN');
    // A blank translation clears it.
    const cleared = refLabelUpdateBody('area', refLabel({ nameAr: 'المهندسين' }), {
      ...refLabelFormOf(refLabel({ nameAr: 'المهندسين' })),
      nameAr: ' ',
    });
    expect(cleared.nameAr).toBeNull();
  });

  it('a taken NEW area says to give the existing one its other language', () => {
    const conflict = new ApiError('CONFLICT', 'duplicate', 409);
    expect(refLabelErrorText(conflict, t, 'ar', { areaCreate: true })).toBe(
      t('atm.dataEdit.areaExists'),
    );
    expect(refLabelErrorText(conflict, t, 'ar')).toBe(t('atm.dataEdit.labelExists'));
  });
});

describe('the bank-name (spelling) dialog', () => {
  it('a new spelling needs its catalog bank; the body names it', () => {
    const form = { ...refLabelFormOf(null, 'NBE ALEX'), bankCode: '' };
    expect(refLabelFormComplete('bank', true, form)).toBe(false);
    expect(refLabelFormComplete('bank', true, { ...form, bankCode: 'NBE' })).toBe(true);
    expect(refLabelCreateBody('bank', { ...form, bankCode: 'NBE' })).toEqual({
      name: 'NBE ALEX',
      bankCode: 'NBE',
    });
  });

  it('«ربط ببنك» opens it on the machines’ own text, with the active catalog banks to pick from', () => {
    const markup = render(
      OPERATIONS,
      <RefLabelDialog
        open
        onClose={() => undefined}
        kind="bank"
        label={null}
        presetName="OLD SPELLING"
      />,
    );
    expect(markup).toContain(t('atm.dataEdit.addSpelling'));
    expect(tagWith(markup, 'input', 'value', 'OLD SPELLING')).not.toBe('');
    expect(markup).toContain('بنك تجريبي سابع — QNB');
    expect(markup).toContain('البنك الأهلي المصري — NBE');
  });

  it('an unchanged bank is not re-sent; un-linking sends null', () => {
    const label = refLabel({ kind: 'bank', name: 'NBE FOREX', bankCode: 'NBE', origin: 'manual' });
    expect(refLabelUpdateBody('bank', label, refLabelFormOf(label))).toEqual({
      isActive: true,
      version: 2,
    });
    expect(
      refLabelUpdateBody('bank', label, { ...refLabelFormOf(label), bankCode: '' }).bankCode,
    ).toBeNull();
  });

  it('a text that is already a catalog bank’s own label says so', () => {
    const taken = new ApiError(ErrorCodes.ATM_BANK_LABEL_TAKEN, 'taken', 409);
    expect(refLabelErrorText(taken, t, 'ar')).toBe(t('atm.dataEdit.spellingIsBankLabel'));
  });
});

// ── The machine dialogs' pick lists ─────────────────────────────────────────────────────────────

describe('the machine dialogs offer the branch’s whole lists', () => {
  it('banks grouped by catalog bank, each value the text the machine stores', () => {
    const markup = render(MANAGE, <MachineDialog open onClose={() => undefined} machine={null} />);
    const nbe = /<optgroup label="البنك الأهلي المصري">(.*?)<\/optgroup>/.exec(markup)?.[1] ?? '';
    expect([...nbe.matchAll(/value="([^"]*)"/g)].map((m) => m[1])).toEqual(['NBE', 'NBE FOREX']);
    expect(markup).toContain('<optgroup label="بنك مصر">');
    expect(markup).toContain('<optgroup label="بنك تجريبي سابع">');
    // Areas in the reader's language, with the stored name after it when the two differ.
    expect(markup).toContain('>المهندسين (MOHNDESSEN)</option>');
    expect(markup).toContain('>ALEX</option>');
  });

  it('the machine’s current bank and area are kept, even when no list offers them', () => {
    const legacy = machine({ bankName: 'LEGACY BANK TEXT', area: 'TYPED AREA' });
    const markup = render(
      MANAGE,
      <MachineDialog open onClose={() => undefined} machine={legacy} />,
    );
    expect(tagWith(markup, 'option', 'value', 'LEGACY BANK TEXT')).toContain('selected=""');
    expect(tagWith(markup, 'option', 'value', 'TYPED AREA')).toContain('selected=""');
    // A current value that IS offered is not offered twice.
    const listed = render(
      MANAGE,
      <MachineDialog open onClose={() => undefined} machine={machine()} />,
    );
    expect([...listed.matchAll(/value="NBE FOREX"/g)]).toHaveLength(1);
  });

  it('an add in a branch with no EGYCASH code says, before the click, it is for Operations only', () => {
    const unmapped = (qc: QueryClient): void => {
      qc.setQueryData(atmRefLabelOptionsKey(null), { ...OPTIONS, registerMapped: false });
    };
    const add = render(
      MANAGE,
      <MachineDialog open onClose={() => undefined} machine={null} />,
      unmapped,
    );
    expect(add).toContain(t('atm.dataEdit.notRegisterMapped'));
    const bulk = render(MANAGE, <BulkMachinesDialog open onClose={() => undefined} />, unmapped);
    expect(bulk).toContain(t('atm.dataEdit.notRegisterMapped'));
    // A mapped branch says nothing; an edit never does.
    expect(
      render(MANAGE, <MachineDialog open onClose={() => undefined} machine={null} />),
    ).not.toContain('data-register-unmapped');
  });
});

// ── The spellings tab's callout ─────────────────────────────────────────────────────────────────

describe('the unmapped callout on «أسماء البنوك في التشغيل»', () => {
  const page = (permissions: readonly string[], unmapped: string[], rows: AtmRefLabelDto[] = []) =>
    render(
      permissions,
      <DataEditPage />,
      (qc) => {
        qc.setQueryData(atmRefLabelOptionsKey(null), { ...OPTIONS, unmappedBankNames: unmapped });
        const list: Paginated<AtmRefLabelDto> = {
          items: rows,
          meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 },
        };
        qc.setQueryData(
          listKey('atm', 'refLabels', {
            kind: 'bank',
            page: 1,
            pageSize: 25,
            sortDir: 'asc',
            sortBy: 'name',
          }),
          list,
        );
      },
      '/atm/data-edit?tab=bankLabel',
    );
  const links = (markup: string): number =>
    [...markup.matchAll(/data-edit-action="link-bank"/g)].length;

  it('lists each text machines carry that no bank answers to, each with «ربط ببنك»', () => {
    const markup = page(OPERATIONS, ['OLD SPELLING', 'SYN TEXT']);
    expect(markup).toContain('data-unmapped-callout');
    expect(markup).toContain(t('atm.dataEdit.unmappedTitle'));
    expect(markup).toContain('OLD SPELLING');
    expect(links(markup)).toBe(2);
  });

  it('is absent when every text is linked, and offers no link to a reader without the keys', () => {
    expect(page(OPERATIONS, [])).not.toContain('data-unmapped-callout');
    const readOnly = page(['atmMachine.view'], ['OLD SPELLING']);
    expect(readOnly).toContain('OLD SPELLING');
    expect(links(readOnly)).toBe(0);
  });

  it('a listed spelling linked to no bank is EDITED, so only the edit key offers its link', () => {
    const row = refLabel({
      kind: 'bank',
      name: 'OLD SPELLING',
      bankCode: null,
      origin: 'backfill',
    });
    expect(links(page(['atmMachine.view', 'atmRefLabel.edit'], ['OLD SPELLING'], [row]))).toBe(1);
    expect(links(page(['atmMachine.view', 'atmRefLabel.create'], ['OLD SPELLING'], [row]))).toBe(0);
  });
});

// ── What an add tells the reader ────────────────────────────────────────────────────────────────

describe('the outcome of an add', () => {
  const result = (
    register: Partial<AtmMachineCreateResultDto['register']>,
    reactivated = false,
  ): AtmMachineCreateResultDto => ({
    ...machine(),
    reactivated,
    register: { action: 'created', reason: null, entryId: 'e1', bankCode: 'NBE', ...register },
  });

  it.each([
    ['created', null, 'success', 'atm.dataEdit.register.recorded'],
    ['received', null, 'success', 'atm.dataEdit.register.recorded'],
    ['linked', null, 'success', 'atm.dataEdit.register.linked'],
    ['existing', null, 'success', 'atm.dataEdit.register.linked'],
    ['none', 'branchUnmapped', 'success', 'atm.dataEdit.register.branchUnmapped'],
    ['none', 'placeholderCode', 'success', 'atm.dataEdit.register.placeholderCode'],
    ['none', 'noBank', 'warning', 'atm.dataEdit.register.noBank'],
  ] as const)('%s/%s → a %s toast saying %s', (action, reason, variant, key) => {
    const shown = machineAddToast(result({ action, reason }), t);
    expect(shown).toEqual({
      variant,
      title: t('atm.dataEdit.machineAdded'),
      description: t(key),
    });
  });

  it('an archived code brought back says so first', () => {
    expect(machineAddToast(result({}, true), t).title).toBe(t('atm.dataEdit.machineReactivated'));
    expect(t('atm.dataEdit.register.recorded')).toContain('بيانات ناقصة');
  });

  it('a refused add says why: active or open in another branch, an archived bank, taken here', () => {
    const say = (error: unknown): string => machineAddErrorText(error, t, 'ar');
    expect(say(new ApiError(ErrorCodes.ATM_REGISTER_CODE_ACTIVE_ELSEWHERE, 'x', 409))).toBe(
      t('atm.dataEdit.error.activeElsewhere'),
    );
    expect(say(new ApiError(ErrorCodes.ATM_REGISTER_OPEN_PERIOD_EXISTS, 'x', 409))).toBe(
      t('atm.dataEdit.error.openElsewhere'),
    );
    const inactive = new ApiError('VALIDATION_FAILED', 'Validation failed', 400, [
      { field: 'body.bankName', code: 'INACTIVE', message: 'archived' },
    ]);
    expect(say(inactive)).toBe(t('atm.dataEdit.error.bankInactive'));
    expect(say(new ApiError('CONFLICT', 'machine code already registered', 409))).toBe(
      t('atm.dataEdit.codeTaken'),
    );
    expect(say(new ApiError('FORBIDDEN', 'Forbidden', 403))).toBe('ليس لديك صلاحية للقيام بذلك.');
  });

  it('a bulk add lists the brought-back, refused and not-recorded codes', () => {
    const bulk: BulkCreateAtmMachinesResultDto = {
      created: [machine(), machine({ id: 'm2', machineCode: '99990002' })],
      skippedCodes: ['99990003'],
      reactivatedCodes: ['99990004'],
      refused: [
        { machineCode: '99990005', reason: 'activeElsewhere' },
        { machineCode: '99990006', reason: 'openElsewhere' },
      ],
      register: {
        created: ['99990001'],
        received: ['99990004'],
        linked: [],
        existing: [],
        notRecorded: [{ machineCode: '99990002', reason: 'noBank' }],
      },
    };
    expect(bulkAddToasts(bulk, t)).toEqual([
      { variant: 'success', title: t('atm.dataEdit.machinesAdded', { count: 2 }) },
      { variant: 'success', title: t('atm.dataEdit.machinesRecorded', { count: 2 }) },
      { variant: 'info', title: t('atm.dataEdit.machinesReactivated', { codes: '99990004' }) },
      { variant: 'error', title: t('atm.dataEdit.machinesSkipped', { codes: '99990003' }) },
      {
        variant: 'error',
        title: t('atm.dataEdit.machinesRefused.activeElsewhere', { codes: '99990005' }),
      },
      {
        variant: 'error',
        title: t('atm.dataEdit.machinesRefused.openElsewhere', { codes: '99990006' }),
      },
      { variant: 'warning', title: t('atm.dataEdit.notRecorded.noBank', { codes: '99990002' }) },
    ]);
  });
});
