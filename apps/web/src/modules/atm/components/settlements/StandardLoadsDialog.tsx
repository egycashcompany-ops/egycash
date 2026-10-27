// «الحمولات القياسية» (S-3, DS-8, §9.5): the named count profiles of the bank in the work branch —
// a count per denomination, a total (computed, never typed), an optional name and one default.
// A machine's line fills from its layout's profile, else from the default. A line keeps the counts
// it was filled with (`standardNotes`), so changing a profile here changes no line already made.
//
// A profile in use cannot be deleted: the server answers how many machines and draft lines point at
// it (`ATM_STANDARD_LOAD_IN_USE`), and the row says so.
import { useEffect, useState } from 'react';
import {
  ATM_CASSETTE_NOTES_MAX,
  ATM_EGP_DENOMINATIONS,
  type AtmBankCode,
  type AtmEgpDenomination,
  type AtmStandardLoadDto,
  type Locale,
  type SaveAtmStandardLoad,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { ApiError } from '../../../../shared/lib/api-client';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Input } from '../../../../shared/ui/form';
import {
  useCreateStandardLoad,
  useDeleteStandardLoad,
  useUpdateStandardLoad,
} from '../../api/settlements-queries';
import { denominationMinor, formatEgp, settlementErrorText } from '../../lib/settlement-view';

interface Row {
  key: string;
  id: string | null;
  version: number;
  label: string;
  isDefault: boolean;
  counts: Readonly<Partial<Record<AtmEgpDenomination, string>>>;
  error: string | null;
}

const rowOf = (load: AtmStandardLoadDto): Row => ({
  key: load.id,
  id: load.id,
  version: load.version,
  label: load.label ?? '',
  isDefault: load.isDefault,
  counts: Object.fromEntries(load.notes.map((n) => [n.denomination, String(n.notes)])),
  error: null,
});

/** The denominations a row names: the boxes holding a number. */
const notesOf = (row: Row): { denomination: AtmEgpDenomination; notes: number }[] =>
  ATM_EGP_DENOMINATIONS.flatMap((d) => {
    const text = row.counts[d];
    if (text === undefined || text.trim() === '') return [];
    const notes = Number(text);
    return Number.isSafeInteger(notes) ? [{ denomination: d, notes }] : [];
  });

const totalMinor = (row: Row): number =>
  notesOf(row).reduce((sum, n) => sum + denominationMinor(n.denomination, n.notes), 0);

/** A repeated denomination, as the server names it (`notes[i].denomination` DUPLICATE). */
const isDuplicate = (error: unknown): boolean =>
  error instanceof ApiError && error.details?.some((d) => d.code === 'DUPLICATE') === true;

