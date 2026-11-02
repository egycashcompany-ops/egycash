// «إعداد النماذج» of «مصروفات التراخيص» — what every new memo starts with.
//
// «بعمل منين نموذج دام فى مصروفات التراخيص … يعنى اقصد بحط فيه القيم الافتراضيه زى شاشه الاخطارات»:
// the notices' set-up, for the memo. The four templates — the renewal's and the extension's, each
// by the card and in cash — written with the memo's own counters and cards; the names every memo
// is signed with; and which memo each item of the list shows in. Beside them, the memo with those
// defaults on it, drawn by the very renderer the print uses.
//
// «عاوز اقدر اضيف بند فى اعدادات النماذج برضو»: the items' card takes a new item too — its name and
// where it shows — so the list grows from the page that decides what each memo offers.
//
// «ضيف كل حاجه كنا عملنها»: the memo editor's design — the forms' header with Save kept on screen,
// sections headed with their icons, the design's boxes and switches — around the same behaviour.
//
// «وعاوز احدد البند كمان هو صرفه بفيزا إدارة الحركة او صرفه نقدًا او كلاهما ف اعدادات النماذج او امسح
// بند انا ضيفته»: each item's row says where it shows AND how it is paid — «طريقة الصرف», the group of
// a memo that offers its counter — saved at once, the same field «قوائم الحركة» writes. An item
// somebody added has a bin for whoever manages the lists; a seeded one is «أساسي» and archives on
// «قوائم الحركة», as before (the boot would seed it again). A deleted item leaves the list, this
// page's rows and the held templates; saved memos keep their lines.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  FLEET_LICENSE_EXPENSE_KINDS,
  type CreateFleetCatalogItem,
  type FleetCatalogItemDto,
  type FleetLicenseExpenseSettingsDto,
  type FleetLicenseExpenseTemplateLine,
  type FleetLicenseExpenseTemplates,
  type Locale,
  type SaveFleetLicenseExpenseSettings,
  type UpdateFleetCatalogItem,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { Input, Textarea } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { toast } from '../../../shared/ui/toast/toast-store';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { ApiError } from '../../../shared/lib/api-client';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { fold } from '../../../shared/lib/fold';
import { localized } from '../../../shared/lib/format';
import {
  licenseExpenseSettingsKey,
  useCreateCatalogItem,
  useDeleteCatalogItem,
  useFleetCatalog,
  useLicenseExpenseSettings,
  useSaveLicenseExpenseSettings,
  useUpdateCatalogItem,
} from '../api/fleet-queries';
import {
  CARD_BOX,
  type CatalogEntry,
  DESIGN_BACK,
  DESIGN_COLUMN,
  DESIGN_HINT,
  DesignPageHeader,
  NOTE_BOX,
  PaidGroup,
  SWITCH_TRAY,
  newKey,
  offeredEntriesOf,
  switchOption,
  today,
  useAddToCatalog,
} from '../components/LicenseExpensePaidGroup';
import { DesignSave, DesignSection } from '../components/DesignDialog';
import { DesignField, LOOK, boxTone } from '../components/FuelCardDialog';
import { PATH } from '../components/FuelCardBoard';
import { FILTER_ICON } from '../components/FilterWithIcon';
import { actionTone } from '../components/row-actions-look';
import { Trash2Icon } from '../components/row-action-icons';
import { violationTypeColour } from '../lib/violation-type-colour';
import {
  type LicenseExpenseItemLine,
  type LicenseExpenseKind,
  type LicenseExpensePaidBy,
  type LicenseExpenseSignatures,
  memoHtml,
} from '../lib/license-expense-memo';

const PAID: readonly LicenseExpensePaidBy[] = ['visa', 'cash'];
/** «يظهر في»'s three buttons, in the order they read: the renewal, the extension, both (`null`). */
const SHOWS_IN: readonly (LicenseExpenseKind | null)[] = [...FLEET_LICENSE_EXPENSE_KINDS, null];
/** «طريقة الصرف»'s three buttons: by the card, in cash, both (`null`). */
const PAID_BY: readonly (LicenseExpensePaidBy | null)[] = [...PAID, null];
/** The design's text box, from the forms' `add` look. */
const BOX = boxTone(LOOK.add);

