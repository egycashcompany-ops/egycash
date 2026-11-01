// «عقود توريد السيارات» — the list's columns, as the owner's approved sample lays them out
// (`zz-contracts-list-page`): the licence board's table in the alarms board's type, every value
// centred. «العقد» (its name — «عقد رقم N» in grey when none was written — its date and its last
// supply date), «المورد», «الماركات», «المستلم من المتعاقد عليه», «إنذار التوريد», «إجمالي العقد»,
// «المرفقات» and the row's actions in the owner's picture: the eye, the pen, «تسجيل استلام» in its
// calm indigo between the pen and the bin (faded, saying why, once every car arrived), and the bin.
import { Link } from 'react-router-dom';
import { type FleetVehicleContractDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { type Column } from '../../../shared/ui/DataTable';
import { EyeIcon } from '../../../shared/ui/icons';
import { mayAddContractFiles } from '../lib/vehicle-contract-save';
import { latin, useVehicleContractWords } from '../lib/vehicle-contract-words';
import { ACTION_GROUP, IMAGE_EMPTY_BOX, IMAGE_GROUP, actionTone } from './row-actions-look';
import { CloudUploadIcon, SquarePenIcon, Trash2Icon } from './row-action-icons';
import { LockedRowAction } from './LockedRowAction';
import { BOARD_FONT as CAIRO, BoardIcon, ymd } from './FuelCardBoard';
import {
  CLIP_ICON,
  DASH,
  FIGURE,
  MakeChips,
  MoneyCell,
  RECEIVE_ICON,
  ReceivedCell,
  SupplyAlarmCell,
} from './vehicle-contract-parts';

const contractPath = (id: string): string => `/fleet/vehicle-contracts/${encodeURIComponent(id)}`;

export const useVehicleContractColumns = ({
  onReceive,
  onDelete,
}: {
  onReceive: (contract: FleetVehicleContractDto) => void;
  onDelete: (contract: FleetVehicleContractDto) => void;
}): Column<FleetVehicleContractDto>[] => {
  const t = useT();
  const can = useCan();
  const meId = useAppSelector((state) => state.auth.me?.id ?? null);
  const words = useVehicleContractWords();
  return [
    {
      key: 'contract',
      sortKey: 'date',
      align: 'center',
      header: t('fleet.vehicleContracts.columns.contract'),
      sortable: true,
      render: (c) => {
        const name = words.contractName(c);
        return (
          <span className="mx-auto flex max-w-[15rem] flex-col items-center gap-0.5 whitespace-normal">
            <Link
              to={contractPath(c.id)}
              title={name.unnamed ? t('fleet.vehicleContracts.unnamedTitle') : name.text}
              data-contract-name={name.unnamed ? 'fallback' : 'typed'}
              className={cn(
                'text-balance text-[15px] leading-[19px] hover:underline',
                CAIRO,
                name.unnamed
                  ? '[&&]:!font-normal text-slate-400 dark:text-slate-500'
                  : 'text-slate-900 dark:text-white',
              )}
            >
              {name.text}
            </Link>
            <span
              dir="ltr"
              className={cn(FIGURE, 'text-[13px] text-slate-500 dark:text-slate-400')}
            >
              {ymd(c.date)}
            </span>
            {c.deadline !== null && (
              // «آخر موعد للتوريد» right under the contract's date — a plain fact, no warning.
              <span
                data-contract-deadline={c.id}
                className="inline-flex items-baseline gap-1 whitespace-nowrap text-[11.5px] leading-4 text-slate-500 dark:text-slate-400"
              >
                <span className={cn(CAIRO, '[&&]:!font-semibold')}>
                  {t('fleet.vehicleContracts.fact.deadline')}
                </span>
                <span dir="ltr" className={cn(FIGURE, 'text-[12.5px]')}>
                  {ymd(c.deadline)}
                </span>
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'supplier',
      align: 'center',
      header: t('fleet.vehicleContracts.columns.supplier'),
      sortable: true,
      render: (c) =>
        c.supplier.trim() === '' ? (
          DASH
        ) : (
          <span
            className={cn(
              'mx-auto block min-w-[6.5rem] max-w-[11rem] whitespace-normal text-balance text-[14px] leading-[19px] text-slate-700 dark:text-slate-200',
              CAIRO,
            )}
          >
            {c.supplier}
          </span>
        ),
    },
    {
      key: 'makes',
      align: 'center',
      header: t('fleet.vehicleContracts.columns.makes'),
      render: (c) => <MakeChips lines={c.lines} />,
    },
    {
      key: 'received',
      sortKey: 'receivedShare',
      align: 'center',
      header: t('fleet.vehicleContracts.columns.received'),
      sortable: true,
      render: (c) => <ReceivedCell contract={c} />,
    },
    {
      key: 'alarm',
      sortKey: 'alarmRank',
      align: 'center',
      header: t('fleet.vehicleContracts.columns.alarm'),
      sortable: true,
      render: (c) => <SupplyAlarmCell alarm={c.alarm} />,
    },
    {
      key: 'total',
      align: 'center',
      header: t('fleet.vehicleContracts.columns.total'),
      sortable: true,
      render: (c) => <MoneyCell value={c.total} strong />,
    },
    {
      key: 'files',
      align: 'center',
      header: t('fleet.vehicleContracts.columns.files'),
      render: (c) => {
        const pdfs = c.files.filter((file) => file.kind === 'pdf').length;
        if (c.files.length === 0) {
          // No page yet: the dashed box leads to the contract's attachments, where they are added.
          return mayAddContractFiles(can, meId, c) ? (
            <Link
              to={`${contractPath(c.id)}#files`}
              title={t('fleet.vehicleContracts.actions.addFiles')}
              aria-label={t('fleet.vehicleContracts.actions.addFiles')}
              data-contract-add-files={c.id}
              className={IMAGE_EMPTY_BOX}
            >
              <CloudUploadIcon className="h-4 w-4" />
            </Link>
          ) : (
            DASH
          );
        }
        return (
          <Link
            to={`${contractPath(c.id)}#files`}
            data-contract-files={c.id}
            title={t('fleet.vehicleContracts.filesTitle', {
              n: words.count('file', c.files.length),
              images: latin(c.files.length - pdfs),
              pdfs: latin(pdfs),
            })}
            className={cn(
              IMAGE_GROUP,
              'gap-1.5 text-slate-700 hover:border-blue-400/60 dark:text-slate-200',
            )}
          >
            <BoardIcon d={CLIP_ICON} className="h-4 w-4 text-blue-600 dark:text-[#58a8e8]" />
            <span dir="ltr" className={cn(FIGURE, 'text-[15px]')}>
              {latin(c.files.length)}
            </span>
            {pdfs > 0 && (
              <span className="rounded bg-red-500/10 px-1 text-[10px] leading-4 text-red-600 dark:text-red-400">
                PDF
              </span>
            )}
          </Link>
        );
      },
    },
    {
      key: 'actions',
      header: t('fleet.vehicles.columns.actions'),
      align: 'center',
      render: (c) => (
        <span className={ACTION_GROUP} data-row-actions="vehicle-contract">
          <Link
            to={contractPath(c.id)}
            title={t('fleet.vehicleContracts.actions.view')}
            aria-label={t('fleet.vehicleContracts.actions.view')}
            data-contract-view={c.id}
            className={actionTone('view')}
          >
            <EyeIcon className="h-4 w-4" />
          </Link>
          {can('fleetVehicleContract.edit') && (
            <Link
              to={`${contractPath(c.id)}/edit`}
              title={t('fleet.vehicleContracts.actions.edit')}
              aria-label={t('fleet.vehicleContracts.actions.edit')}
              data-contract-edit={c.id}
              className={actionTone('edit')}
            >
              <SquarePenIcon className="h-4 w-4" />
            </Link>
          )}
          {can('fleetVehicleContract.receive') &&
            (c.remaining <= 0 ? (
              <LockedRowAction
                kind="transfer"
                reason={t('fleet.vehicleContracts.actions.receiveLocked')}
                mark="contract-receive"
              >
                <BoardIcon d={RECEIVE_ICON} className="h-4 w-4" />
              </LockedRowAction>
            ) : (
              <button
                type="button"
                title={t('fleet.vehicleContracts.actions.receive')}
                aria-label={t('fleet.vehicleContracts.actions.receive')}
                data-contract-receive={c.id}
                onClick={() => onReceive(c)}
                className={actionTone('transfer')}
              >
                <BoardIcon d={RECEIVE_ICON} className="h-4 w-4" />
              </button>
            ))}
          {can('fleetVehicleContract.delete') && (
            <button
              type="button"
              title={t('fleet.vehicleContracts.actions.delete')}
              aria-label={t('fleet.vehicleContracts.actions.delete')}
              data-contract-delete={c.id}
              onClick={() => onDelete(c)}
              className={actionTone('delete')}
            >
              <Trash2Icon className="h-4 w-4" />
            </button>
          )}
        </span>
      ),
    },
  ];
};
