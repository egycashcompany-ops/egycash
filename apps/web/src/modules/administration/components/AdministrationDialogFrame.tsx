// The module's form-dialog frame (design §13.6 E, §19.8): the shared `Dialog` with Cancel and Save,
// written once for the four Phase 1 dialogs and, in P1b.W, the supplier's — as IT's `Shell` is for
// the dialogs of its one file.
//
// A dialog that is FILLED IN keeps its typing: only the × and Escape close it
// (`dismissOnOutsideClick={false}`). Save stays ENABLED (`shared/ui/required-fields.tsx`): pressing
// it with a required value missing names what is missing in the banner and marks each box, and
// nothing is sent. A refusal from the server is said in the alert box above the fields in the
// reader's language (`errorMessage`, the shared `FRIENDLY` table); the field it names, if any, is
// worded beside that field by the dialog.
import { type ReactNode } from 'react';
import { useT } from '../../../platform/localization/useT';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { MissingFieldsBanner, type RequiredFields } from '../../../shared/ui/required-fields';

export const AdministrationDialogFrame = ({
  open,
  onClose,
  title,
  description,
  required,
  onSave,
  busy,
  error,
  size,
  tall = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** What the dialog is about — an edit names its record. */
  description?: string;
  /** The form's required values (`useRequiredFields`): the banner and the guard on Save. */
  required: RequiredFields;
  /** The save itself; it runs only once every required value is in. */
  onSave: () => unknown;
  busy: boolean;
  /** The server's refusal, already in the reader's language, or null. */
  error: string | null;
  size?: 'md' | 'lg';
  /** For a form whose drop-down lists open inside it. */
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
          <Button loading={busy} onClick={required.guard(onSave)} data-administration-save="">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        {error !== null && (
          <p
            role="alert"
            data-administration-refusal=""
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
