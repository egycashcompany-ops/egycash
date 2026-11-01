// The company-wide bank catalog (DEC-35) as one table — the «البنوك» tab of /atm/data-edit and the
// «البنوك» dialog of the register share it, so the two pages cannot show a bank differently.
//
// The dialog is where EFFICIENCY curates banks: the catalog is theirs and the administrators'
// (`atmBank.create` / `atmBank.edit`, organization scope on the server, DEC-39), and they have no
// navigation row to data-edit. The owner's call (final): a bank added here is a FULL register bank
// — the register, the Data Report, settlements and the map — so the dialog says so before the add.
import { useMemo, useState } from 'react';
import { type AtmBankDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Can, useCan } from '../../../../platform/rbac/Can';
import { StatusBadge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { DataTable, type Column } from '../../../../shared/ui/DataTable';
import { Dialog } from '../../../../shared/ui/Dialog';
import { EditIcon, PlusIcon } from '../../../../shared/ui/icons';
import { useAtmBanks } from '../../api/atm-queries';
import { sortByCatalogOrder } from '../../lib/bank-catalog';
import { BankDialog } from './BankDialog';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The icon button of a catalog row — the data-edit tables' own. */
const ACTION_BUTTON =
  'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

/**
 * The catalog's columns: code, both names, the Operations name, the colour, the status — and the
 * edit button when the reader may edit (`onEdit` given).
 */
export const bankCatalogColumns = ({
  t,
  onEdit,
}: {
  t: Translate;
  onEdit?: ((bank: AtmBankDto) => void) | undefined;
}): Column<AtmBankDto>[] => [
  {
    key: 'code',
    header: t('atm.bankCatalog.code'),
    render: (r) => <span dir="ltr">{r.code}</span>,
  },
  { key: 'nameAr', header: t('atm.bankCatalog.nameAr'), render: (r) => r.name.ar },
  { key: 'nameEn', header: t('atm.bankCatalog.nameEn'), render: (r) => r.name.en },
  {
    key: 'opsLabel',
    header: t('atm.bankCatalog.opsLabel'),
    render: (r) => <span dir="ltr">{r.opsLabel}</span>,
  },
  {
    key: 'color',
    header: t('atm.bankCatalog.color'),
    render: (r) => (
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-3 w-3 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(15,23,42,0.3)]"
          style={{ backgroundColor: r.color }}
        />
        <span dir="ltr" className="text-xs text-slate-500 dark:text-slate-400">
          {r.color}
        </span>
      </span>
    ),
  },
  {
    key: 'status',
    header: t('atm.dataEdit.status'),
    render: (r) => (
      <StatusBadge
        tone={r.isActive ? 'success' : 'neutral'}
        label={r.isActive ? t('atm.dataEdit.active') : t('atm.dataEdit.archived')}
      />
    ),
  },
  ...(onEdit === undefined
    ? []
    : [
        {
          key: 'actions',
          header: t('atm.dataEdit.actions'),
          align: 'end',
          render: (r: AtmBankDto) => (
            <button
              type="button"
              className={ACTION_BUTTON}
              aria-label={t('atm.common.edit')}
              title={t('atm.common.edit')}
              data-edit-action="edit-bank"
              onClick={() => onEdit(r)}
            >
              <EditIcon className="h-4 w-4" />
            </button>
          ),
        } satisfies Column<AtmBankDto>,
      ]),
];

const ignore = (): void => undefined;

/**
 * The register's «البنوك»: the whole catalog in its order, archived banks included (an entry may
 * still carry one), with add and edit behind their own keys. The bank dialog opens OVER this one;
 * while it is open this dialog does not close — its Escape and its outside clicks are the bank
 * dialog's, so a slip there never throws the reader out of the catalog as well.
 */
export const BankCatalogDialog = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const catalog = useAtmBanks(open);
  const rows = useMemo(() => sortByCatalogOrder(catalog.data ?? []), [catalog.data]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AtmBankDto | null>(null);
  const canEdit = can('atmBank.edit');
  const nested = adding || editing !== null;

  return (
    <>
      <Dialog
        open={open}
        onClose={nested ? ignore : onClose}
        title={t('atm.bankCatalog.title')}
        size="xl"
      >
        <div className="space-y-3" data-bank-catalog="true">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
              {t('atm.bankCatalog.intro')}
            </p>
            <Can permission="atmBank.create">
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                data-bank-catalog-action="add"
                onClick={() => setAdding(true)}
              >
                {t('atm.bankCatalog.add')}
              </Button>
            </Can>
          </div>
          <DataTable
            columns={bankCatalogColumns({ t, onEdit: canEdit ? setEditing : undefined })}
            rows={rows}
            rowKey={(r) => r.code}
            loading={catalog.isLoading}
            error={catalog.isError ? catalog.error : undefined}
            onRetry={() => void catalog.refetch()}
          />
        </div>
      </Dialog>
      {/* Each also checks its key, as on data-edit: the buttons are UX, the server is the gate. */}
      <BankDialog
        open={open && adding && can('atmBank.create')}
        onClose={() => setAdding(false)}
        bank={null}
      />
      <BankDialog
        open={open && editing !== null && canEdit}
        onClose={() => setEditing(null)}
        bank={editing}
      />
    </>
  );
};
