// «إعداد النماذج» of «مصروفات التراخيص» — what every new memo starts with.
//
// «بعمل منين نموذج دام فى مصروفات التراخيص … يعنى اقصد بحط فيه القيم الافتراضيه زى شاشه الاخطارات»:
// the notices' set-up, for the memo. The four templates — the renewal's and the extension's, each
// by the card and in cash — written with the memo's own counters and cards; the names every memo
// is signed with; and which memo each item of the list shows in. Beside them, the memo with those
// defaults on it, drawn by the very renderer the print uses.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  FLEET_LICENSE_EXPENSE_KINDS,
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
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { ApiError } from '../../../shared/lib/api-client';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { localized } from '../../../shared/lib/format';
import {
  licenseExpenseSettingsKey,
  useFleetCatalog,
  useLicenseExpenseSettings,
  useSaveLicenseExpenseSettings,
  useUpdateCatalogItem,
} from '../api/fleet-queries';
import {
  type CatalogEntry,
  PaidGroup,
  catalogEntriesOf,
  newKey,
  today,
  useAddToCatalog,
} from '../components/LicenseExpensePaidGroup';
import { violationTypeColour } from '../lib/violation-type-colour';
import {
  type LicenseExpenseItemLine,
  type LicenseExpenseKind,
  type LicenseExpensePaidBy,
  type LicenseExpenseSignatures,
  memoHtml,
} from '../lib/license-expense-memo';

const PAID: readonly LicenseExpensePaidBy[] = ['visa', 'cash'];

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
 * The counters a template offers: the active items — an archived one only while the template
 * still counts it, so it can be counted out. Filtered after mapping, so each keeps its colour.
 */
