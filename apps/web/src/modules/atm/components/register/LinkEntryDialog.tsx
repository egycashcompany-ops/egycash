// Link an open, unlinked entry to the Operations list (POST …/:id/link, DEC-30).
//
// An imported row the import could not couple — no area, its code active in another branch, not
// approved — stays in the register without a machine in Operations. Entering its area through
// Edit links it; this is the same coupling for an entry that needs no edit (say, after an
// administrator resolved the other branch's machine). It does what a receipt does: link to the
// existing machine, reactivate an archived one, or add it — and the toast says which.
import { type AtmRegisterEntryDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { useLinkRegisterEntry } from '../../api/register-queries';
import { ConfirmActionDialog } from '../ReplenishmentDialogs';
import { registerErrorText } from './EntryFormSections';

export const LinkEntryDialog = ({
  entry,
  onClose,
}: {
  entry: AtmRegisterEntryDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const link = useLinkRegisterEntry();

  const confirm = async (): Promise<void> => {
    try {
      const result = await link.mutateAsync({ id: entry.id, version: entry.version });
      toast.success(t(`atm.register.masterAction.${result.master.action}`));
      for (const warning of result.warnings) toast.warning(t(`atm.register.warning.${warning}`));
      onClose();
    } catch (failure) {
      toast.error(registerErrorText(failure, t, locale));
    }
  };

  return (
    <ConfirmActionDialog
      open
      onClose={onClose}
      title={t('atm.register.form.linkTitle', { code: entry.machineCode ?? '—' })}
      body={t('atm.register.form.linkBody')}
      confirmLabel={t('atm.register.action.link')}
      busy={link.isPending}
      onConfirm={() => void confirm()}
    />
  );
};