/**
 * The column is half the page, too narrow for a name and two trays on one line: each row is the
 * name (and its bin), then «يظهر في» and «طريقة الصرف» side by side, each named over its tray. The
 * trays' buttons a step tighter than the forms' switch, so both sit side by side at 1366 and wider;
 * a phone puts one under the other.
 */
const TIGHT = '!px-2';
const Choice = ({ label, children }: { label: string; children: ReactNode }): JSX.Element => (
  <div className="flex flex-col items-start gap-0.5">
    <span className="whitespace-nowrap px-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">
      {label}
    </span>
    <div role="group" aria-label={label} className={SWITCH_TRAY}>
      {children}
    </div>
  </div>
);

/** Each memo's template as the cards hold it: both groups together, each line knowing its group. */
export type SetupLines = Record<LicenseExpenseKind, { items: LicenseExpenseItemLine[] }>;

/** The saved templates, as cards — a line is paid the way the group it was saved in says. */
export const setupLinesOf = (templates: FleetLicenseExpenseTemplates): SetupLines => {
  const cards = (kind: LicenseExpenseKind): LicenseExpenseItemLine[] =>
    PAID.flatMap((paid) =>
      templates[kind][paid].map((line) => ({ ...line, key: newKey(), paidBy: paid })),
    );
  return { renewal: { items: cards('renewal') }, extension: { items: cards('extension') } };
};

const savedLine = (item: LicenseExpenseItemLine): FleetLicenseExpenseTemplateLine => ({
  itemId: item.itemId,
  label: item.label.trim(),
  amount: item.amount,
  count: item.count,
  receipt: item.receipt,
});

/** One memo's lines changed; the other memo's, written and not yet saved, stay as they are. */
export const withLines = (
  held: SetupLines,
  kind: LicenseExpenseKind,
  update: (lines: SetupLines[LicenseExpenseKind]) => SetupLines[LicenseExpenseKind],
): SetupLines => ({ ...held, [kind]: update(held[kind]) });

/**
 * «حفظ الإعداد» as ONE write: the names and all four templates together, with the version the
 * page was read at — the server refuses it as stale when the set-up moved on. Not before the first
 * save, though: with no version it writes over whatever is there, hence `savedElsewhere`.
 */
export const setupBody = (
  signatures: LicenseExpenseSignatures,
  lines: SetupLines,
  version: number | null,
): SaveFleetLicenseExpenseSettings => {
  const groups = (kind: LicenseExpenseKind): FleetLicenseExpenseTemplates[LicenseExpenseKind] => ({
    visa: lines[kind].items.filter((item) => item.paidBy === 'visa').map(savedLine),
    cash: lines[kind].items.filter((item) => item.paidBy === 'cash').map(savedLine),
  });
  return {
    signatures,
    templates: { renewal: groups('renewal'), extension: groups('extension') },
    ...(version === null ? {} : { version }),
  };
};

/**
 * Whether the set-up was saved somewhere else since the page read it — a «حفظ كنموذج» in another
 * tab, or another user — as realtime brings it into the cache. Checked before every save.
 */
export const savedElsewhere = (
  version: number | null,
  cached: FleetLicenseExpenseSettingsDto | undefined,
): boolean => cached !== undefined && cached.version !== version;

/**
 * What one «يظهر في» click writes to the item: the memo picked (`null` is both) and the version it
 * was read at — nothing at all when the item already says so.
 */
export const showsInBody = (
  item: Pick<FleetCatalogItemDto, 'licenseExpenseKind' | 'version'>,
  memo: LicenseExpenseKind | null,
): UpdateFleetCatalogItem | null =>
  (item.licenseExpenseKind ?? null) === memo
    ? null
    : { licenseExpenseKind: memo, version: item.version };

/**
 * What one «طريقة الصرف» click writes, as `showsInBody`: the payment picked (`null` is both) and
 * the version it was read at — nothing at all when the item already says so.
 */
export const paidByBody = (
  item: Pick<FleetCatalogItemDto, 'licenseExpensePaidBy' | 'version'>,
  paid: LicenseExpensePaidBy | null,
): UpdateFleetCatalogItem | null =>
  (item.licenseExpensePaidBy ?? null) === paid
    ? null
    : { licenseExpensePaidBy: paid, version: item.version };

