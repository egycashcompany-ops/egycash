// The pay-item catalog (PY-1): what this organization calls its earnings and deductions.
//
// A row carries NO amount. An amount belongs to an employee or to a calculation, and neither
// exists yet — so this screen is deliberately a vocabulary editor, not a pay screen. It also
// shows no tax or statutory field, because Payroll v1 has no such rule to show.
//
// `code`, `kind`, `calcBasis` and `quantitySource` are set once at creation and never edited: a
// payslip line will cite the item that produced it, so changing what an item MEANS would restate
// history — and switching a per-day item from days-attended to days-absent would turn a payment
// into a charge. The row offers rename, re-order and archive instead — and archive rather than
// delete, so a future payslip keeps naming something real.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CALC_BASIS_UNITS,
  PAY_ITEM_CALC_BASES,
  PAY_ITEM_KINDS,
  PAY_ITEM_QUANTITY_SOURCES,
  QUANTITY_SOURCE_UNITS,
  type Locale,
  type PayItemCalcBasis,
  type PayItemDto,
  type PayItemKind,
  type PayItemQuantitySource,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Badge, Button, DataTable, EmptyState, Pagination, type Column } from '../../../../shared/ui';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Select } from '../../../../shared/ui/form';
import { SearchInput } from '../../../../shared/ui/SearchInput';
import { PlusIcon } from '../../../../shared/ui/icons';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../shared/lib/format';
import { useCreatePayItem, usePayItems, useUpdatePayItem } from '../api/payroll-queries';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'kind',
  'q',
  'status',
] as const;

const PAGE_SIZE = 25;

