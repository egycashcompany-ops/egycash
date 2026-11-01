// A register row's actions — the owner's list (Receive, Edit, Hand over, Delete, Reveal) plus the
// Link that couples an imported, unlinked row to the Operations list (DEC-30).
//
// Which button a row shows follows two things: the reader's keys and the row's own state. A
// pending row can be received, not handed over; an open row the other way round; Link is only for
// an open row the Operations list does not know yet; Reveal only where the server said this reader
// may see this row's secrets (`secretsVisible`, the same predicate the reveal endpoint applies).
// Showing a button by `can(key)` is a convenience — the server's branch-reach rule (DEC-29) is the
// rule, and a button it would refuse answers with a 403 rather than doing anything.
import { type AtmRegisterEntryDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { RowActions } from '../../../../shared/ui/RowActions';
import {
  EditIcon,
  EyeIcon,
  LinkIcon,
  PlayIcon,
  SwapIcon,
  TrashIcon,
} from '../../../../shared/ui/icons';
import { type RegisterActionGrants } from '../../lib/register-grid';

export const REGISTER_ROW_ACTIONS = [
  'edit',
  'receivePending',
  'handover',
  'reveal',
  'link',
  'delete',
] as const;
export type RegisterRowAction = (typeof REGISTER_ROW_ACTIONS)[number];

/** The actions this row offers this reader, in the order the buttons stand. */
export const registerRowActions = (
  row: AtmRegisterEntryDto,
  grants: RegisterActionGrants,
): RegisterRowAction[] => {
  const shown: RegisterRowAction[] = [];
  if (grants.edit) shown.push('edit');
  // A branch-less pending row (an imported blank col A) cannot be received: its branch is
  // immutable, so the remedy is delete and receive anew (DEC-12).
  if (row.status === 'pending' && row.branchId !== null && grants.create) {
    shown.push('receivePending');
  }
  if (row.status === 'open' && grants.handover) shown.push('handover');
  if (row.safeCombinationSet && row.secretsVisible) shown.push('reveal');
  if (row.status === 'open' && row.masterState === 'unlinked' && grants.edit) shown.push('link');
  if (grants.delete) shown.push('delete');
  return shown;
};

const ICON = {
  edit: EditIcon,
  receivePending: PlayIcon,
  handover: SwapIcon,
  reveal: EyeIcon,
  link: LinkIcon,
  delete: TrashIcon,
} as const;

// Two tones, because an ended row is dark green: the grey row buttons would vanish on it.
const BUTTON =
  'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40';
const TONE = {
  light: {
    plain:
      'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
    danger:
      'text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950',
  },
  onDark: {
    plain: 'text-emerald-100 hover:bg-white/10 hover:text-white',
    danger: 'text-red-200 hover:bg-white/10 hover:text-white',
  },
} as const;

export const RegisterRowActions = ({
  row,
  grants,
  onAction,
}: {
  row: AtmRegisterEntryDto;
  grants: RegisterActionGrants;
  onAction: (action: RegisterRowAction, row: AtmRegisterEntryDto) => void;
}): JSX.Element => {
  const t = useT();
  const tone = row.status === 'ended' ? TONE.onDark : TONE.light;
  return (
    <RowActions always className="justify-end">
      {registerRowActions(row, grants).map((action) => {
        const Icon = ICON[action];
        const label = t(`atm.register.action.${action}`);
        return (
          <button
            key={action}
            type="button"
            data-register-action={action}
            aria-label={label}
            title={label}
            onClick={() => onAction(action, row)}
            className={cn(BUTTON, action === 'delete' ? tone.danger : tone.plain)}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </RowActions>
  );
};
