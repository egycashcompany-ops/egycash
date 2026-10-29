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
//     Operations only — and why a refused add was refused;
//   · where an add files, said before it (GM-20 for ATM, 2026-10-28): «الفرع: …», or, on «الشركة
//     كلها» in a company of several branches, a request to choose a branch first, the add off.
//
// Every code, name and label below is synthetic.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  addBlocked,
  bulkAddResultOf,
  bulkAddToasts,
  existingAreaName,
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
const TANTA = '650000000000000000000105';
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
  branch: { id: ALEX, name: { ar: 'الإسكندرية', en: 'Alexandria' } },
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
  unmappedBankLabels: [],
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

  // While «نقل البيانات» runs, these writes wait for it — 423, never 409, so no dialog reads the
  // refusal as "already exists" or fills the register's area box from it (review finding).
  it('a write waiting for a running move is said as such — never «already exists»', () => {
    const running = new ApiError(
      ErrorCodes.ATM_BRANCH_MOVE_RUNNING,
      'يجري الآن نقل بيانات فرع مرتبط في الصراف الآلي. أعد المحاولة بعد انتهاء النقل.',
      423,
    );
    const said = 'يجري الآن نقل بيانات فرع مرتبط في الصراف الآلي. أعد المحاولة بعد انتهاء النقل.';
    expect(refLabelErrorText(running, t, 'ar', { areaCreate: true })).toBe(said);
    expect(
      existingAreaName(running, 'area', true, { ...refLabelFormOf(null), nameEn: 'Dokki' }),
    ).toBeNull();
    expect(machineAddErrorText(running, t, 'ar')).toBe(said);
  });

  it('a taken NEW area says to give the existing one its other language', () => {
    const conflict = new ApiError('CONFLICT', 'duplicate', 409);
    expect(refLabelErrorText(conflict, t, 'ar', { areaCreate: true })).toBe(
      t('atm.dataEdit.areaExists'),
    );
    expect(refLabelErrorText(conflict, t, 'ar')).toBe(t('atm.dataEdit.labelExists'));
  });

  // The register's «+ منطقة» (Efficiency: register keys, no data-edit, no `atmRefLabel.edit`): the
  // data-edit text sends them to an «تعديل» they cannot reach, so the register fills the box with
  // the existing area instead — its stored name is exactly the English text typed (review finding).
  it('from the register, a taken NEW area is the area to use: its stored name, not an error', () => {
    const conflict = new ApiError('CONFLICT', 'duplicate', 409);
    const form = { nameEn: '  Smouha  ' };
    expect(existingAreaName(conflict, 'area', true, form)).toBe('Smouha');
    // Not for a spelling, an edit, the catalog-label 409, another status or a blank name.
    expect(existingAreaName(conflict, 'bank', true, form)).toBeNull();
    expect(existingAreaName(conflict, 'area', false, form)).toBeNull();
    const taken = new ApiError(ErrorCodes.ATM_BANK_LABEL_TAKEN, 'taken', 409);
    expect(existingAreaName(taken, 'area', true, form)).toBeNull();
    expect(existingAreaName(new ApiError('FORBIDDEN', 'no', 403), 'area', true, form)).toBeNull();
    expect(existingAreaName(conflict, 'area', true, { nameEn: ' ' })).toBeNull();
    expect(t('atm.register.form.areaExistsPicked')).not.toContain('تعديل');
  });
});

