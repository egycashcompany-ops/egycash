// The second click before a folder or a file goes. It names what goes and says what stays — the
// record of who has seen each file is kept — because «حذف» read on its own could be heard as
// erasing that too. A click outside does not dismiss it, and the red button is the only way through.
import { useT } from '../../../platform/localization/useT';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { TrashIcon } from '../../../shared/ui/icons';

export const ConfirmDeleteDialog = ({
  open,
  title,
  body,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissOnOutsideClick={false}
      size="sm"
      title={title}
      description={body}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('compliance.confirm.keep')}
          </Button>
          <Button variant="danger" loading={busy} onClick={onConfirm}>
            <TrashIcon className="h-4 w-4" />
            {t('common.delete')}
          </Button>
        </>
      }
    >
      {null}
    </Dialog>
  );
};
