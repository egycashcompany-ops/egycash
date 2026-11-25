// The module's form-dialog frame — the shared `Dialog` with Cancel and Save, written after
// Administrative Affairs' `AdministrationDialogFrame` (a module imports no other module's code).
//
// A dialog that is FILLED IN keeps its typing: only the × and Escape close it. Save stays ENABLED:
// pressing it with a required value missing names what is missing in the banner and marks each
// box, and nothing is sent. A refusal from the server is said in the alert box above the fields in
// the reader's language (`errorMessage`, the shared table).
import { type ReactNode } from 'react';
import { useT } from '../../../platform/localization/useT';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { MissingFieldsBanner, type RequiredFields } from '../../../shared/ui/required-fields';

export const ComplianceDialogFrame = ({
  open,
  onClose,
  title,
  description,
  required,
  onSave,
  busy,
  error,
  saveLabel,
  size,
  tall = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  required: RequiredFields;
  onSave: () => unknown;
  busy: boolean;
  /** The server's refusal, already in the reader's language, or null. */
  error: string | null;
  /** «حفظ» unless the act has its own word — «رفع» for an upload. */
  saveLabel?: string;
  size?: 'md' | 'lg';
  tall?: boolean;
  children: ReactNode;
}): JSX.Element => {
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      dismissOnOutsideClick={false}
      tall={tall}
      {...(description === undefined ? {} : { description })}
      {...(size === undefined ? {} : { size })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} onClick={required.guard(onSave)} data-compliance-save="">
            {saveLabel ?? t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        {error !== null && (
          <p
            role="alert"
            data-compliance-refusal=""
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
          >
            {error}
          </p>
        )}
        {children}
      </div>
    </Dialog>
  );
};