// ── The dialogs opened over the register form (review finding) ───────────────────────────────────
//
// Pinned at the source, like the roster dialog's (the suite has no DOM to click a backdrop in):
// the register's receipt dialogs ignore a stray click, and the bank and area dialogs they open on
// top must too — «لو دوست في اى حته الموديل ميتقفلش غير لما ادوس على الاكس».
describe('the bank and area dialogs survive a click that missed', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const source = (path: string): string => readFileSync(join(HERE, path), 'utf8');
  /** The `<Dialog …>` opening tag that `component` renders. */
  const dialogTag = (file: string, component: string): string => {
    const start = file.indexOf('<Dialog', file.indexOf(`export const ${component} = (`));
    return file.slice(start, file.indexOf('>', file.indexOf('title=', start)) + 1);
  };

  it('the area dialog and the bank dialog opt out of closing on an outside click', () => {
    expect(dialogTag(source('components/DataEditDialogs.tsx'), 'RefLabelDialog')).toContain(
      'dismissOnOutsideClick={false}',
    );
    expect(dialogTag(source('components/catalog/BankDialog.tsx'), 'BankDialog')).toContain(
      'dismissOnOutsideClick={false}',
    );
  });

  it('the register fills the area box with an area the branch already has', () => {
    expect(source('components/register/EntryFormSections.tsx')).toContain(
      'onExisting={(name) => onChange({ area: name })}',
    );
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

  it('an add in a branch the register is not mapped to says, before the click, it is for Operations only', () => {
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

// ── Where an add files (GM-20 for ATM, 2026-10-28) ──────────────────────────────────────────────
//
// The owner's report was a machine that showed only under «كل الشركة»: an organization-wide
// user's add went to their home placement, whatever the top bar said. The server now files it where
// the top bar points, and the add forms say where before the click.

/** The options on «الشركة كلها» in a company of several branches: no branch, nothing offered. */
const NO_BRANCH: AtmRefLabelOptionsDto = {
  branchId: null,
  branch: null,
  registerMapped: false,
  banks: [],
  areas: [],
  unmappedBankNames: [],
  unmappedBankLabels: [],
};
const noBranch = (qc: QueryClient): void => {
  qc.setQueryData(atmRefLabelOptionsKey(null), NO_BRANCH);
};
/** Every submit button's opening tag, in document order. */
const submits = (markup: string): string[] =>
  [...markup.matchAll(/<button[^>]*type="submit"[^>]*>/g)].map((m) => m[0]);

describe('an add says where it files', () => {
  it('opens on «الفرع: …», the branch the server names — the single add and the bulk one', () => {
    const add = render(MANAGE, <MachineDialog open onClose={() => undefined} machine={null} />);
    expect(add).toContain(`data-add-branch="${ALEX}"`);
    expect(add).toContain(t('atm.dataEdit.addInBranch', { name: 'الإسكندرية' }));
    const bulk = render(MANAGE, <BulkMachinesDialog open onClose={() => undefined} />);
    expect(bulk).toContain(t('atm.dataEdit.addInBranch', { name: 'الإسكندرية' }));
    expect(submits(bulk).every((tag) => !tag.includes('disabled=""'))).toBe(true);
    // An edit is the machine's own branch already: nothing to say.
    expect(
      render(MANAGE, <MachineDialog open onClose={() => undefined} machine={machine()} />),
    ).not.toContain('data-add-branch');
  });

  // However the label dialog opened — the header's button, or an add begun on another tab that
  // came back through Back — a new label with no branch named waits for one (review finding).
  it('a new label with no branch to file under asks for one and keeps its save off', () => {
    const fill = { nameAr: 'منطقة', nameEn: 'Area' };
    const asked = render(
      OPERATIONS,
      <RefLabelDialog open onClose={() => undefined} kind="area" label={null} />,
      noBranch,
    );
    expect(asked).toContain('data-add-branch="none"');
    expect(asked).toContain(t('atm.dataEdit.chooseBranch'));
    expect(submits(asked)[0]).toContain('disabled=""');
    // With a branch, it is named before the save; a branch the caller names, or an edit, asks none.
    const named = render(
      OPERATIONS,
      <RefLabelDialog open onClose={() => undefined} kind="area" label={null} />,
    );
    expect(named).toContain(t('atm.dataEdit.addInBranch', { name: 'الإسكندرية' }));
    expect(
      render(
        OPERATIONS,
        <RefLabelDialog open onClose={() => undefined} kind="area" label={null} branchId={ALEX} />,
        noBranch,
      ),
    ).not.toContain('data-add-branch');
    expect(
      render(
        OPERATIONS,
        <RefLabelDialog open onClose={() => undefined} kind="area" label={refLabel(fill)} />,
        noBranch,
      ),
    ).not.toContain('data-add-branch');
  });

  it('with no branch to file under, asks for one in the top bar and keeps the add off', () => {
    const add = render(
      MANAGE,
      <MachineDialog open onClose={() => undefined} machine={null} />,
      noBranch,
    );
    expect(add).toContain('data-add-branch="none"');
    expect(add).toContain(t('atm.dataEdit.chooseBranch'));
    expect(submits(add)[0]).toContain('disabled=""');
    // «Not mapped in the register» is no reason here: there is no branch at all.
    expect(add).not.toContain('data-register-unmapped');
    const bulk = render(MANAGE, <BulkMachinesDialog open onClose={() => undefined} />, noBranch);
    expect(bulk).toContain(t('atm.dataEdit.chooseBranch'));
    expect(bulk).not.toContain('data-register-unmapped');
    const [bulkAdd, bulkDelete] = submits(bulk);
    expect(bulkAdd).toContain('disabled=""');
    // The delete finds its codes in the acting branch, as the add files there (DEC-39): with none,
    // every delete was refused with the add's own message (review finding).
    expect(bulkDelete, 'the delete files in the acting branch, as the add does').toContain(
      'disabled=""',
    );
    // Said once, over both halves — and in words that name no action.
    expect(bulk.indexOf('data-add-branch="none"')).toBeLessThan(bulk.indexOf('<form'));
    expect(bulk.match(/data-add-branch=/g)).toHaveLength(1);
    expect(t('atm.dataEdit.chooseBranch')).not.toContain('الإضافة');
    expect(addBlocked(NO_BRANCH)).toBe(true);
  });

  it('an older server that names no branch blocks nothing and says nothing', () => {
    const older: AtmRefLabelOptionsDto = { ...OPTIONS };
    delete older.branch;
    const add = render(
      MANAGE,
      <MachineDialog open onClose={() => undefined} machine={null} />,
      (qc) => qc.setQueryData(atmRefLabelOptionsKey(null), older),
    );
    expect(add).not.toContain('data-add-branch');
    expect(addBlocked(older)).toBe(false);
    expect(addBlocked(undefined), 'still loading').toBe(false);
  });

  it('on the label tabs, lists every branch with the reason, and keeps the add off', () => {
    const markup = render(
      OPERATIONS,
      <DataEditPage />,
      (qc) => {
        noBranch(qc);
        const mixed = refLabel({ kind: 'bank', name: 'EVERY BRANCH SPELLING', bankCode: 'NBE' });
        qc.setQueryData(
          listKey('atm', 'refLabels', {
            kind: 'bank',
            page: 1,
            pageSize: 25,
            sortDir: 'asc',
            sortBy: 'name',
          }),
          { items: [mixed], meta: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 } },
        );
      },
      '/atm/data-edit?tab=bankLabel',
    );
    expect(markup).toContain('data-labels-unscoped');
    expect(markup).toContain('EVERY BRANCH SPELLING');
    expect(tagWith(markup, 'button', 'data-edit-action', 'add-label')).toContain('disabled=""');
    // A branch named: the add is open.
    const named = render(OPERATIONS, <DataEditPage />, () => undefined, '/atm/data-edit?tab=area');
    expect(tagWith(named, 'button', 'data-edit-action', 'add-label')).not.toContain('disabled=""');
  });
});

// ── The spellings tab's callout ─────────────────────────────────────────────────────────────────

describe('the unmapped callout on «أسماء البنوك في التشغيل»', () => {
  type Unmapped = AtmRefLabelOptionsDto['unmappedBankLabels'][number];
  const listOf = (rows: AtmRefLabelDto[]): Paginated<AtmRefLabelDto> => ({
    items: rows,
    meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 },
  });
  const firstPage = { kind: 'bank', page: 1, pageSize: 25, sortDir: 'asc', sortBy: 'name' };
  /** The page as the server answers it: `unmapped` names, or entries with the row that holds one. */
  const page = (
    permissions: readonly string[],
    unmapped: (string | Unmapped)[],
    rows: AtmRefLabelDto[] = [],
  ) => {
    const entries = unmapped.map((entry) =>
      typeof entry === 'string' ? { name: entry, label: null } : entry,
    );
    return render(
      permissions,
      <DataEditPage />,
      (qc) => {
        qc.setQueryData(atmRefLabelOptionsKey(null), {
          ...OPTIONS,
          unmappedBankNames: entries.map((entry) => entry.name),
          unmappedBankLabels: entries,
        });
        // The table holds `rows` whichever way it asks — scoped to the options' branch or not — so
        // only the server's `unmappedBankLabels` can decide the link.
        qc.setQueryData(
          listKey('atm', 'refLabels', { ...firstPage, branchId: ALEX }),
          listOf(rows),
        );
        qc.setQueryData(listKey('atm', 'refLabels', firstPage), listOf(rows));
      },
      '/atm/data-edit?tab=bankLabel',
    );
  };
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

  it('a text the server says a row of this branch holds is EDITED, so only the edit key links it', () => {
    const row = refLabel({ kind: 'bank', name: 'OLD SPELLING', bankCode: null });
    const held = [{ name: 'OLD SPELLING', label: row }];
    expect(links(page(['atmMachine.view', 'atmRefLabel.edit'], held))).toBe(1);
    expect(links(page(['atmMachine.view', 'atmRefLabel.create'], held))).toBe(0);
    // An ARCHIVED spelling of a bank holds its text too (that is why it reads unmapped).
    const archived = refLabel({
      kind: 'bank',
      name: 'NBE FOREX',
      bankCode: 'NBE',
      isActive: false,
    });
    expect(
      links(
        page(['atmMachine.view', 'atmRefLabel.edit'], [{ name: 'NBE FOREX', label: archived }]),
      ),
    ).toBe(1);
  });

  it('another branch’s same-named row in the table never decides the link (review finding)', () => {
    // A user reaching Tanta too: Tanta's unlinked «OLD SPELLING» is no row of the acting branch, so
    // the server says none holds the text here — the link is an ADD, offered to the add key.
    const tanta = refLabel({
      id: '650000000000000000000c09',
      branchId: TANTA,
      kind: 'bank',
      name: 'OLD SPELLING',
      bankCode: null,
    });
    expect(links(page(['atmMachine.view', 'atmRefLabel.create'], ['OLD SPELLING'], [tanta]))).toBe(
      1,
    );
    expect(links(page(['atmMachine.view', 'atmRefLabel.edit'], ['OLD SPELLING'], [tanta]))).toBe(0);
  });

  it('the table lists the acting branch only — an unscoped answer is never what it shows', () => {
    const markup = render(
      OPERATIONS,
      <DataEditPage />,
      (qc) => {
        const ours = refLabel({ kind: 'bank', name: 'ALEX SPELLING', bankCode: 'NBE' });
        const mixed = refLabel({ kind: 'bank', name: 'EVERY BRANCH SPELLING', bankCode: 'NBE' });
        qc.setQueryData(
          listKey('atm', 'refLabels', { ...firstPage, branchId: ALEX }),
          listOf([ours]),
        );
        qc.setQueryData(listKey('atm', 'refLabels', firstPage), listOf([mixed]));
      },
      '/atm/data-edit?tab=bankLabel',
    );
    expect(markup).toContain('ALEX SPELLING');
    expect(markup).not.toContain('EVERY BRANCH SPELLING');
    expect(markup).not.toContain('data-labels-unscoped');
  });

  it('when the options cannot name one branch, the unscoped list is shown and says why', () => {
    const markup = render(
      OPERATIONS,
      <DataEditPage />,
      (qc) => {
        qc.removeQueries({ queryKey: atmRefLabelOptionsKey(null) });
        // A refused answer the page renders as it stands (no retry on mount in a static render).
        qc.setQueryDefaults(atmRefLabelOptionsKey(null), { retryOnMount: false });
        qc.getQueryCache()
          .build(qc, { queryKey: atmRefLabelOptionsKey(null) })
          .setState({ status: 'error', error: new Error('choose a branch'), fetchStatus: 'idle' });
        const mixed = refLabel({ kind: 'bank', name: 'EVERY BRANCH SPELLING', bankCode: 'NBE' });
        qc.setQueryData(listKey('atm', 'refLabels', firstPage), listOf([mixed]));
      },
      '/atm/data-edit?tab=bankLabel',
    );
    expect(markup).toContain('data-labels-unscoped');
    expect(markup).toContain(t('atm.dataEdit.labelsUnscoped'));
    expect(markup).toContain('EVERY BRANCH SPELLING');
  });

  it('«ربط ببنك» opens the row ACTIVE, so one save links it and brings it back', () => {
    const archived = refLabel({
      kind: 'bank',
      name: 'NBE FOREX',
      bankCode: 'NBE',
      isActive: false,
    });
    expect(refLabelFormOf(archived, '', true).isActive).toBe(true);
    expect(refLabelFormOf(archived).isActive).toBe(false);
    expect(refLabelUpdateBody('bank', archived, refLabelFormOf(archived, '', true))).toEqual({
      isActive: true,
      version: archived.version,
    });
    const markup = render(
      OPERATIONS,
      <RefLabelDialog open onClose={() => undefined} kind="bank" label={archived} activate />,
    );
    expect(tagWith(markup, 'input', 'type', 'checkbox')).toContain('checked=""');
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

  // An older server (rollback, or a tab on this bundle mid-deploy) answers the bare machine and the
  // bare bulk result: a machine it DID add must not read as a failure, and a retry as a taken code.
  it('an older server’s answers, without the register fields, read as «added», never a crash', () => {
    // The bare machine is exactly what an older server answers a single add with.
    expect(machineAddToast(machine(), t)).toEqual({
      variant: 'success',
      title: t('atm.dataEdit.machineAdded'),
      description: '',
    });
    expect(bulkAddToasts({ created: [machine()], skippedCodes: ['99990003'] }, t)).toEqual([
      { variant: 'success', title: t('atm.dataEdit.machinesAdded', { count: 1 }) },
      { variant: 'error', title: t('atm.dataEdit.machinesSkipped', { codes: '99990003' }) },
    ]);
    expect(bulkAddResultOf({ created: [], skippedCodes: [] })).toEqual({
      created: [],
      skippedCodes: [],
      reactivatedCodes: [],
      refused: [],
      register: { created: [], received: [], linked: [], existing: [], notRecorded: [] },
    });
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