export const setupEntriesOf = (
  items: readonly FleetCatalogItemDto[],
  lines: readonly LicenseExpenseItemLine[],
  locale: Locale,
): CatalogEntry[] =>
  catalogEntriesOf(items, locale).filter(
    (entry, i) => items[i]!.isActive || lines.some((line) => line.itemId === entry.id),
  );

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
  const items = useMemo(
    () => withWritten(catalog.data?.items ?? [], written),
    [catalog.data, written],
  );
  const catalogItems = useMemo(
    () => setupEntriesOf(items, lines[kind].items, locale),
    [items, lines, kind, locale],
  );
  const showsIn = async (
    item: FleetCatalogItemDto,
    memo: LicenseExpenseKind | null,
  ): Promise<void> => {
    const body = showsInBody(item, memo);
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

  const sectionTitle = (text: string): JSX.Element => (
    <h2 className="mb-2 flex items-center gap-2 border-b border-brand-100 pb-1.5 text-sm font-bold text-brand-700 dark:border-brand-900 dark:text-brand-300">
      <span className="h-3.5 w-1 rounded-full bg-brand-500" />
      {text}
    </h2>
  );
  const hint = (text: string): JSX.Element => (
    <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{text}</p>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-license-expense-setup-page="true">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-[#111827]">
        <Link
          to="/fleet/license-expenses"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {t('fleet.licenseExpenses.setup.back')}
        </Link>
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          {t('fleet.licenseExpenses.setup.title')}
        </h1>
        <span className="flex-1" />
        {FLEET_LICENSE_EXPENSE_KINDS.map((other) => (
          <button
            key={other}
            type="button"
            aria-pressed={other === kind}
            data-license-expense-setup-kind={other}
            onClick={() => setKind(other)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-bold transition',
              other === kind
                ? 'border-brand-500 bg-brand-500/15 text-brand-700 dark:text-brand-200'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            {t(`fleet.licenseExpenses.kinds.${other}`)}
          </button>
        ))}
        <Button
          onClick={() => void onSave()}
          loading={save.isPending}
          data-license-expense-setup-save="true"
        >
          {t('fleet.licenseExpenses.setup.save')}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
        <section className="min-h-0 space-y-6 overflow-auto rounded-xl border border-slate-200 bg-white p-4 lg:w-[46%] dark:border-slate-800 dark:bg-[#111827]">
          {/* First, because it decides which counters the groups below offer. */}
          <div data-license-expense-setup-items="true">
            {sectionTitle(t('fleet.licenseExpenses.setup.itemsTitle'))}
            {hint(t('fleet.licenseExpenses.setup.itemsHint'))}
            {!mayManageList && (
              <p className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                {t('fleet.licenseExpenses.setup.itemsLocked')}
              </p>
            )}
            {catalog.data === undefined ? null : items.every((item) => !item.isActive) ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('fleet.licenseExpenses.setup.itemsEmpty')}
              </p>
            ) : (
              <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {items.map((item, index) =>
                  item.isActive ? (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                    >
                      <span
                        className={cn(
                          'rounded-md border px-2 py-0.5 text-xs font-bold',
                          violationTypeColour(item.id, { index }),
                        )}
                      >
                        {localized(item.name, locale)}
                      </span>
                      <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-xs font-bold dark:border-slate-600">
                        {[...FLEET_LICENSE_EXPENSE_KINDS, null].map((memo) => {
                          const picked = (item.licenseExpenseKind ?? null) === memo;
                          return (
                            <button
                              key={memo ?? 'both'}
                              type="button"
                              aria-pressed={picked}
                              data-license-expense-item-kind={`${item.id}:${memo ?? 'both'}`}
                              disabled={!mayManageList || writing.has(item.id)}
                              onClick={() => void showsIn(item, memo)}
                              className={cn(
                                'px-3 py-1.5 transition disabled:cursor-not-allowed',
                                picked
                                  ? 'bg-brand-600 text-white'
                                  : 'bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-60 disabled:hover:bg-white dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:disabled:hover:bg-slate-900',
                              )}
                            >
                              {memo === null
                                ? t('fleet.catalogs.licenseExpenseKind.both')
                                : t(`fleet.licenseExpenses.kinds.${memo}`)}
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  ) : null,
                )}
              </ul>
            )}
          </div>

          {/* «عاوز اعمل نموذج … 4 حالات»: the picked memo's two, by the card and in cash. */}
          <div
            data-license-expense-setup-template={kind}
            className={cn(
              'space-y-4 rounded-xl border-2 p-3',
              kind === 'renewal'
                ? 'border-sky-500/40 bg-sky-500/[0.04]'
                : 'border-violet-500/40 bg-violet-500/[0.04]',
            )}
          >
            <div>
              <span
                className={cn(
                  'rounded-full px-3 py-1 text-sm font-black',
                  kind === 'renewal'
                    ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                    : 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
                )}
              >
                {t('fleet.licenseExpenses.setup.templateTitle', { kind: kindName })}
              </span>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {t('fleet.licenseExpenses.setup.templateHint', { kind: kindName })}
              </p>
            </div>
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

          <div>
            {sectionTitle(t('fleet.licenseExpenses.signaturesSection'))}
            {/* «تتظبط مرة في الإعداد وتتعدل في كل مذكرة». */}
            {hint(t('fleet.licenseExpenses.setup.signaturesHint'))}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('fleet.licenseExpenses.signatures.agent')}>
                <Input
                  value={signatures.agent}
                  onChange={(e) => setSignatures((held) => ({ ...held, agent: e.target.value }))}
                />
              </Field>
              <Field label={t('fleet.licenseExpenses.signatures.director')}>
                <Input
                  value={signatures.director}
                  onChange={(e) => setSignatures((held) => ({ ...held, director: e.target.value }))}
                />
              </Field>
              <Field
                label={t('fleet.licenseExpenses.signatures.generalManager')}
                className="sm:col-span-2"
              >
                <Textarea
                  rows={3}
                  value={signatures.generalManager}
                  onChange={(e) =>
                    setSignatures((held) => ({ ...held, generalManager: e.target.value }))
                  }
                />
              </Field>
            </div>
          </div>
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
    </div>
  );
};
