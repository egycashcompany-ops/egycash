// Operations reference data (B1) — the replacement for the legacy `/data_edit` screen.
//
// WHAT THE LEGACY SCREEN ACTUALLY DID (discovery §F, contad_app.js:1753-2227): one page holding
// four add-forms and three delete-forms for banks, branches, currencies and cities. The three
// deletes matched rows **by their Arabic name**, wrote three differently-named/typed timestamp
// fields, and performed no referential check whatsoever (quirks Q22, Q34).
//
// WHAT THIS SCREEN DOES INSTEAD, and why:
//   · Banks / branches / currencies are the three kinds Operations actually joins on.
//   · AREAS arrive in B6, correcting what this comment said in B1. B1 recorded cities as read by
//     nothing; re-reading the legacy view shows they ARE read — `data_edit.ejs:924` renders them
//     into the `<datalist>` behind a branch's `area` field, which is the string `opsAreaName`
//     stores. They are a suggestion list, so that is what the tab maintains. (`/tashghela` also
//     loads them and passes them to a template that never reads them — that half was dead.)
//   · Rows deactivate rather than delete. Legacy soft-deleted with no referential check, which
//     silently removed a bank from future pickers while historical reports kept grouping on its
//     stale name string. `isActive` says the same thing honestly.
//   · Identity is the row id, never the Arabic name (Q34 NORMALIZE).
//   · THE CURRENCIES ARE DRAGGED INTO ORDER (Round 8) — «اعملى فى شاشة البيانات المرجعية ان اقدر اعدل
//     زى شاشة الحركة بالظبط»: Fleet's catalogs page exactly (fleet/pages/CatalogsPage.tsx) — a grip
//     to drag a row by, the arrows beside the pen for a keyboard, the dropped order shown at once
//     and saved (`PUT /operations/currencies/order`), put back with the reason if the save is
//     refused. «ترتيب العملات فى الجدول لما تظهر تكون على حسب ترتيبها ف شاشة البيانات المرجعية»: every
//     screen that lists currencies follows this order (`compareCurrencies`, lib/day-board.ts). The
//     tab shows the WHOLE list on one page — a list cannot be dragged into order across pages.
//   · «أنواع التشغيل» (Round 20) — the crew board's «النوع», which the owner asked to be reference
//     data: «انا عاوز النوع يكون بيضاف من البيانات المرجعيه». Built as the currencies are — the whole
//     list, dragged into the order the board lists them in (`PUT /operations/shift-types/order`) —
//     with a colour from the contract's palette, and archived (`isActive: false`) and restored from
//     the row in one click: a type is never deleted, because a saved row may still carry it.
//
// ROUND 34 B — «وعاوز أغير اللي اوت بتاع بيانات المراجعة يكون بروفيشنال أكتر من كده، وعاوز الداتا اللي
// تبقى كبيرة زي الفروع والمناطق والبنوك وهكذا يكون في سيرش اقدر اسيرش بيه». The screen in the
// boards' look (the day board's framed table and dark filter bar, Fleet's figures):
//   · the kinds are a row of cards (`CatalogKindCards`) — each one's icon, name and how many rows it
//     holds, still a real tab list in the address bar's `?kind=`. The counts: banks from the bank
//     list the screen already reads whole; branches and areas from a one-row read (`COUNT_READ` —
//     its `totalItems`); currencies and «أنواع التشغيل» from the whole lists their tabs show;
//   · banks, branches and areas get a toolbar (`CatalogToolbar`): the search, «الحالة», on the
//     branches «البنك», the reset and «n نتيجة». The search is the SERVER's (`search`, folded there),
//     sent ~300ms after the last key, kept in `?q=`; the rules are `lib/catalog-filters.ts`;
//   · the table sits in a frame with its pager in the frame's foot (25 / 50 / 100 a page), its head
//     held while the rows scroll on a computer, and an empty answer says what was searched for and
//     offers the way back;
//   · currencies and «أنواع التشغيل» keep their drag, their arrows and their whole list on one page,
//     and take no search: a filter over a dragged list would hide the rows a drop lands between.
//   · without `operationsCatalog.manage` (the route asks for it; the screen does not lean on that)
//     there is no add, no import, no pen, no grip and no archive.
//
// URL-synced tabs, exactly like the fleet catalogs screen, so an operator can bookmark a kind.
import { useMemo, useState, type HTMLAttributes, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  MAX_PAGE_SIZE,
  type OperationsAreaDto,
  type OperationsBankBranchDto,
  type OperationsBankDto,
  type OperationsCurrencyDto,
  type OperationsShiftTypeDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { NumberedPager } from '../../../shared/ui/NumberedPager';
import { Badge } from '../../../shared/ui/Badge';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../../../shared/ui/board-scroll';
import {
  ChevronIcon,
  GripIcon,
  PauseIcon,
  PinIcon,
  PlayIcon,
  SearchIcon,
  UploadIcon,
} from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { useAppSelector } from '../../../store';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import { ACTION_GROUP, actionTone } from '../../fleet/components/row-actions-look';
import { SquarePenIcon } from '../../fleet/components/row-action-icons';
import { mapsUrl } from '../lib/maps-link';
import { inPendingOrder, moveInOrder, stepInOrder } from '../lib/catalog-order';
import {
  CATALOG_DEFAULT_PAGE_SIZE,
  CATALOG_PAGE_SIZES,
  catalogListQuery,
  foldCatalogSearch,
  hasCatalogFilter,
  isSearchableKind,
  matchParts,
  readCatalogFilters,
  withCatalogFilters,
  withCatalogKind,
  withCatalogSearch,
  withKnownBank,
  withoutCatalogFilters,
} from '../lib/catalog-filters';
import {
  useCatalogAreasPage,
  useCatalogBanksPage,
  useCatalogBranchesPage,
  useOperationsAreas,
  useOperationsBankBranches,
  useOperationsBanks,
  useOperationsCurrencies,
  useOperationsShiftTypes,
  useOrderOperationsCurrencies,
  useOrderOperationsShiftTypes,
  useUpdateOperationsShiftType,
} from '../api/operations-queries';
import {
  AreaDialog,
  BankBranchDialog,
  BankDialog,
  CurrencyDialog,
  ShiftTypeDialog,
} from '../components/CatalogDialogs';
import { ShiftTypeTag } from '../components/shift-type-look';
import { BranchImportPanel } from '../components/branch-import/BranchImportPanel';
import { CATALOG_PANEL_ID, CatalogKindCards, catalogTabId } from '../components/CatalogKindCards';
import { CatalogToolbar } from '../components/CatalogToolbar';
import { ADD_BUTTON, BOARD_TABLE_LOOK, BRAND_BUTTON } from '../components/ShipmentsBoard';
import { SHIFT_TYPE_LIST } from '../lib/crew-plan';

export const OPERATIONS_CATALOG_KINDS = [
  'banks',
  'branches',
  'currencies',
  'areas',
  'shiftTypes',
] as const;
export type OperationsCatalogKind = (typeof OPERATIONS_CATALOG_KINDS)[number];

/** Unknown or absent `?kind=` falls back to banks — the kind everything else references. */
export const resolveCatalogKind = (raw: string | null): OperationsCatalogKind =>
  (OPERATIONS_CATALOG_KINDS as readonly string[]).includes(raw ?? '')
    ? (raw as OperationsCatalogKind)
    : 'banks';

/**
 * The currencies tab asks for the WHOLE catalog on one page, in the catalog's order (no `sortBy`:
 * the server's default IS the dragged order). The same key every screen's currency lookup reads,
 * so a drag saved here re-orders a board's money lines from the same cache entry.
 */
export const CURRENCY_TAB_PARAMS = { page: 1, pageSize: MAX_PAGE_SIZE } as const;

/**
 * The read a kind card counts by — one row, for its `totalItems` (Round 34 B). The branches and the
 * areas only: the banks' card reads the bank list the screen holds whole anyway, and the dragged
 * lists' cards read the whole lists their tabs show.
 */
export const COUNT_READ = { page: 1, pageSize: 1 } as const;

/** The bank list the branch rows name their bank from — whole, by code. */
export const BANK_OPTIONS = {
  page: 1,
  pageSize: MAX_PAGE_SIZE,
  sortBy: 'code',
  sortDir: 'asc',
} as const;

/**
 * The frame the table and its pager sit in — the boards' surface. The table inside it is the
 * boards' table (`BOARD_TABLE_LOOK`), its own wrapper drawing no second frame: `embedded` drops its
 * border, and the doubled `&&` outranks the look's rounded corners, which on a scrolling wrapper
 * would clip the last row's corners above the pager.
 */
const FRAME =
  'flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827] lg:min-h-[14rem] lg:flex-1';
const CATALOG_TABLE = cn(
  BOARD_TABLE_LOOK,
  BOARD_TABLE_FILL,
  '[&&>div]:!rounded-none',
  // A comfortable row: the rows are read one by one, not scanned fourteen columns wide.
  '[&_tbody_td]:!py-3 min-[1750px]:[&_tbody_td]:!py-3.5',
  // The names in Cairo. The boards' cells set their words in the figures' monospace stack, whose
  // wide space pulls «فرع المعادي - شارع 9» apart word by word — right for a van code, wrong for a
  // list read by its names. The codes and numbers keep the figure face (`Figure`).
  "[&&_td]:[font-family:'Cairo',ui-sans-serif,sans-serif]",
);

/** What the search found, marked in the cell — the folded match (`matchParts`). */
const Found = ({ text, term }: { text: string; term: string }): JSX.Element => (
  <>
    {matchParts(text, term).map((part, i) =>
      part.hit ? (
        <mark
          key={i}
          data-catalog-match="true"
          className="rounded-sm bg-amber-300/50 text-inherit dark:bg-amber-400/30 dark:text-amber-50"
        >
          {part.text}
        </mark>
      ) : (
        <span key={i}>{part.text}</span>
      ),
    )}
  </>
);

/** A code or a number, in the boards' figures: Latin digits, left to right inside Arabic. */
const Figure = ({ children }: { children: ReactNode }): JSX.Element => (
  <bdi dir="ltr" className={NUM}>
    {children}
  </bdi>
);

/** The boards' status badge: the small one, its dot, «مُفعَّل» green or «غير مُفعَّل» grey. */
const ActiveBadge = ({ active }: { active: boolean }): JSX.Element => {
  const t = useT();
  return (
    <span data-catalog-status={active ? 'active' : 'inactive'}>
      <Badge tone={active ? 'success' : 'neutral'} size="sm">
        <span
          className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-emerald-500' : 'bg-slate-400')}
        />
        {t(active ? 'operations.common.active' : 'operations.common.inactive')}
      </Badge>
    </span>
  );
};

/**
 * A catalog DRAGGED INTO ORDER — Fleet's catalogs page, step for step: the currencies (Round 8) and
 * «أنواع التشغيل» (Round 20) alike. The order just dropped is shown at once while the save and the
 * refetch land; a refused save puts the rows back and SAYS so (a row that silently snaps back reads
 * as a screen that will not let you move it); only THIS drop's order is let go of once the fresh
 * list is in — a second drop made while the first was saving keeps showing until its own lands.
 */
const useDragOrder = <T extends { id: string }>(
  items: readonly T[],
  order: {
    mutate: (
      body: { ids: string[] },
      options: { onSuccess: () => void; onError: (failure: Error) => void; onSettled: () => void },
    ) => void;
  },
  savedMessage: string,
) => {
  const locale = useAppSelector((state) => state.locale.locale);
  const [pending, setPending] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const rows = inPendingOrder(items, pending);
  const ids = rows.map((row) => row.id);

  const save = (next: string[] | null): void => {
    if (next === null) return;
    setPending(next);
    order.mutate(
      { ids: next },
      {
        onSuccess: () => toast.success(savedMessage),
        onError: (failure) => toast.error(errorMessage(failure, locale)),
        onSettled: () => setPending((current) => (current === next ? null : current)),
      },
    );
  };

  const rowClassName = (row: T): string | undefined =>
    dragging === row.id
      ? 'opacity-40'
      : over === row.id && dragging !== null
        ? 'bg-brand-50 outline outline-2 -outline-offset-2 outline-brand-400 dark:bg-brand-950/40'
        : undefined;

  const rowProps = (row: T): HTMLAttributes<HTMLTableRowElement> => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData('text/plain', row.id);
      e.dataTransfer.effectAllowed = 'move';
      setDragging(row.id);
    },
    onDragEnd: () => {
      setDragging(null);
      setOver(null);
    },
    onDragOver: (e) => {
      e.preventDefault();
      setOver(row.id);
    },
    onDrop: (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      setDragging(null);
      setOver(null);
      if (id !== '') save(moveInOrder(ids, id, row.id));
    },
  });

  return { rows, ids, save, rowClassName, rowProps };
};

