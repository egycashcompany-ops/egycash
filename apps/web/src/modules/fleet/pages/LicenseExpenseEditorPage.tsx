// «مصروفات التراخيص» — the memos, written and seen at once.
//
// «تكون مزيج بين شاشه المخالفات وانا بسجل المخالفات و شاشه الاخطارات وانا بملئ النموذج … وانا بملى
// اشوف ان بملى ايه»: the form sits beside the memo as it will print, the way the notices editor
// does, and the expenses are counted in like the drivers' fines — a counter for each item of the
// department's list, and one card per counted expense to name its amount, how it was paid and
// whether a receipt exists.
//
// «ممكن اعمل مد مده لوحده او تجديد ترخيص لوحده او الاتنين»: a renewal, an extension, or both —
// each in its own block with its own cars and expenses, and each its own memo on paper.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  type CreateFleetLicenseExpense,
  type FleetLicenseExpenseDto,
  type FleetLicenseExpensePartDto,
  type FleetLicenseExpenseSettingsDto,
  type Locale,
  type SaveFleetLicenseExpenseSettings,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import {
  licenseExpenseSettingsKey,
  useAllVehicles,
  useCreateLicenseExpense,
  useFleetCatalog,
  useLicenseExpense,
  useLicenseExpenseSettings,
  useSaveLicenseExpenseSettings,
  useUpdateLicenseExpense,
} from '../api/fleet-queries';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { BoardIcon, PATH } from '../components/FuelCardBoard';
import {
  type CatalogEntry,
  PaidGroup,
  catalogEntriesOf,
  newKey,
  today,
  useAddToCatalog,
} from '../components/LicenseExpensePaidGroup';
import {
  DEFAULT_SIGNATURES,
  type LicenseExpenseItemLine,
  type LicenseExpenseKind,
  type LicenseExpenseMemoDoc,
  type LicenseExpensePaidBy,
  type LicenseExpenseSignatures,
  memoHtml,
  memoTitle,
  money,
  printMemos,
  sumOf,
} from '../lib/license-expense-memo';

const KINDS: readonly LicenseExpenseKind[] = ['renewal', 'extension'];

/** One kind's half of the form, as it is being written. */
interface Draft {
  codes: string[];
  plates: Record<string, string>;
  manual: { key: string; plate: string }[];
  items: LicenseExpenseItemLine[];
}
const emptyDraft = (): Draft => ({ codes: [], plates: {}, manual: [], items: [] });

/** A saved half, back into the form: registry cars by code, hand-typed plates as they were. */
const draftOf = (part: FleetLicenseExpensePartDto | null): Draft => {
  if (part === null) return emptyDraft();
  const draft = emptyDraft();
  for (const v of part.vehicles) {
    if (v.code !== null && !draft.codes.includes(v.code)) {
      draft.codes.push(v.code);
      draft.plates[v.code] = v.plate;
    } else {
      draft.manual.push({ key: newKey(), plate: v.plate });
    }
  }
  draft.items = part.items.map((item) => ({ ...item, key: newKey() }));
  return draft;
};