/** The list as the page shows it: what this page just wrote stands until the list is read again. */
export const withWritten = (
  items: readonly FleetCatalogItemDto[],
  written: Readonly<Record<string, FleetCatalogItemDto>>,
): FleetCatalogItemDto[] =>
  items.map((item) => {
    const mine = written[item.id];
    return mine !== undefined && mine.version > item.version ? mine : item;
  });

/**
 * A name as the list compares it: case, the spaces around it and the runs of spaces inside it
 * ignored — «براءة  ذمة » typed beside «براءة ذمة» is the same item, not a second spelling of it.
 * Folded as every search box folds Arabic (`fold`: أ/إ/آ, ى, ة, the marks, either digits), and the
 * tatweel dropped: «براءه ذمه» is how it is typed, and the server only refuses the exact spelling.
 */
export const itemNameKey = (name: string): string =>
  fold(name.replace(/\u0640/gu, ''))
    .replace(/\s+/gu, ' ')
    .trim();

/**
 * The item already on the list under a typed name — in either language, and an archived one too,
 * since archiving keeps the name taken — or `undefined`.
 */
export const sameNamedItem = (
  items: readonly FleetCatalogItemDto[],
  name: string,
): FleetCatalogItemDto | undefined => {
  const key = itemNameKey(name);
  if (key === '') return undefined;
  return items.find(
    (item) => itemNameKey(item.name.ar) === key || itemNameKey(item.name.en) === key,
  );
};

/**
 * What «إضافة» writes: the typed name as both halves — as a part typed on a maintenance visit is,
 * the catalogs screen is where somebody translates it — the memo it shows in and how it is paid
 * (both, until another is pressed). `null` for an empty name: there is nothing to add.
 * `countsForAlarm` is said, not left to the default: only a work type counts for the alarm.
 */
export const newItemBody = (
  name: string,
  memo: LicenseExpenseKind | null,
  paid: LicenseExpensePaidBy | null = null,
): CreateFleetCatalogItem | null => {
  const typed = name.trim();
  return typed === ''
    ? null
    : {
        kind: 'licenseExpenseItem',
        name: { ar: typed, en: typed },
        countsForAlarm: false,
        licenseExpenseKind: memo,
        licenseExpensePaidBy: paid,
      };
};

/**
 * The list with what this page just added at its end, until the list is read again with it — so a
 * new item has its row and its counters at once, not after the refetch.
 */
export const withCreated = (
  items: readonly FleetCatalogItemDto[],
  created: readonly FleetCatalogItemDto[],
): FleetCatalogItemDto[] => [
  ...items,
  ...created.filter((mine) => !items.some((item) => item.id === mine.id)),
];

/**
 * The list without what this page just deleted, until the list is read again without it — so the
 * row goes at once, and its bin cannot be pressed a second time while the list is re-read.
 */
export const withoutDeleted = (
  items: readonly FleetCatalogItemDto[],
  deleted: ReadonlySet<string>,
): FleetCatalogItemDto[] => items.filter((item) => !deleted.has(item.id));

/**
 * The held templates without a deleted item's lines — the server already reads the set-up without
 * them, and «حفظ الإعداد» must not write them back.
 */
export const linesWithout = (lines: SetupLines, itemId: string): SetupLines => ({
  renewal: { items: lines.renewal.items.filter((line) => line.itemId !== itemId) },
  extension: { items: lines.extension.items.filter((line) => line.itemId !== itemId) },
});

/** The templates an item is written in, as `[memo, paid]` pairs in the cards' order. */
export const templatesWith = (
  lines: SetupLines,
  itemId: string,
): [LicenseExpenseKind, LicenseExpensePaidBy][] =>
  FLEET_LICENSE_EXPENSE_KINDS.flatMap((memo) =>
    PAID.filter((paid) =>
      lines[memo].items.some((line) => line.itemId === itemId && line.paidBy === paid),
    ).map((paid): [LicenseExpenseKind, LicenseExpensePaidBy] => [memo, paid]),
  );

/**
 * The counters a template offers: the active items — an archived one only while the template
 * still counts it, so it can be counted out. The memo editor offers by the same rule.
 */
export const setupEntriesOf = (
  items: readonly FleetCatalogItemDto[],
  lines: readonly LicenseExpenseItemLine[],
  locale: Locale,
): CatalogEntry[] => offeredEntriesOf(items, lines, locale);