export const CatalogsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);
  const dir = useAppSelector((state) => state.locale.dir);
  const [sp, setSp] = useSearchParams();

  const kind = resolveCatalogKind(sp.get('kind'));
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize =
    Number(sp.get('size') ?? String(CATALOG_DEFAULT_PAGE_SIZE)) || CATALOG_DEFAULT_PAGE_SIZE;
  // Branch rows name their bank, the branches' bank filter lists them, and the banks' card counts
  // them — so the bank list is read whole on every kind.
  const bankOptions = useOperationsBanks(BANK_OPTIONS);
  // The address bar's narrowing, read as the server would take it: a `bank` that is no id, or
  // names no bank on the list, is no filter (Round 34 critic).
  const filters = withKnownBank(
    readCatalogFilters(sp),
    bankOptions.data?.items.map((bank) => bank.id),
  );
  const searchable = isSearchableKind(kind);
  const filtered = hasCatalogFilter(kind, filters);
  // The search the rows mark — only on a kind that takes one.
  const term = searchable ? filters.q : '';
  const mayManage = can('operationsCatalog.manage');

  const params = useMemo(
    () => catalogListQuery(kind, filters, page, pageSize),
    [kind, filters.q, filters.status, filters.bank, page, pageSize],
  );

  // Only the active tab's list runs; the others stay idle rather than pre-fetching a screen the
  // operator may never open. The last answer stays on screen while the next is asked.
  const banks = useCatalogBanksPage(params, kind === 'banks');
  const branches = useCatalogBranchesPage(params, kind === 'branches');
  const areas = useCatalogAreasPage(params, kind === 'areas');
  // The dragged lists are read whole — and on every kind, small as they are, for their cards' counts.
  const currencies = useOperationsCurrencies(CURRENCY_TAB_PARAMS);
  // The board's own list (`SHIFT_TYPE_LIST` — whole, archived included, the catalog's order): one
  // cache entry, so a type dragged or recoloured here is what the board shows next.
  const shiftTypes = useOperationsShiftTypes(SHIFT_TYPE_LIST);

  // The branch FORM suggests areas, so that list is needed on the branches tab as well.
  const areaOptions = useOperationsAreas(
    { page: 1, pageSize: MAX_PAGE_SIZE, sortBy: 'name', sortDir: 'asc' },
    kind === 'branches',
  );
  // The cards' counts for the two lists too big to read whole.
  const branchCount = useOperationsBankBranches(COUNT_READ);
  const areaCount = useOperationsAreas(COUNT_READ);

  const [editingBank, setEditingBank] = useState<OperationsBankDto | null>(null);
  const [editingBranch, setEditingBranch] = useState<OperationsBankBranchDto | null>(null);
  const [editingCurrency, setEditingCurrency] = useState<OperationsCurrencyDto | null>(null);
  const [editingArea, setEditingArea] = useState<OperationsAreaDto | null>(null);
  const [editingShiftType, setEditingShiftType] = useState<OperationsShiftTypeDto | null>(null);
  const [creating, setCreating] = useState(false);
  // Round 29 — «وعاوز جمب اضافة فرع فوق يقدر يضيف شيت ويقارن زى بتاع كروت الشحن كدا»: the branches
  // tab shows the sheet import in place of its list while this is on.
  const [importing, setImporting] = useState(false);

  // ── The address bar: the kind, the search and the filters (lib/catalog-filters.ts) ────────────
  const selectKind = (next: OperationsCatalogKind): void => {
    setImporting(false);
    setSp((prev) => withCatalogKind(prev, next));
  };
  // Typing replaces the entry rather than adding one per pause: Back leaves the screen's search,
  // it does not spell it backwards. The same question folded — a space added, ✕ on a text never
  // sent — writes nothing, so the page the reader is on stays (`withCatalogSearch`).
  const search = (text: string): void => {
    const next = withCatalogSearch(sp, text);
    if (next !== null) setSp(next, { replace: true });
  };
  const narrow = (updates: { status?: string; bank?: string }): void =>
    setSp((prev) => withCatalogFilters(prev, updates));
  const reset = (): void => setSp((prev) => withoutCatalogFilters(prev));
  const goToPage = (next: number): void =>
    setSp((prev) => {
      const out = new URLSearchParams(prev);
      if (next <= 1) out.delete('page');
      else out.set('page', String(next));
      return out;
    });
  const setPageSize = (size: number): void =>
    setSp((prev) => {
      const out = new URLSearchParams(prev);
      out.set('size', String(size));
      out.delete('page');
      return out;
    });

  // ── The drag orders — Fleet's catalogs page, step for step (`useDragOrder`) ────────────────────
  const mayOrder = mayManage;
  const currencyOrder = useDragOrder(
    currencies.data?.items ?? [],
    useOrderOperationsCurrencies(),
    t('operations.catalogs.currency.orderSaved'),
  );
  const currencyRows = currencyOrder.rows;
  const saveCurrencyOrder = currencyOrder.save;
  const currencyIds = currencyOrder.ids;

  // ── «أنواع التشغيل» ───────────────────────────────────────────────────────────────────────────
  const shiftTypeOrder = useDragOrder(
    shiftTypes.data?.items ?? [],
    useOrderOperationsShiftTypes(),
    t('operations.catalogs.shiftType.orderSaved'),
  );
  const shiftTypeIds = shiftTypeOrder.ids;
  const archive = useUpdateOperationsShiftType();
  /** Archive or restore in one click — the server keeps the type on every row that holds it. */
  const toggleActive = (type: OperationsShiftTypeDto): void =>
    archive.mutate(
      { id: type.id, body: { isActive: !type.isActive, version: type.version } },
      {
        onSuccess: () =>
          toast.success(
            t(
              type.isActive
                ? 'operations.catalogs.shiftType.archived'
                : 'operations.catalogs.shiftType.restored',
            ),
          ),
        onError: (failure) => toast.error(errorMessage(failure, locale)),
      },
    );

  const bankName = (bankId: string): string =>
    bankOptions.data?.items.find((bank) => bank.id === bankId)?.opsName ?? '—';

  /** A row's pen, in the boards' action box — only for whoever may change the catalog. */
  const editColumn = <T,>(mark: string, onEdit: (row: T) => void): Column<T>[] =>
    mayManage
      ? [
          {
            key: 'actions',
            header: '',
            align: 'end',
            render: (row: T) => (
              <div className={ACTION_GROUP} {...{ [mark]: 'true' }}>
                <button
                  type="button"
                  className={actionTone('edit')}
                  aria-label={t('common.edit')}
                  title={t('common.edit')}
                  onClick={() => onEdit(row)}
                >
                  <SquarePenIcon className="h-4 w-4" />
                </button>
              </div>
            ),
          },
        ]
      : [];

  const bankColumns: Column<OperationsBankDto>[] = [
    {
      key: 'code',
      header: t('operations.catalogs.bank.code'),
      render: (row) => <Figure>{row.code}</Figure>,
    },
    {
      key: 'opsName',
      header: t('operations.catalogs.bank.opsName'),
      render: (row) => <Found text={row.opsName} term={term} />,
    },
    {
      key: 'nameAr',
      header: t('operations.catalogs.bank.nameAr'),
      render: (row) => <Found text={row.name.ar} term={term} />,
    },
    {
      key: 'nameEn',
      header: t('operations.catalogs.bank.nameEn'),
      render: (row) =>
        row.name.en.trim() === '' ? (
          '—'
        ) : (
          <bdi dir="ltr">
            <Found text={row.name.en} term={term} />
          </bdi>
        ),
    },
    {
      key: 'sortOrder',
      header: t('operations.catalogs.bank.sortOrder'),
      render: (row) => (row.sortOrder === null ? '—' : <Figure>{row.sortOrder}</Figure>),
    },
    {
      key: 'status',
      header: t('operations.common.status'),
      render: (row) => <ActiveBadge active={row.isActive} />,
    },
    ...editColumn<OperationsBankDto>('data-bank-actions', setEditingBank),
  ];

  const branchColumns: Column<OperationsBankBranchDto>[] = [
    {
      key: 'code',
      header: t('operations.catalogs.branch.code'),
      render: (row) => (
        <Figure>
          <Found text={row.code} term={term} />
        </Figure>
      ),
    },
    {
      key: 'name',
      header: t('operations.catalogs.branch.name'),
      render: (row) => <Found text={row.name} term={term} />,
    },
    {
      key: 'bank',
      header: t('operations.catalogs.branch.bank'),
      render: (row) => bankName(row.bankId),
    },
    {
      key: 'opsArea',
      header: t('operations.catalogs.branch.opsArea'),
      render: (row) =>
        row.opsAreaName === null ? '—' : <Found text={row.opsAreaName} term={term} />,
    },
    {
      key: 'financeArea',
      header: t('operations.catalogs.branch.financeArea'),
      render: (row) => row.financeAreaName ?? '—',
    },
    {
      // Which branches a captain can actually be navigated to. Legacy carried no geography, so
      // most rows start blank — showing the gap in the list is what makes filling it a task
      // somebody can work through rather than a field they have to open each branch to discover.
      key: 'location',
      header: t('operations.catalogs.branch.location'),
      align: 'center',
      render: (row) =>
        row.location?.coordinates == null ? (
          <span className="text-slate-400">—</span>
        ) : (
          <a
            href={mapsUrl(row.location.coordinates)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            data-branch-maps={row.id}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-brand-600 transition-colors hover:bg-brand-500/10 dark:text-brand-300"
            title={t('operations.catalogs.branch.maps.open')}
            aria-label={t('operations.catalogs.branch.maps.open')}
          >
            <PinIcon className="h-4 w-4" />
          </a>
        ),
    },
    {
      key: 'status',
      header: t('operations.common.status'),
      render: (row) => <ActiveBadge active={row.isActive} />,
    },
    ...editColumn<OperationsBankBranchDto>('data-branch-actions', setEditingBranch),
  ];

  const currencyColumns: Column<OperationsCurrencyDto>[] = [
    ...(mayOrder
      ? [
          {
            key: 'drag',
            header: '',
            render: (row: OperationsCurrencyDto) => (
              <span
                data-drag-handle={row.id}
                title={t('operations.catalogs.currency.dragToOrder')}
                className="inline-flex cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <GripIcon className="h-4 w-4" />
              </span>
            ),
          } satisfies Column<OperationsCurrencyDto>,
        ]
      : []),
    {
      key: 'code',
      header: t('operations.catalogs.currency.code'),
      render: (row) => <Figure>{row.code}</Figure>,
    },
    { key: 'name', header: t('operations.catalogs.currency.name'), render: (row) => row.name },
    {
      key: 'aliases',
      header: t('operations.catalogs.currency.aliases'),
      render: (row) => (row.legacyAliases.length === 0 ? '—' : row.legacyAliases.join('، ')),
    },
    {
      key: 'status',
      header: t('operations.common.status'),
      render: (row) => <ActiveBadge active={row.isActive} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (row) => {
        const at = currencyIds.indexOf(row.id);
        return (
          // Fleet's row: the pen first, then the two arrows that move the row — how a keyboard
          // moves it — in the owner's box (`row-actions-look`).
          <div className={ACTION_GROUP} data-currency-actions={row.id}>
            {mayManage && (
              <button
                type="button"
                className={actionTone('edit')}
                aria-label={t('common.edit')}
                title={t('common.edit')}
                onClick={() => setEditingCurrency(row)}
              >
                <SquarePenIcon className="h-4 w-4" />
              </button>
            )}
            {mayOrder && (
              <>
                <button
                  type="button"
                  className={actionTone('move')}
                  aria-label={t('operations.catalogs.currency.moveUp')}
                  title={t('operations.catalogs.currency.moveUp')}
                  disabled={at <= 0}
                  onClick={() => saveCurrencyOrder(stepInOrder(currencyIds, row.id, -1))}
                >
                  <ChevronIcon className="h-4 w-4 rotate-180" />
                </button>
                <button
                  type="button"
                  className={actionTone('move')}
                  aria-label={t('operations.catalogs.currency.moveDown')}
                  title={t('operations.catalogs.currency.moveDown')}
                  disabled={at === currencyIds.length - 1}
                  onClick={() => saveCurrencyOrder(stepInOrder(currencyIds, row.id, 1))}
                >
                  <ChevronIcon className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        );
      },
    },
  ];

  const areaColumns: Column<OperationsAreaDto>[] = [
    {
      key: 'name',
      header: t('operations.catalogs.area.name'),
      render: (row) => <Found text={row.name} term={term} />,
    },
    {
      key: 'nameEn',
      header: t('operations.catalogs.area.nameEn'),
      render: (row) =>
        row.nameEn === null ? (
          '—'
        ) : (
          <bdi dir="ltr">
            <Found text={row.nameEn} term={term} />
          </bdi>
        ),
    },
    {
      key: 'governorate',
      header: t('operations.catalogs.area.governorate'),
      render: (row) =>
        row.governorate === null ? '—' : <Found text={row.governorate} term={term} />,
    },
    {
      key: 'status',
      header: t('operations.common.status'),
      render: (row) => <ActiveBadge active={row.isActive} />,
    },
    ...editColumn<OperationsAreaDto>('data-area-actions', setEditingArea),
  ];

  const shiftTypeColumns: Column<OperationsShiftTypeDto>[] = [
    ...(mayOrder
      ? [
          {
            key: 'drag',
            header: '',
            render: (row: OperationsShiftTypeDto) => (
              <span
                data-drag-handle={row.id}
                title={t('operations.catalogs.shiftType.dragToOrder')}
                className="inline-flex cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <GripIcon className="h-4 w-4" />
              </span>
            ),
          } satisfies Column<OperationsShiftTypeDto>,
        ]
      : []),
    {
      // The type as the board draws it — its name in its colour.
      key: 'name',
      header: t('operations.catalogs.shiftType.name'),
      render: (row) => (
        <span data-shift-type-name={row.id}>
          <ShiftTypeTag type={row} locale="ar" size="md" />
        </span>
      ),
    },
    {
      key: 'nameEn',
      header: t('operations.catalogs.shiftType.nameEn'),
      render: (row) => (row.nameEn === null ? '—' : <bdi dir="ltr">{row.nameEn}</bdi>),
    },
    {
      key: 'colour',
      header: t('operations.catalogs.shiftType.colour'),
      render: (row) => t(`operations.catalogs.shiftType.colours.${row.colour}`),
    },
    {
      key: 'status',
      header: t('operations.common.status'),
      render: (row) => <ActiveBadge active={row.isActive} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (row) => {
        const at = shiftTypeIds.indexOf(row.id);
        const toggleLabel = t(
          row.isActive
            ? 'operations.catalogs.shiftType.archive'
            : 'operations.catalogs.shiftType.restore',
        );
        return (
          // The currencies' row: the pen first, then archive / restore, then the two arrows.
          <div className={ACTION_GROUP} data-shift-type-actions={row.id}>
            {mayManage && (
              <button
                type="button"
                className={actionTone('edit')}
                aria-label={t('common.edit')}
                title={t('common.edit')}
                onClick={() => setEditingShiftType(row)}
              >
                <SquarePenIcon className="h-4 w-4" />
              </button>
            )}
            {mayOrder && (
              <>
                <button
                  type="button"
                  className={actionTone('status')}
                  data-shift-type-toggle={row.isActive ? 'archive' : 'restore'}
                  aria-label={toggleLabel}
                  title={toggleLabel}
                  disabled={archive.isPending}
                  onClick={() => toggleActive(row)}
                >
                  {row.isActive ? (
                    <PauseIcon className="h-4 w-4" />
                  ) : (
                    <PlayIcon className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  className={actionTone('move')}
                  aria-label={t('operations.catalogs.shiftType.moveUp')}
                  title={t('operations.catalogs.shiftType.moveUp')}
                  disabled={at <= 0}
                  onClick={() => shiftTypeOrder.save(stepInOrder(shiftTypeIds, row.id, -1))}
                >
                  <ChevronIcon className="h-4 w-4 rotate-180" />
                </button>
                <button
                  type="button"
                  className={actionTone('move')}
                  aria-label={t('operations.catalogs.shiftType.moveDown')}
                  title={t('operations.catalogs.shiftType.moveDown')}
                  disabled={at === shiftTypeIds.length - 1}
                  onClick={() => shiftTypeOrder.save(stepInOrder(shiftTypeIds, row.id, 1))}
                >
                  <ChevronIcon className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        );
      },
    },
  ];

  /** The searchable kind's list on screen, or null on a dragged one. */
  const paged =
    kind === 'banks' ? banks : kind === 'branches' ? branches : kind === 'areas' ? areas : null;
  // The whole dragged lists on one page: nothing to page through, and a pager would suggest a
  // second page the drag could not reach.
  const activeMeta = paged?.data?.meta;
  // A new answer on its way while the last one stays on screen (`placeholderData`).
  const refreshing = paged !== null && paged.isPlaceholderData && paged.isFetching;
  // The read failed: the table says so with «إعادة المحاولة», and the toolbar's count and the pager
  // say nothing beside it (Round 34 critic — the count read «جارٍ التحميل…» for good).
  const failed = paged !== null && paged.isError;

  const counts: Record<OperationsCatalogKind, number | null> = {
    banks: bankOptions.data?.meta.totalItems ?? null,
    branches: branchCount.data?.meta.totalItems ?? null,
    currencies: currencies.data?.meta.totalItems ?? null,
    areas: areaCount.data?.meta.totalItems ?? null,
    shiftTypes: shiftTypes.data?.meta.totalItems ?? null,
  };

  /**
   * What an empty answer says. A list with nothing narrowing it is empty for real («لا توجد فروع
   * بعد»); a search or a filter that found nothing says what was asked and offers the way back —
   * «لا توجد نتائج لـ «…»» with «مسح البحث» — rather than reading as a catalog with nothing in it.
   */
  const emptyFor = (plainKey: string): ReactNode => {
    if (!filtered) return <EmptyState title={t(plainKey)} />;
    const term = foldCatalogSearch(filters.q) === '' ? '' : filters.q.trim();
    const narrowed = filters.status !== '' || (kind === 'branches' && filters.bank !== '');
    return (
      <div data-catalog-empty={term !== '' ? 'search' : 'filters'}>
        <EmptyState
          icon={<SearchIcon className="h-10 w-10" />}
          title={
            term !== ''
              ? t('operations.catalogs.empty.search', { term })
              : t('operations.catalogs.empty.filters')
          }
          description={t('operations.catalogs.empty.searchHint')}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {term !== '' && (
                <button
                  type="button"
                  className={BRAND_BUTTON}
                  data-catalog-empty-clear="search"
                  onClick={() => search('')}
                >
                  {t('operations.catalogs.empty.clearSearch')}
                </button>
              )}
              {narrowed && (
                <button
                  type="button"
                  className={BRAND_BUTTON}
                  data-catalog-empty-clear="all"
                  onClick={reset}
                >
                  {t('operations.catalogs.empty.clearFilters')}
                </button>
              )}
            </div>
          }
        />
      </div>
    );
  };

  /** The `add` label follows the tab. One map, so a new kind cannot be forgotten here. */
  const addLabelKey: Record<typeof kind, string> = {
    banks: 'operations.catalogs.bank.add',
    branches: 'operations.catalogs.branch.add',
    currencies: 'operations.catalogs.currency.add',
    areas: 'operations.catalogs.area.add',
    shiftTypes: 'operations.catalogs.shiftType.add',
  };

  /** The dragged lists' note, on the toolbar's line — for whoever may drag. */
  const orderHint =
    kind === 'currencies' ? (
      <p
        className="text-xs font-semibold text-slate-500 dark:text-slate-400"
        data-currency-order-hint
      >
        {t('operations.catalogs.currency.orderHint')}
      </p>
    ) : (
      <p
        className="text-xs font-semibold text-slate-500 dark:text-slate-400"
        data-shift-type-order-hint
      >
        {t('operations.catalogs.shiftType.orderHint')}
      </p>
    );

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME}>
        {/* The header's own bottom margin given up: the frame's gap already parts it from the cards. */}
        <div className="shrink-0 [&>div]:!mb-0">
          <PageHeader
            title={t('operations.catalogs.title')}
            actions={
              mayManage ? (
                // The boards' buttons, at the title's end on every kind: «استيراد فروع من شيت» beside
                // «إضافة فرع» (Round 29), the add of the kind on screen.
                <div className="flex flex-wrap items-center gap-2" data-catalog-actions="true">
                  {kind === 'branches' && !importing && (
                    <button
                      type="button"
                      className={BRAND_BUTTON}
                      onClick={() => setImporting(true)}
                      data-branch-import-open="true"
                    >
                      <UploadIcon className="h-3.5 w-3.5" />
                      {t('operations.catalogs.branchImport.open')}
                    </button>
                  )}
                  <button
                    type="button"
                    className={ADD_BUTTON}
                    onClick={() => setCreating(true)}
                    data-catalog-add={kind}
                  >
                    <BoardIcon d={[...PATH.plus]} className="h-3.5 w-3.5" width={2.5} />
                    {t(addLabelKey[kind])}
                  </button>
                </div>
              ) : undefined
            }
          />
        </div>

        <CatalogKindCards
          kinds={OPERATIONS_CATALOG_KINDS}
          current={kind}
          counts={counts}
          dir={dir}
          onSelect={selectKind}
        />

        <div
          role="tabpanel"
          id={CATALOG_PANEL_ID}
          aria-labelledby={catalogTabId(kind)}
          data-catalog-panel={kind}
          className="flex min-w-0 flex-col gap-3 lg:min-h-0 lg:flex-1"
        >
          {kind === 'branches' && importing ? (
            <BranchImportPanel
              banks={(bankOptions.data?.items ?? []).filter((bank) => bank.isActive)}
              onClose={() => setImporting(false)}
            />
          ) : (
            <>
              {searchable ? (
                <CatalogToolbar
                  kind={kind}
                  filters={filters}
                  banks={bankOptions.data?.items ?? []}
                  results={activeMeta?.totalItems ?? null}
                  failed={failed}
                  refreshing={refreshing}
                  onSearch={search}
                  onFilters={narrow}
                  onReset={reset}
                  active={filtered}
                />
              ) : (
                mayOrder && (
                  <div
                    className="flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-[#111827]"
                    data-catalog-order-bar={kind}
                  >
                    <GripIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    {orderHint}
                  </div>
                )
              )}

              <div className={FRAME} data-catalog-frame={kind}>
                <div
                  className={cn(CATALOG_TABLE, 'transition-opacity', refreshing && 'opacity-60')}
                  aria-busy={refreshing || undefined}
                >
                  {kind === 'banks' && (
                    <DataTable
                      columns={bankColumns}
                      rows={banks.data?.items ?? []}
                      rowKey={(row) => row.id}
                      loading={banks.isLoading}
                      error={banks.error}
                      onRetry={() => void banks.refetch()}
                      empty={emptyFor('operations.catalogs.bank.empty')}
                      rowClassName={(row) => (row.isActive ? undefined : 'opacity-60')}
                      embedded
                      stickyHead
                      minColumnWidth={6}
                    />
                  )}
                  {kind === 'branches' && (
                    <DataTable
                      columns={branchColumns}
                      rows={branches.data?.items ?? []}
                      rowKey={(row) => row.id}
                      loading={branches.isLoading}
                      error={branches.error}
                      onRetry={() => void branches.refetch()}
                      empty={emptyFor('operations.catalogs.branch.empty')}
                      rowClassName={(row) => (row.isActive ? undefined : 'opacity-60')}
                      embedded
                      stickyHead
                      minColumnWidth={6}
                    />
                  )}
                  {kind === 'currencies' && (
                    <DataTable
                      columns={currencyColumns}
                      rows={currencyRows}
                      rowKey={(row) => row.id}
                      loading={currencies.isLoading}
                      error={currencies.error}
                      onRetry={() => void currencies.refetch()}
                      empty={<EmptyState title={t('operations.catalogs.currency.empty')} />}
                      rowClassName={currencyOrder.rowClassName}
                      rowProps={(row) => (mayOrder ? currencyOrder.rowProps(row) : undefined)}
                      embedded
                      stickyHead
                      minColumnWidth={6}
                    />
                  )}
                  {kind === 'areas' && (
                    <DataTable
                      columns={areaColumns}
                      rows={areas.data?.items ?? []}
                      rowKey={(row) => row.id}
                      loading={areas.isLoading}
                      error={areas.error}
                      onRetry={() => void areas.refetch()}
                      empty={emptyFor('operations.catalogs.area.empty')}
                      rowClassName={(row) => (row.isActive ? undefined : 'opacity-60')}
                      embedded
                      stickyHead
                      minColumnWidth={6}
                    />
                  )}
                  {kind === 'shiftTypes' && (
                    <DataTable
                      columns={shiftTypeColumns}
                      rows={shiftTypeOrder.rows}
                      rowKey={(row) => row.id}
                      loading={shiftTypes.isLoading}
                      error={shiftTypes.error}
                      onRetry={() => void shiftTypes.refetch()}
                      empty={<EmptyState title={t('operations.catalogs.shiftType.empty')} />}
                      rowClassName={(row) =>
                        shiftTypeOrder.rowClassName(row) ??
                        (row.isActive ? undefined : 'opacity-60')
                      }
                      rowProps={(row) => (mayOrder ? shiftTypeOrder.rowProps(row) : undefined)}
                      embedded
                      stickyHead
                      minColumnWidth={6}
                    />
                  )}
                </div>
                {!failed && activeMeta !== undefined && activeMeta.totalItems > 0 && (
                  // The pager in the frame's foot — the numbered one the boards wear, with the
                  // page size beside it.
                  <div
                    className="shrink-0 border-t border-slate-200 px-4 dark:border-slate-800 [&>div]:!py-2.5"
                    data-catalog-pager="true"
                  >
                    <NumberedPager
                      meta={activeMeta}
                      pageSizeOptions={CATALOG_PAGE_SIZES}
                      onPageChange={goToPage}
                      onPageSizeChange={setPageSize}
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <BankDialog
        open={editingBank !== null || (creating && kind === 'banks')}
        bank={editingBank}
        onClose={() => {
          setEditingBank(null);
          setCreating(false);
        }}
      />
      <BankBranchDialog
        open={editingBranch !== null || (creating && kind === 'branches')}
        branch={editingBranch}
        banks={bankOptions.data?.items ?? []}
        areas={areaOptions.data?.items ?? []}
        onClose={() => {
          setEditingBranch(null);
          setCreating(false);
        }}
      />
      <CurrencyDialog
        open={editingCurrency !== null || (creating && kind === 'currencies')}
        currency={editingCurrency}
        onClose={() => {
          setEditingCurrency(null);
          setCreating(false);
        }}
      />
      <AreaDialog
        open={editingArea !== null || (creating && kind === 'areas')}
        area={editingArea}
        onClose={() => {
          setEditingArea(null);
          setCreating(false);
        }}
      />
      <ShiftTypeDialog
        open={editingShiftType !== null || (creating && kind === 'shiftTypes')}
        shiftType={editingShiftType}
        types={shiftTypes.data?.items ?? []}
        onClose={() => {
          setEditingShiftType(null);
          setCreating(false);
        }}
      />
    </PageContainer>
  );
};