export const PayItemsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const [editing, setEditing] = useState<PayItemDto | null>(null);
  const [adding, setAdding] = useState(false);

  const search = sp.get('q') ?? '';
  const kind = sp.get('kind') ?? '';
  const status = sp.get('status') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);

  const params = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      sortBy: 'sortOrder',
      sortDir: 'asc',
      ...(search === '' ? {} : { search }),
      ...(kind === '' ? {} : { kind }),
      ...(status === '' ? {} : { status }),
    }),
    [page, search, kind, status],
  );
  const items = usePayItems(params);
  const update = useUpdatePayItem();

  const patchParams = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    next.delete('page');
    setSp(next);
  };

  const toggleStatus = (item: PayItemDto): void => {
    const next = item.status === 'active' ? 'archived' : 'active';
    update.mutate(
      { id: item.id, body: { status: next, version: item.version } },
      { onSuccess: () => toast.success(t(`payroll.payItems.${next}`)) },
    );
  };

  const columns: Column<PayItemDto>[] = [
    {
      key: 'code',
      header: t('payroll.payItems.code'),
      render: (r) => (
        <span className="font-mono text-xs" dir="ltr">
          {r.code}
        </span>
      ),
    },
    { key: 'name', header: t('payroll.payItems.name'), render: (r) => localized(r.name, locale) },
    {
      key: 'kind',
      header: t('payroll.payItems.kind'),
      render: (r) => (
        <Badge tone={r.kind === 'earning' ? 'success' : 'warning'}>
          {t(`payroll.payItems.kind.${r.kind}`)}
        </Badge>
      ),
    },
    {
      key: 'calcBasis',
      header: t('payroll.payItems.calcBasis'),
      render: (r) => (
        <span className="flex flex-col">
          <span>{t(`payroll.payItems.basis.${r.calcBasis}`)}</span>
          {r.quantitySource !== null && (
            <span className="text-xs text-slate-400">
              {t(`payroll.quantitySource.${r.quantitySource}`)}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('payroll.payItems.status'),
      render: (r) => (
        <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>
          {t(`payroll.payItems.status.${r.status}`)}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t('payroll.payItems.actions'),
      render: (r) => (
        <Can permission="payItem.edit" fallback={<span className="text-slate-300">—</span>}>
          <span className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
              {t('common.edit')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => toggleStatus(r)}>
              {t(r.status === 'active' ? 'payroll.payItems.archive' : 'payroll.payItems.restore')}
            </Button>
          </span>
        </Can>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('payroll.payItems.title')}
        description={t('payroll.payItems.subtitle')}
        breadcrumbs={[{ label: t('payroll.module.title') }, { label: t('payroll.payItems.title') }]}
        actions={
          <Can permission="payItem.create">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => setAdding(true)}>
              {t('payroll.payItems.add')}
            </Button>
          </Can>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput
          className="w-full sm:w-64"
          value={search}
          onChange={(value) => patchParams({ q: value })}
          placeholder={t('payroll.payItems.search')}
        />
        <Select
          value={kind}
          onChange={(e) => patchParams({ kind: e.target.value })}
          aria-label={t('payroll.payItems.kind')}
        >
          <option value="">{t('payroll.payItems.allKinds')}</option>
          {PAY_ITEM_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`payroll.payItems.kind.${value}`)}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => patchParams({ status: e.target.value })}
          aria-label={t('payroll.payItems.status')}
        >
          <option value="">{t('payroll.payItems.allStatuses')}</option>
          <option value="active">{t('payroll.payItems.status.active')}</option>
          <option value="archived">{t('payroll.payItems.status.archived')}</option>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={items.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={items.isLoading}
        error={items.isError ? items.error : undefined}
        onRetry={() => void items.refetch()}
        empty={<EmptyState title={t('payroll.payItems.empty')} description={t('payroll.payItems.emptyHint')} />}
      />
      {items.data !== undefined && (
        <Pagination
          meta={items.data.meta}
          onPageChange={(next) => {
            const params = new URLSearchParams(sp);
            params.set('page', String(next));
            setSp(params);
          }}
        />
      )}

      {(adding || editing !== null) && (
        <PayItemDialog
          item={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
    </PageContainer>
  );
};

/**
 * Create and rename in one dialog — but not the same fields.
 *
 * On create the arithmetic is chosen; on edit it is shown as read-only text, because changing it
 * would change what every payslip citing this item meant. That is a rule the server enforces (the
 * update contract has no such field); the dialog simply does not offer what would be refused.
 */
const PayItemDialog = ({
  item,
  onClose,
}: {
  item: PayItemDto | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const create = useCreatePayItem();
  const update = useUpdatePayItem();
  const [code, setCode] = useState(item?.code ?? '');
  const [ar, setAr] = useState(item?.name.ar ?? '');
  const [en, setEn] = useState(item?.name.en ?? '');
  const [kind, setKind] = useState<PayItemKind>(item?.kind ?? 'earning');
  const [calcBasis, setCalcBasis] = useState<PayItemCalcBasis>(item?.calcBasis ?? 'fixed');
  const [quantitySource, setQuantitySource] = useState<PayItemQuantitySource | ''>(
    item?.quantitySource ?? '',
  );

  // PY-4: a per-day item counts something measured in days, a per-minute item counts minutes, and
  // a flat or percentage item counts nothing. The picker offers only what fits, so an incoherent
  // pairing cannot be chosen — the server refuses it too, and this is not the enforcement.
  const neededUnit = CALC_BASIS_UNITS[calcBasis];
  const sourceOptions = PAY_ITEM_QUANTITY_SOURCES.filter(
    (source) => QUANTITY_SOURCE_UNITS[source] === neededUnit,
  );

  const codeValid = /^[A-Z][A-Z0-9_]{1,29}$/.test(code);
  const invalid =
    ar.trim() === '' ||
    en.trim() === '' ||
    (item === null && !codeValid) ||
    (item === null && neededUnit !== null && quantitySource === '');

  const submit = (): void => {
    if (invalid) return;
    const name = { ar: ar.trim(), en: en.trim() };
    if (item === null) {
      create.mutate(
        {
          code,
          name,
          kind,
          calcBasis,
          ...(neededUnit === null ? {} : { quantitySource: quantitySource as PayItemQuantitySource }),
        },
        {
          onSuccess: () => {
            toast.success(t('payroll.payItems.created'));
            onClose();
          },
        },
      );
      return;
    }
    update.mutate(
      { id: item.id, body: { name, version: item.version } },
      {
        onSuccess: () => {
          toast.success(t('payroll.payItems.renamed'));
          onClose();
        },
      },
    );
  };

  const error = create.error ?? update.error;

  return (
    <Dialog
      open
      onClose={onClose}
      title={item === null ? t('payroll.payItems.add') : t('payroll.payItems.edit')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={submit}
            loading={create.isPending || update.isPending}
            disabled={invalid}
          >
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label={t('payroll.payItems.code')} hint={t('payroll.payItems.codeHint')}>
          {item === null ? (
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              dir="ltr"
              aria-label={t('payroll.payItems.code')}
            />
          ) : (
            <p className="font-mono text-sm" dir="ltr">
              {item.code}
            </p>
          )}
        </Field>
        <Field label={t('payroll.payItems.nameAr')}>
          <Input value={ar} onChange={(e) => setAr(e.target.value)} aria-label={t('payroll.payItems.nameAr')} />
        </Field>
        <Field label={t('payroll.payItems.nameEn')}>
          <Input value={en} onChange={(e) => setEn(e.target.value)} aria-label={t('payroll.payItems.nameEn')} />
        </Field>
        <Field label={t('payroll.payItems.kind')} hint={item === null ? undefined : t('payroll.payItems.immutable')}>
          {item === null ? (
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as PayItemKind)}
              aria-label={t('payroll.payItems.kind')}
            >
              {PAY_ITEM_KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`payroll.payItems.kind.${value}`)}
                </option>
              ))}
            </Select>
          ) : (
            <p className="text-sm">{t(`payroll.payItems.kind.${item.kind}`)}</p>
          )}
        </Field>
        <Field label={t('payroll.payItems.calcBasis')}>
          {item === null ? (
            <Select
              value={calcBasis}
              onChange={(e) => {
                setCalcBasis(e.target.value as PayItemCalcBasis);
                setQuantitySource(''); // a new basis needs a source measured in its own unit
              }}
              aria-label={t('payroll.payItems.calcBasis')}
            >
              {PAY_ITEM_CALC_BASES.map((value) => (
                <option key={value} value={value}>
                  {t(`payroll.payItems.basis.${value}`)}
                </option>
              ))}
            </Select>
          ) : (
            <p className="text-sm">{t(`payroll.payItems.basis.${item.calcBasis}`)}</p>
          )}
        </Field>
        {(neededUnit !== null || item?.quantitySource != null) && (
          <Field
            label={t('payroll.payItems.quantitySource')}
            hint={item === null ? t('payroll.payItems.quantitySourceHint') : t('payroll.payItems.immutable')}
          >
            {item === null ? (
              <Select
                value={quantitySource}
                onChange={(e) => setQuantitySource(e.target.value as PayItemQuantitySource | '')}
                aria-label={t('payroll.payItems.quantitySource')}
              >
                <option value="">{t('payroll.payItems.pickQuantitySource')}</option>
                {sourceOptions.map((value) => (
                  <option key={value} value={value}>
                    {t(`payroll.quantitySource.${value}`)}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-sm">
                {item.quantitySource === null
                  ? '—'
                  : t(`payroll.quantitySource.${item.quantitySource}`)}
              </p>
            )}
          </Field>
        )}
        {error !== null && error !== undefined && (
          <p role="alert" className="text-sm text-red-600">
            {(error as Error).message}
          </p>
        )}
      </div>
    </Dialog>
  );
};