export const LicenseExpenseSetupPage = (): JSX.Element => {
  const settings = useLicenseExpenseSettings();
  // Bumped when a save finds the set-up saved elsewhere: the body starts again from the cache,
  // on the memo it was on.
  const [reread, setReread] = useState({ round: 0, kind: 'renewal' as LicenseExpenseKind });
  // A cached copy may be old: the page waits for the read its opening starts, so its boxes never
  // start from — nor save over — a set-up that has moved on.
  if (settings.data !== undefined && (settings.isFetchedAfterMount || !settings.isStale)) {
    return (
      <LicenseExpenseSetup
        key={reread.round}
        saved={settings.data}
        startKind={reread.kind}
        onReread={(kind) => setReread((held) => ({ round: held.round + 1, kind }))}
      />
    );
  }
  return settings.isError ? (
    <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
  ) : (
    <LoadingState />
  );
};

/** Mounted once the set-up is read, so every box starts from it — on the first render. */
const LicenseExpenseSetup = ({
  saved,
  startKind,
  onReread,
}: {
  saved: FleetLicenseExpenseSettingsDto;
  startKind: LicenseExpenseKind;
  onReread: (kind: LicenseExpenseKind) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const save = useSaveLicenseExpenseSettings();
  const updateItem = useUpdateCatalogItem();
  const createItem = useCreateCatalogItem();
  const removeItem = useDeleteCatalogItem();
  const addToCatalog = useAddToCatalog();
  const mayManageList = can('fleetCatalog.manage');

  const [kind, setKind] = useState<LicenseExpenseKind>(startKind);
  // BOTH memos' templates held at once: switching to the other memo and back keeps what was
  // written and not yet saved.
  const [lines, setLines] = useState<SetupLines>(() => setupLinesOf(saved.templates));
  // What the server sends — its department defaults until the set-up is first saved — as a new
  // memo starts from it.
  const [signatures, setSignatures] = useState<LicenseExpenseSignatures>(() => saved.signatures);
  const [version, setVersion] = useState(saved.version);

  // «يظهر في», from «قوائم الحركة» — «من الاتنين»: the same field the item form writes, so a
  // choice made here is the list's, and the list's shows here. What was just written stands until
  // the list is read again, so the counters follow at once and a second click carries the version
  // the first one left.
  const catalog = useFleetCatalog('licenseExpenseItem');
  const [written, setWritten] = useState<Readonly<Record<string, FleetCatalogItemDto>>>({});
  const [writing, setWriting] = useState<ReadonlySet<string>>(new Set());
  const [created, setCreated] = useState<readonly FleetCatalogItemDto[]>([]);
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(new Set());
  const items = useMemo(
    () =>
      withoutDeleted(
        withWritten(withCreated(catalog.data?.items ?? [], created), written),
        deleted,
      ),
    [catalog.data, created, written, deleted],
  );
  const catalogItems = useMemo(
    () => setupEntriesOf(items, lines[kind].items, locale),
    [items, lines, kind, locale],
  );
  /** «يظهر في» or «طريقة الصرف» — one click, one write, the toast either way. */
  const writeItem = async (
    item: FleetCatalogItemDto,
    body: UpdateFleetCatalogItem | null,
  ): Promise<void> => {
    if (body === null) return;
    setWriting((held) => new Set([...held, item.id]));
    try {
      const updated = await updateItem.mutateAsync({ id: item.id, body });
      setWritten((held) => ({ ...held, [updated.id]: updated }));
      toast.success(t('fleet.licenseExpenses.setup.itemSavedToast'));
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    } finally {
      setWriting((held) => new Set([...held].filter((id) => id !== item.id)));
    }
  };

  // «عاوز اقدر اضيف بند»: the new item's name and where it shows — both, as on «قوائم الحركة»,
  // until another is pressed. A name already on the list marks that item's row instead.
  const [newName, setNewName] = useState('');
  const [newMemo, setNewMemo] = useState<LicenseExpenseKind | null>(null);
  const [newPaid, setNewPaid] = useState<LicenseExpensePaidBy | null>(null);
  const [found, setFound] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  // Held across renders: a second Enter before the first add returns adds nothing twice.
  const adding = useRef(false);
  const addItem = async (): Promise<void> => {
    if (adding.current) return;
    const body = newItemBody(newName, newMemo, newPaid);
    if (body === null) {
      toast.warning(t('fleet.licenseExpenses.setup.newItemEmpty'));
      return;
    }
    // NEVER A SECOND SPELLING: «براءة ذمة» beside «براءة  ذمة » would split every memo that counts
    // it. The one already there is shown — its own row says where it shows — and nothing is made.
    const existing = sameNamedItem(items, body.name.ar);
    if (existing !== undefined) {
      const name = localized(existing.name, locale);
      if (existing.isActive) {
        setFound(existing.id);
        rows.current.get(existing.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        toast.warning(t('fleet.licenseExpenses.setup.newItemExistsToast', { name }));
      } else {
        toast.warning(t('fleet.licenseExpenses.setup.newItemArchivedToast', { name }));
      }
      return;
    }
    adding.current = true;
    try {
      const item = await createItem.mutateAsync(body);
      setCreated((held) => [...held, item]);
      setNewName('');
      setFound(null);
      toast.success(
        t('fleet.licenseExpenses.setup.newItemAddedToast', { name: localized(item.name, locale) }),
      );
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    } finally {
      adding.current = false;
    }
  };
  const showsInLabel = (memo: LicenseExpenseKind | null): string =>
    memo === null
      ? t('fleet.catalogs.licenseExpenseKind.both')
      : t(`fleet.licenseExpenses.kinds.${memo}`);
  const paidByLabel = (paid: LicenseExpensePaidBy | null): string =>
    paid === null
      ? t('fleet.catalogs.licenseExpenseKind.both')
      : t(`fleet.licenseExpenses.paidBy.${paid}`);

  // «او امسح بند انا ضيفته»: the item somebody added, gone from the list (a soft delete; the audit
  // keeps it). Its row leaves at once, and its lines leave the held templates.
  const [deleting, setDeleting] = useState<FleetCatalogItemDto | null>(null);
  /** The templates the item is written in, as their cards name them: «نموذج تجديد تراخيص — نقدي». */
  const templateNames = (id: string): string[] =>
    templatesWith(lines, id).map(
      ([memo, paid]) =>
        `${t('fleet.licenseExpenses.setup.templateTitle', {
          kind: t(`fleet.licenseExpenses.kinds.${memo}`),
        })} — ${t(`fleet.licenseExpenses.paidBy.${paid}`)}`,
    );
  const deletingTemplates = deleting === null ? [] : templateNames(deleting.id);
  const confirmDelete = async (): Promise<void> => {
    if (deleting === null || removeItem.isPending) return;
    const gone = deleting;
    try {
      await removeItem.mutateAsync(gone.id);
      setDeleted((held) => new Set([...held, gone.id]));
      // Else `withCreated` would bring back the row of an item added on this very page.
      setCreated((held) => held.filter((item) => item.id !== gone.id));
      setLines((held) => linesWithout(held, gone.id));
      if (found === gone.id) setFound(null);
      setDeleting(null);
      toast.success(
        t('fleet.licenseExpenses.setup.itemDeletedToast', { name: localized(gone.name, locale) }),
      );
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    }
  };

  /** Saved elsewhere meanwhile: overwrite nothing — show theirs, read afresh. */
  const rereadSaved = async (): Promise<void> => {
    toast.warning(t('fleet.licenseExpenses.setup.staleToast'));
    await qc.refetchQueries({ queryKey: licenseExpenseSettingsKey, exact: true });
    onReread(kind);
  };
  const onSave = async (): Promise<void> => {
    const cached = qc.getQueryData<FleetLicenseExpenseSettingsDto>(licenseExpenseSettingsKey);
    if (savedElsewhere(version, cached)) {
      await rereadSaved();
      return;
    }
    try {
      // The hook writes the saved set-up into the cache: a memo opened next starts from it.
      const result = await save.mutateAsync(setupBody(signatures, lines, version));
      setVersion(result.version);
      toast.success(t('fleet.licenseExpenses.setup.savedToast'));
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'STALE_DOCUMENT') await rereadSaved();
      else toast.error(errorMessage(failure, locale));
    }
  };

  const kindName = t(`fleet.licenseExpenses.kinds.${kind}`);
  // The memo a new one would start as: today, no cars yet, this template's lines and these names.
  const preview = memoHtml({
    kind,
    date: today(),
    vehicles: [],
    items: lines[kind].items,
    signatures,
  });

  const hint = (text: string): JSX.Element => <p className={DESIGN_HINT}>{text}</p>;

  return (
    <div className="flex h-full min-h-0 flex-col" data-license-expense-setup-page="true">
      <DesignPageHeader
        icon={PATH.box}
        title={t('fleet.licenseExpenses.setup.title')}
        subtitle={t('fleet.licenseExpenses.setup.subtitle')}
      >
        <Link to="/fleet/license-expenses" className={DESIGN_BACK}>
          {t('fleet.licenseExpenses.setup.back')}
        </Link>
        {/* Which memo's template is on the form — the one pressed, in the site's purple. */}
        <div className={SWITCH_TRAY}>
          {FLEET_LICENSE_EXPENSE_KINDS.map((other) => (
            <button
              key={other}
              type="button"
              aria-pressed={other === kind}
              data-license-expense-setup-kind={other}
              onClick={() => setKind(other)}
              className={switchOption(other === kind)}
            >
              {t(`fleet.licenseExpenses.kinds.${other}`)}
            </button>
          ))}
        </div>
        <DesignSave
          onClick={() => void onSave()}
          busy={save.isPending}
          label={t('fleet.licenseExpenses.setup.save')}
          data-license-expense-setup-save="true"
        />
      </DesignPageHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
        <section className={DESIGN_COLUMN}>
          {/* First, because it decides which counters the groups below offer. */}
          <div data-license-expense-setup-items="true">
            <DesignSection
              title={t('fleet.licenseExpenses.setup.itemsTitlePaidBy')}
              icon={PATH.box}
            >
              {hint(t('fleet.licenseExpenses.setup.itemsHintPaidBy'))}
              {mayManageList && hint(t('fleet.licenseExpenses.setup.itemsDeleteHint'))}
              {!mayManageList && (
                <p className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">
                  {t('fleet.licenseExpenses.setup.itemsLocked')}
                </p>
              )}
              {catalog.data === undefined ? null : items.every((item) => !item.isActive) ? (
                <p className={DESIGN_HINT}>{t('fleet.licenseExpenses.setup.itemsEmpty')}</p>
              ) : (
                <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-slate-50 dark:divide-[#2b3b6b] dark:border-[#2b3b6b] dark:bg-[#0a1233]/80">
                  {items.map((item, index) =>
                    item.isActive ? (
                      <li
                        key={item.id}
                        ref={(node) => {
                          if (node === null) rows.current.delete(item.id);
                          else rows.current.set(item.id, node);
                        }}
                        data-license-expense-item-row={item.id}
                        // Two lines: the name (and the bin), then its two choices. The item a new
                        // name turned out to be is marked until the name changes.
                        className={cn(
                          'space-y-2 px-3 py-2.5 transition-colors',
                          found === item.id &&
                            'bg-amber-500/10 ring-2 ring-inset ring-amber-400/70 first:rounded-t-xl last:rounded-b-xl',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span
                              className={cn(
                                'rounded-md border px-2 py-0.5 text-sm font-bold',
                                violationTypeColour(item.id, { index }),
                              )}
                            >
                              {localized(item.name, locale)}
                            </span>
                            {/* A seeded item: no bin — it archives on «قوائم الحركة». */}
                            {item.builtIn && (
                              <span
                                data-license-expense-item-builtin={item.id}
                                title={t('fleet.licenseExpenses.setup.builtInHint')}
                                className="rounded-full border border-slate-300 bg-white px-2 py-px text-[11px] font-bold text-slate-500 dark:border-slate-600 dark:bg-transparent dark:text-slate-400"
                              >
                                {t('fleet.licenseExpenses.setup.builtInTag')}
                              </span>
                            )}
                          </span>
                          {/* The bin: only on a row somebody added, only for whoever manages the
                              lists (the server refuses everyone else, and every seeded item). */}
                          {mayManageList && !item.builtIn && (
                            <button
                              type="button"
                              data-license-expense-item-delete={item.id}
                              aria-label={`${t('fleet.licenseExpenses.setup.deleteItem')} — ${localized(item.name, locale)}`}
                              title={t('fleet.licenseExpenses.setup.deleteItem')}
                              disabled={writing.has(item.id)}
                              onClick={() => setDeleting(item)}
                              className={actionTone('delete')}
                            >
                              <Trash2Icon className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                          <Choice label={t('fleet.catalogs.fields.licenseExpenseKind')}>
                            {SHOWS_IN.map((memo) => {
                              const picked = (item.licenseExpenseKind ?? null) === memo;
                              return (
                                <button
                                  key={memo ?? 'both'}
                                  type="button"
                                  aria-pressed={picked}
                                  data-license-expense-item-kind={`${item.id}:${memo ?? 'both'}`}
                                  disabled={!mayManageList || writing.has(item.id)}
                                  onClick={() => void writeItem(item, showsInBody(item, memo))}
                                  className={cn(switchOption(picked), TIGHT)}
                                >
                                  {showsInLabel(memo)}
                                </button>
                              );
                            })}
                          </Choice>
                          {/* «طريقة الصرف»: which group of a memo offers its counter. */}
                          <Choice label={t('fleet.catalogs.fields.licenseExpensePaidBy')}>
                            {PAID_BY.map((paid) => {
                              const picked = (item.licenseExpensePaidBy ?? null) === paid;
                              return (
                                <button
                                  key={paid ?? 'both'}
                                  type="button"
                                  aria-pressed={picked}
                                  data-license-expense-item-paid={`${item.id}:${paid ?? 'both'}`}
                                  disabled={!mayManageList || writing.has(item.id)}
                                  onClick={() => void writeItem(item, paidByBody(item, paid))}
                                  className={cn(switchOption(picked), TIGHT)}
                                >
                                  {paidByLabel(paid)}
                                </button>
                              );
                            })}
                          </Choice>
                        </div>
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
              {/* «عاوز اقدر اضيف بند فى اعدادات النماذج»: at the card's end, for whoever manages the
                  lists — the note above tells everyone else who does. Once the list is read, so a
                  name already on it is known. Laid out as a row: the name and «إضافة», then the
                  same two choices (both, until another is pressed). */}
              {mayManageList && catalog.data !== undefined && (
                <div
                  data-license-expense-new-item="true"
                  className="space-y-2 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2.5 dark:border-[#2b3b6b] dark:bg-[#0f1838]/40"
                >
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <Input
                        data-license-expense-new-item-name="true"
                        aria-label={t('fleet.licenseExpenses.setup.newItem')}
                        placeholder={t('fleet.licenseExpenses.setup.newItem')}
                        value={newName}
                        onChange={(e) => {
                          setNewName(e.target.value);
                          setFound(null);
                        }}
                        // Enter adds, as Enter adds a part on a maintenance visit.
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                          e.preventDefault();
                          void addItem();
                        }}
                        density="tight"
                        tone={CARD_BOX}
                      />
                    </div>
                    {/* The look of «+ إضافة للقائمة» on a memo's hand-written line — the same act. */}
                    <button
                      type="button"
                      data-license-expense-new-item-add="true"
                      aria-busy={createItem.isPending}
                      disabled={createItem.isPending}
                      onClick={() => void addItem()}
                      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-brand-500/50 bg-brand-500/10 px-3 py-1.5 text-xs font-bold text-brand-700 transition hover:bg-brand-500/20 active:scale-[0.98] disabled:opacity-50 dark:text-brand-200"
                    >
                      {createItem.isPending ? <Spinner className="h-3.5 w-3.5" /> : <span>+</span>}
                      {t('fleet.licenseExpenses.setup.newItemAdd')}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                    <Choice label={t('fleet.licenseExpenses.setup.newItemShowsIn')}>
                      {SHOWS_IN.map((memo) => (
                        <button
                          key={memo ?? 'both'}
                          type="button"
                          aria-pressed={newMemo === memo}
                          data-license-expense-new-item-kind={memo ?? 'both'}
                          onClick={() => setNewMemo(memo)}
                          className={cn(switchOption(newMemo === memo), TIGHT)}
                        >
                          {showsInLabel(memo)}
                        </button>
                      ))}
                    </Choice>
                    <Choice label={t('fleet.catalogs.fields.licenseExpensePaidBy')}>
                      {PAID_BY.map((paid) => (
                        <button
                          key={paid ?? 'both'}
                          type="button"
                          aria-pressed={newPaid === paid}
                          data-license-expense-new-item-paid={paid ?? 'both'}
                          onClick={() => setNewPaid(paid)}
                          className={cn(switchOption(newPaid === paid), TIGHT)}
                        >
                          {paidByLabel(paid)}
                        </button>
                      ))}
                    </Choice>
                  </div>
                </div>
              )}
            </DesignSection>
          </div>

          {/* «عاوز اعمل نموذج … 4 حالات»: the picked memo's two, by the card and in cash — in the
              memo's own tint, as its block on the memo editor. */}
          <div data-license-expense-setup-template={kind}>
            <DesignSection
              title={t('fleet.licenseExpenses.setup.templateTitle', { kind: kindName })}
              icon={PATH.card}
            >
              {hint(t('fleet.licenseExpenses.setup.templateHint', { kind: kindName }))}
              <div
                className={cn(
                  'space-y-4 rounded-2xl border-2 p-3',
                  kind === 'renewal'
                    ? 'border-sky-500/40 bg-sky-500/[0.04]'
                    : 'border-violet-500/40 bg-violet-500/[0.04]',
                )}
              >
                {PAID.map((paid) => (
                  <PaidGroup
                    key={`${kind}:${paid}`}
                    kind={kind}
                    paid={paid}
                    items={lines[kind].items.filter((item) => item.paidBy === paid)}
                    setDraft={(update) => setLines((held) => withLines(held, kind, update))}
                    catalogItems={catalogItems}
                    {...(mayManageList
                      ? { onAddToCatalog: (label: string) => addToCatalog(kind, label) }
                      : {})}
                  />
                ))}
              </div>
            </DesignSection>
          </div>

          <DesignSection
            title={t('fleet.licenseExpenses.signaturesSection')}
            icon={FILTER_ICON.person}
          >
            {/* «تتظبط مرة في الإعداد وتتعدل في كل مذكرة». */}
            {hint(t('fleet.licenseExpenses.setup.signaturesHint'))}
            <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2">
              <DesignField label={t('fleet.licenseExpenses.signatures.agent')}>
                <Input
                  aria-label={t('fleet.licenseExpenses.signatures.agent')}
                  value={signatures.agent}
                  onChange={(e) => setSignatures((held) => ({ ...held, agent: e.target.value }))}
                  tone={BOX}
                />
              </DesignField>
              <DesignField label={t('fleet.licenseExpenses.signatures.director')}>
                <Input
                  aria-label={t('fleet.licenseExpenses.signatures.director')}
                  value={signatures.director}
                  onChange={(e) => setSignatures((held) => ({ ...held, director: e.target.value }))}
                  tone={BOX}
                />
              </DesignField>
              <div className="sm:col-span-2">
                <DesignField label={t('fleet.licenseExpenses.signatures.generalManager')}>
                  <Textarea
                    rows={3}
                    aria-label={t('fleet.licenseExpenses.signatures.generalManager')}
                    value={signatures.generalManager}
                    onChange={(e) =>
                      setSignatures((held) => ({ ...held, generalManager: e.target.value }))
                    }
                    className={NOTE_BOX}
                  />
                </DesignField>
              </div>
            </div>
          </DesignSection>
        </section>

        <section className="min-h-0 flex-1 space-y-4 overflow-auto rounded-xl bg-slate-200 p-4 dark:bg-slate-800">
          <p className="mx-auto max-w-[640px] text-sm text-slate-600 dark:text-slate-300">
            {t('fleet.licenseExpenses.setup.preview')}
          </p>
          {/* The same HTML the print window receives, drawn as the memo editor draws it. */}
          <div className="mx-auto w-[640px] max-w-full overflow-hidden rounded shadow-xl">
            <div
              data-license-expense-setup-preview={kind}
              className="origin-top-right"
              style={{ zoom: 0.8, width: '210mm' }}
              dangerouslySetInnerHTML={{ __html: preview }}
            />
          </div>
        </section>
      </div>

      {/* The confirm, in the pattern of «حذف هذه المذكرة؟»: what goes, and the templates it leaves. */}
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.licenseExpenses.setup.deleteItemTitle', {
          name: deleting === null ? '' : localized(deleting.name, locale),
        })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={removeItem.isPending}
              data-license-expense-item-delete-confirm="true"
              onClick={() => void confirmDelete()}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.licenseExpenses.setup.deleteItemBody')}
        </p>
        {deletingTemplates.length > 0 && (
          <p
            data-license-expense-item-delete-templates="true"
            className="mt-2 text-sm text-slate-600 dark:text-slate-300"
          >
            {t('fleet.licenseExpenses.setup.deleteItemTemplates', {
              templates: deletingTemplates.join(locale === 'ar' ? '، ' : ', '),
            })}
          </p>
        )}
      </Dialog>
    </div>
  );
};
