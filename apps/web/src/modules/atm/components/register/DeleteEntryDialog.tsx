// Delete an entry recorded by mistake (DELETE /atm/register/entries/:id).
//
// A soft delete, and not a handover: the period never happened. If it was the machine's only open
// period, the machine is archived in the Operations list as well (D2) — the body says so before
// the press, because that half of the effect is on another team's screen.
//
// An entry Operations recorded themselves, by adding the machine on /atm/data-edit (DEC-36), says it
// louder: deleting it does not undo a mistake of Efficiency's, it takes away a machine Operations
// just put to work — the receipt and the machine are one record of the same add.
import { type AtmRegisterEntryDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { useDeleteRegisterEntry } from '../../api/register-queries';
import { ConfirmActionDialog } from '../ReplenishmentDialogs';
import { registerErrorText } from './EntryFormSections';

export const DeleteEntryDialog = ({
  entry,
  onClose,
}: {
  entry: AtmRegisterEntryDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const remove = useDeleteRegisterEntry();

  const confirm = async (): Promise<void> => {
    try {
      await remove.mutateAsync({ id: entry.id, version: entry.version });
      toast.success(t('atm.register.deleted'));
      onClose();
    } catch (failure) {
      toast.error(registerErrorText(failure, t, locale));
    }
  };

  return (
    <ConfirmActionDialog
      open
      onClose={onClose}
      title={t('atm.register.form.deleteTitle')}
      body={t(
        entry.source === 'operations'
          ? 'atm.register.form.deleteBodyOperations'
          : 'atm.register.form.deleteBody',
      )}
      confirmLabel={t('atm.register.action.delete')}
      danger
      busy={remove.isPending}
      onConfirm={() => void confirm()}
    />
  );
};