/** One memo's block: its cars, then its expenses counted in and named card by card. */
const MemoBlock = ({
  kind,
  draft,
  setDraft,
  byCode,
  catalogItems,
  onAddToCatalog,
  templateOf,
  onSaveTemplate,
}: {
  kind: LicenseExpenseKind;
  draft: Draft;
  setDraft: (update: (held: Draft) => Draft) => void;
  byCode: ReadonlyMap<string, { id: string; plateNumber: string }>;
  catalogItems: readonly CatalogEntry[];
  /** «البيان … قائمة + نص حر»: a hand-written item kept for next time; absent without the grant. */
  onAddToCatalog?: (label: string) => Promise<string | null>;
  /** The saved template's lines for one group, ready to drop in. */
  templateOf: (paid: LicenseExpensePaidBy) => LicenseExpenseItemLine[];
  /** Keep a group's lines as its template; absent without the grant. */
  onSaveTemplate?: (paid: LicenseExpensePaidBy, items: LicenseExpenseItemLine[]) => void;
}): JSX.Element => {
  const t = useT();
  const items = draft.items;
  const visaTotal = sumOf(items.filter((item) => item.paidBy === 'visa'));
  const cashTotal = sumOf(items.filter((item) => item.paidBy === 'cash'));
  const subTitle = (text: string): JSX.Element => (
    <h3 className="mb-2 text-xs font-bold text-slate-500 dark:text-slate-400">{text}</h3>
  );

  return (
    <div
      data-license-expense-block={kind}
      className={cn(
        'space-y-5 rounded-xl border-2 p-3',
        kind === 'renewal'
          ? 'border-sky-500/40 bg-sky-500/[0.04]'
          : 'border-violet-500/40 bg-violet-500/[0.04]',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'rounded-full px-3 py-1 text-sm font-black',
            kind === 'renewal'
              ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
              : 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
          )}
        >
          {t(`fleet.licenseExpenses.kinds.${kind}`)}
        </span>
      </div>

      <div>
        {subTitle(t('fleet.licenseExpenses.carsSection'))}
        <VehicleCodeFilter
          fullWidth
          value={draft.codes}
          onChange={(codes) => setDraft((held) => ({ ...held, codes }))}
          placeholder={t('fleet.licenseExpenses.pickCars')}
        />
        {(draft.codes.length > 0 || draft.manual.length > 0) && (
          <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-[#0c121e]">
            {draft.codes.map((code, index) => (
              <li key={code} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-6 text-center font-mono text-slate-400">{index + 1}</span>
                <span className="w-16 font-bold text-slate-800 dark:text-slate-100">{code}</span>
                <Input
                  aria-label={t('fleet.licenseExpenses.plate')}
                  value={draft.plates[code] ?? byCode.get(code)?.plateNumber ?? ''}
                  onChange={(e) =>
                    setDraft((held) => ({
                      ...held,
                      plates: { ...held.plates, [code]: e.target.value },
                    }))
                  }
                />
              </li>
            ))}
            {draft.manual.map((row, index) => (
              <li key={row.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-6 text-center font-mono text-slate-400">
                  {draft.codes.length + index + 1}
                </span>
                <span className="w-16 text-xs text-slate-400">
                  {t('fleet.licenseExpenses.manualPlate')}
                </span>
                <Input
                  aria-label={t('fleet.licenseExpenses.plate')}
                  value={row.plate}
                  onChange={(e) =>
                    setDraft((held) => ({
                      ...held,
                      manual: held.manual.map((r) =>
                        r.key === row.key ? { ...r, plate: e.target.value } : r,
                      ),
                    }))
                  }
                />
                <button
                  type="button"
                  aria-label={t('common.delete')}
                  onClick={() =>
                    setDraft((held) => ({
                      ...held,
                      manual: held.manual.filter((r) => r.key !== row.key),
                    }))
                  }
                  className="rounded-md p-1 text-slate-400 hover:text-red-500"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() =>
            setDraft((held) => ({
              ...held,
              manual: [...held.manual, { key: newKey(), plate: '' }],
            }))
          }
          className="mt-2 text-xs font-bold text-brand-600 hover:underline dark:text-brand-300"
        >
          + {t('fleet.licenseExpenses.addManualPlate')}
        </button>
      </div>

      {/* «مش كل خانه اقول عليها فيزا ولا نقدى يبقى فيه تجميع»: the card's lines and the cash
          lines are two groups, each with its own counters — the group is how a line was paid. */}
      {(['visa', 'cash'] as const).map((paid) => (
        <PaidGroup
          key={paid}
          kind={kind}
          paid={paid}
          items={items.filter((item) => item.paidBy === paid)}
          setDraft={setDraft}
          catalogItems={catalogItems}
          template={templateOf(paid)}
          {...(onAddToCatalog === undefined ? {} : { onAddToCatalog })}
          {...(onSaveTemplate === undefined
            ? {}
            : { onSaveTemplate: (lines) => onSaveTemplate(paid, lines) })}
        />
      ))}

      <div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          {(
            [
              [t('fleet.licenseExpenses.totals.visa'), visaTotal],
              [t('fleet.licenseExpenses.totals.cash'), cashTotal],
              [t('fleet.licenseExpenses.totals.all'), visaTotal + cashTotal],
            ] as const
          ).map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-slate-200 bg-white px-2 py-2 dark:border-slate-800 dark:bg-[#0c121e]"
            >
              <span className="block text-slate-500 dark:text-slate-400">{label}</span>
              <span className="font-mono text-sm font-black text-slate-900 dark:text-white">
                {money(value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const LicenseExpenseEditorPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id: routeId = 'new' } = useParams();
  const editingId = routeId === 'new' ? '' : routeId;
  const saved = useLicenseExpense(editingId);
  const settings = useLicenseExpenseSettings();
  const create = useCreateLicenseExpense();
  const update = useUpdateLicenseExpense();
  const saveSettings = useSaveLicenseExpenseSettings();
  const addToCatalog = useAddToCatalog();
  const qc = useQueryClient();

  // «ممكن اعمل مد مده لوحده او تجديد ترخيص لوحده او الاتنين» — one, the other, or both.
  const [kinds, setKinds] = useState<LicenseExpenseKind[]>(['renewal']);
  const [date, setDate] = useState(today());
  const [drafts, setDrafts] = useState<Record<LicenseExpenseKind, Draft>>({
    renewal: emptyDraft(),
    extension: emptyDraft(),
  });
  const [signatures, setSignatures] = useState<LicenseExpenseSignatures>(DEFAULT_SIGNATURES);

  // A saved memo fills the form once; a new one starts from the set-up's signatures, until the
  // writer changes them.
  const loaded = useRef<FleetLicenseExpenseDto | null>(null);
  const signaturesTouched = useRef(false);
  useEffect(() => {
    const row = saved.data;
    if (row === undefined || loaded.current?.id === row.id) return;
    loaded.current = row;
    setKinds(KINDS.filter((kind) => row[kind] !== null));
    setDate(row.date);
    setDrafts({ renewal: draftOf(row.renewal), extension: draftOf(row.extension) });
    setSignatures(row.signatures);
  }, [saved.data]);
  useEffect(() => {
    if (editingId !== '' || signaturesTouched.current || settings.data === undefined) return;
    setSignatures(settings.data.signatures);
  }, [editingId, settings.data]);
  // «عاوز اعمل نموذج … 4 حالات»: a new memo's renewal or extension starts from its two saved
  // templates, once — a memo being edited keeps what it was saved with.
  const templateOf = (
    kind: LicenseExpenseKind,
    paid: LicenseExpensePaidBy,
  ): LicenseExpenseItemLine[] =>
    (settings.data?.templates[kind][paid] ?? []).map((line) => ({
      ...line,
      key: newKey(),
      paidBy: paid,
    }));
  const prefilled = useRef(new Set<LicenseExpenseKind>());
  useEffect(() => {
    if (editingId !== '' || settings.data === undefined) return;
    const fresh = kinds.filter((kind) => !prefilled.current.has(kind));
    if (fresh.length === 0) return;
    for (const kind of fresh) prefilled.current.add(kind);
    setDrafts((held) => {
      const next = { ...held };
      for (const kind of fresh) {
        if (held[kind].items.length > 0) continue;
        next[kind] = {
          ...held[kind],
          items: [...templateOf(kind, 'visa'), ...templateOf(kind, 'cash')],
        };
      }
      return next;
    });
    // `templateOf` reads `settings.data`, which is a dependency.
  }, [editingId, settings.data, kinds]);
  // ONE SET-UP WRITE AT A TIME, each reading the set-up when its turn comes — from the cache the
  // last save wrote into, not from the render it was clicked in. The signatures saved while a
  // template is still on its way would otherwise carry the version the template is about to
  // replace, and be refused as stale.
  const latestSettings = (): FleetLicenseExpenseSettingsDto | undefined =>
    qc.getQueryData<FleetLicenseExpenseSettingsDto>(licenseExpenseSettingsKey) ?? settings.data;
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  /** Resolves `false` when there was nothing to write; rejects with the server's refusal. */
  const writeSettings = (
    change: (
      held: FleetLicenseExpenseSettingsDto | undefined,
    ) => Omit<SaveFleetLicenseExpenseSettings, 'version'> | null,
  ): Promise<boolean> => {
    const run = writes.current.then(async () => {
      const held = latestSettings();
      const body = change(held);
      if (body === null) return false;
      await saveSettings.mutateAsync({
        ...body,
        ...(held?.version == null ? {} : { version: held.version }),
      });
      return true;
    });
    writes.current = run.catch(() => undefined);
    return run;
  };
  const onSaveTemplate = async (
    kind: LicenseExpenseKind,
    paid: LicenseExpensePaidBy,
    items: LicenseExpenseItemLine[],
  ): Promise<void> => {
    const lines = items.map((item) => ({
      itemId: item.itemId,
      label: item.label.trim(),
      amount: item.amount,
      count: item.count,
      receipt: item.receipt,
    }));
    try {
      const saved = await writeSettings((held) =>
        held === undefined
          ? null
          : {
              signatures: held.signatures,
              templates: { ...held.templates, [kind]: { ...held.templates[kind], [paid]: lines } },
            },
      );
      if (saved) toast.success(t('fleet.licenseExpenses.template.savedToast'));
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    }
  };
  const editSignatures = (patch: Partial<LicenseExpenseSignatures>): void => {
    signaturesTouched.current = true;
    setSignatures((held) => ({ ...held, ...patch }));
  };

  const registry = useAllVehicles({ anyStatus: true });
  const byCode = useMemo(
    () => new Map((registry.data?.items ?? []).map((v) => [v.code, v])),
    [registry.data],
  );
  const catalog = useFleetCatalog('licenseExpenseItem');
  const catalogItems = useMemo(
    () => catalogEntriesOf(catalog.data?.items ?? [], locale),
    [catalog.data, locale],
  );

  const toggleKind = (kind: LicenseExpenseKind): void =>
    setKinds((held) => {
      if (!held.includes(kind)) return KINDS.filter((k) => k === kind || held.includes(k));
      // At least one memo stays: the last one cannot be switched off.
      return held.length === 1 ? held : held.filter((k) => k !== kind);
    });

  const docs: LicenseExpenseMemoDoc[] = kinds.map((kind) => {
    const draft = drafts[kind];
    return {
      kind,
      date,
      signatures,
      vehicles: [
        ...draft.codes.map((code) => {
          const car = byCode.get(code);
          return {
            vehicleId: car?.id ?? null,
            code,
            plate: draft.plates[code] ?? car?.plateNumber ?? code,
          };
        }),
        ...draft.manual
          .filter((row) => row.plate.trim() !== '')
          .map((row) => ({ vehicleId: null, code: null, plate: row.plate.trim() })),
      ],
      items: draft.items,
    };
  });

  const body = (): CreateFleetLicenseExpense => {
    const partOf = (kind: LicenseExpenseKind) => {
      const doc = docs.find((d) => d.kind === kind);
      return doc === undefined
        ? null
        : {
            vehicles: doc.vehicles.map((v) => ({ vehicleId: v.vehicleId, plate: v.plate })),
            items: doc.items.map((item) => ({
              itemId: item.itemId,
              label: item.label.trim(),
              amount: item.amount,
              count: item.count,
              paidBy: item.paidBy,
              receipt: item.receipt,
            })),
          };
    };
    return {
      // An emptied date box writes today's, as a new memo starts with.
      date: new Date(date === '' ? today() : date),
      renewal: partOf('renewal'),
      extension: partOf('extension'),
      signatures,
    };
  };
  const pending = create.isPending || update.isPending;
  const onSave = async (): Promise<void> => {
    try {
      if (editingId === '') {
        await create.mutateAsync(body());
      } else {
        await update.mutateAsync({
          id: editingId,
          body: { ...body(), version: saved.data?.version ?? 0 },
        });
      }
      toast.success(t('fleet.licenseExpenses.savedToast'));
      navigate('/fleet/license-expenses');
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    }
  };
  const onSaveDefaults = async (): Promise<void> => {
    try {
      const saved = await writeSettings(() => ({ signatures }));
      if (saved) toast.success(t('fleet.licenseExpenses.defaultsSavedToast'));
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    }
  };
  const onPrint = (): void => {
    try {
      printMemos(docs);
    } catch {
      toast.error(t('fleet.vehicles.print.failed'));
    }
  };

  const sectionTitle = (text: string): JSX.Element => (
    <h2 className="mb-3 flex items-center gap-2 border-b border-brand-100 pb-1.5 text-sm font-bold text-brand-700 dark:border-brand-900 dark:text-brand-300">
      <span className="h-3.5 w-1 rounded-full bg-brand-500" />
      {text}
    </h2>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-license-expense-editor="true">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-[#111827]">
        <Link
          to="/fleet/license-expenses"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {t('fleet.licenseExpenses.back')}
        </Link>
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          {editingId === ''
            ? t('fleet.licenseExpenses.newTitle')
            : t('fleet.licenseExpenses.editTitle')}
        </h1>
        <span className="flex-1" />
        <button
          type="button"
          data-license-expense-save="true"
          disabled={pending || (editingId !== '' && saved.data === undefined)}
          onClick={() => void onSave()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/50 bg-brand-500/15 px-4 py-2 text-sm font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 dark:text-brand-200"
        >
          {t('fleet.licenseExpenses.save')}
        </button>
        <button
          type="button"
          data-license-expense-print="true"
          onClick={onPrint}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-700 to-brand-500 px-4 py-2 text-sm font-black text-white shadow-md shadow-brand-700/30 transition hover:from-brand-600 hover:to-brand-400 active:scale-95"
        >
          <BoardIcon d={PATH.pdf} className="h-4 w-4" />
          {t('fleet.licenseExpenses.print')}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
        <section className="min-h-0 space-y-6 overflow-auto rounded-xl border border-slate-200 bg-white p-4 lg:w-[46%] dark:border-slate-800 dark:bg-[#111827]">
          <div>
            {sectionTitle(t('fleet.licenseExpenses.memoSection'))}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('fleet.licenseExpenses.kind')}>
                {/* Either, or both — each pressed one is a memo below. */}
                <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-xs font-bold dark:border-slate-600">
                  {KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={kinds.includes(kind)}
                      data-license-expense-kind={kind}
                      onClick={() => toggleKind(kind)}
                      className={cn(
                        'px-3 py-1.5 transition',
                        kinds.includes(kind)
                          ? 'bg-brand-600 text-white'
                          : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
                      )}
                    >
                      {kinds.includes(kind) ? '✓ ' : ''}
                      {t(`fleet.licenseExpenses.kinds.${kind}`)}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={t('fleet.licenseExpenses.date')}>
                <Input
                  type="date"
                  dir="ltr"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
            </div>
            <ul className="mt-2 space-y-1">
              {docs.map((doc) => (
                <li
                  key={doc.kind}
                  className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
                >
                  {memoTitle(doc)}
                </li>
              ))}
            </ul>
          </div>

          {kinds.map((kind) => (
            <MemoBlock
              key={kind}
              kind={kind}
              draft={drafts[kind]}
              setDraft={(update) => setDrafts((held) => ({ ...held, [kind]: update(held[kind]) }))}
              byCode={byCode}
              catalogItems={catalogItems}
              {...(can('fleetCatalog.manage')
                ? { onAddToCatalog: (label: string) => addToCatalog(kind, label) }
                : {})}
              templateOf={(paid) => templateOf(kind, paid)}
              {...(can('fleetLicenseExpense.edit')
                ? {
                    onSaveTemplate: (paid: LicenseExpensePaidBy, items: LicenseExpenseItemLine[]) =>
                      void onSaveTemplate(kind, paid, items),
                  }
                : {})}
            />
          ))}

          <div>
            {sectionTitle(t('fleet.licenseExpenses.signaturesSection'))}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('fleet.licenseExpenses.signatures.agent')}>
                <Input
                  value={signatures.agent}
                  onChange={(e) => editSignatures({ agent: e.target.value })}
                />
              </Field>
              <Field label={t('fleet.licenseExpenses.signatures.director')}>
                <Input
                  value={signatures.director}
                  onChange={(e) => editSignatures({ director: e.target.value })}
                />
              </Field>
              <Field
                label={t('fleet.licenseExpenses.signatures.generalManager')}
                className="sm:col-span-2"
              >
                <Textarea
                  rows={3}
                  value={signatures.generalManager}
                  onChange={(e) => editSignatures({ generalManager: e.target.value })}
                />
              </Field>
            </div>
            {/* «تتظبط مرة في الإعداد وتتعدل في كل مذكرة»: these names become every new memo's. */}
            {can('fleetLicenseExpense.edit') && (
              <button
                type="button"
                data-license-expense-save-defaults="true"
                disabled={saveSettings.isPending}
                onClick={() => void onSaveDefaults()}
                className="mt-3 text-xs font-bold text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-300"
              >
                {t('fleet.licenseExpenses.saveDefaults')}
              </button>
            )}
          </div>
        </section>

        <section className="min-h-0 flex-1 space-y-4 overflow-auto rounded-xl bg-slate-200 p-4 dark:bg-slate-800">
          <p className="mx-auto max-w-[640px] text-sm text-slate-600 dark:text-slate-300">
            {t('fleet.licenseExpenses.preview')}
          </p>
          {/* Each memo as it prints — the same HTML the print window receives, one per page. */}
          {docs.map((doc) => (
            <div
              key={doc.kind}
              className="mx-auto w-[640px] max-w-full overflow-hidden rounded shadow-xl"
            >
              <div
                data-license-expense-preview={doc.kind}
                className="origin-top-right"
                style={{ zoom: 0.8, width: '210mm' }}
                dangerouslySetInnerHTML={{ __html: memoHtml(doc) }}
              />
            </div>
          ))}
        </section>
      </div>
    </div>
  );
};