export const StandardLoadsDialog = ({
  open,
  loads,
  bankCode,
  branchId,
  canManage,
  locale,
  onClose,
}: {
  open: boolean;
  loads: readonly AtmStandardLoadDto[];
  bankCode: AtmBankCode;
  branchId: string;
  canManage: boolean;
  locale: Locale;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const create = useCreateStandardLoad();
  const update = useUpdateStandardLoad();
  const remove = useDeleteStandardLoad();
  const [rows, setRows] = useState<Row[]>(() => loads.map(rowOf));
  const [counter, setCounter] = useState(0);
  // The saved profiles come back from the server; rows not saved yet stay.
  const signature = loads.map((l) => `${l.id}:${String(l.version)}`).join();
  useEffect(() => {
    setRows((current) => [...loads.map(rowOf), ...current.filter((r) => r.id === null)]);
  }, [signature]);

  const edit = (key: string, change: Partial<Row>): void =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const failed = (key: string) => (error: unknown) =>
    edit(key, {
      error: isDuplicate(error)
        ? t('atm.layouts.standardLoads.duplicate')
        : settlementErrorText(error, t, locale),
    });

  const save = (row: Row): void => {
    const body: SaveAtmStandardLoad = {
      branchId,
      bankCode,
      label: row.label.trim() === '' ? null : row.label.trim(),
      isDefault: row.isDefault,
      notes: notesOf(row),
    };
    edit(row.key, { error: null });
    if (row.id === null) {
      create.mutate(body, {
        onSuccess: () => setRows((all) => all.filter((r) => r.key !== row.key)),
        onError: failed(row.key),
      });
      return;
    }
    update.mutate(
      { id: row.id, body: { ...body, version: row.version } },
      { onError: failed(row.key) },
    );
  };

  const drop = (row: Row): void => {
    if (row.id === null) {
      setRows((all) => all.filter((r) => r.key !== row.key));
      return;
    }
    edit(row.key, { error: null });
    remove.mutate({ id: row.id, version: row.version }, { onError: failed(row.key) });
  };

  const busy = create.isPending || update.isPending || remove.isPending;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('atm.layouts.standardLoads.title')}
      size="xl"
      dismissOnOutsideClick={false}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-sm" data-standard-loads="true">
          <thead>
            <tr className="text-xs text-slate-600 dark:text-slate-300">
              <th className="px-2 py-2 text-start">{t('atm.layouts.standardLoads.label')}</th>
              {ATM_EGP_DENOMINATIONS.map((d) => (
                <th key={d} className="px-2 py-2 text-start">
                  {t('atm.layouts.standardLoads.denomination', { d })}
                </th>
              ))}
              <th className="px-2 py-2 text-end">{t('atm.settlement.total')}</th>
              <th className="px-2 py-2 text-center">{t('atm.layouts.standardLoads.default')}</th>
              <th className="px-2 py-2">
                <span className="sr-only">{t('common.save')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className="border-t border-slate-100 align-top dark:border-slate-800"
              >
                <td className="px-2 py-2">
                  <Input
                    aria-label={t('atm.layouts.standardLoads.label')}
                    density="tight"
                    maxLength={40}
                    value={row.label}
                    disabled={!canManage}
                    onChange={(e) => edit(row.key, { label: e.target.value })}
                  />
                  {row.error !== null && (
                    <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
                      {row.error}
                    </p>
                  )}
                </td>
                {ATM_EGP_DENOMINATIONS.map((d) => (
                  <td key={d} className="px-2 py-2">
                    <Input
                      aria-label={t('atm.layouts.standardLoads.denomination', { d })}
                      density="tight"
                      rule="integer"
                      inputMode="numeric"
                      dir="ltr"
                      className="min-w-20 max-w-20 text-end"
                      value={row.counts[d] ?? ''}
                      disabled={!canManage}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value !== '' && Number(value) > ATM_CASSETTE_NOTES_MAX) return;
                        edit(row.key, { counts: { ...row.counts, [d]: value } });
                      }}
                    />
                  </td>
                ))}
                <td className="px-2 py-2 text-end tabular-nums">
                  {formatEgp(totalMinor(row), locale)}
                </td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="radio"
                    name="standard-load-default"
                    aria-label={t('atm.layouts.standardLoads.default')}
                    checked={row.isDefault}
                    disabled={!canManage}
                    onChange={() =>
                      setRows((all) => all.map((r) => ({ ...r, isDefault: r.key === row.key })))
                    }
                    className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                </td>
                <td className="whitespace-nowrap px-2 py-2">
                  {canManage && (
                    <span className="inline-flex gap-1">
                      <Button
                        size="sm"
                        disabled={busy || notesOf(row).length === 0}
                        onClick={() => save(row)}
                      >
                        {t('atm.layouts.standardLoads.save')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost-danger"
                        disabled={busy}
                        onClick={() => drop(row)}
                      >
                        {t('atm.layouts.standardLoads.delete')}
                      </Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && (
        <Button
          className="mt-3"
          variant="ghost-brand"
          size="sm"
          onClick={() => {
            setCounter((n) => n + 1);
            setRows((all) => [
              ...all,
              {
                key: `new-${String(counter)}`,
                id: null,
                version: 0,
                label: '',
                isDefault: all.length === 0,
                counts: {},
                error: null,
              },
            ]);
          }}
        >
          {t('atm.layouts.standardLoads.add')}
        </Button>
      )}
    </Dialog>
  );
};
