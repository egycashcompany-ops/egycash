// The one place in ECMS where a credential-shaped secret is put on screen — so the screen has to
// be honest about what it is handing over and for how long.
//
// **Shown once, and that is not a UI convention.** The token is stored as a SHA-256 hash and
// nothing else, exactly as every other setup link is, so there is no endpoint that could read it
// back. "Copy it now or issue a new one" is a description of the storage model, not a nag — and a
// new link invalidates this one, which is why that consequence is stated before the administrator
// closes the dialog rather than after.
//
// **Nothing was sent.** The point of this feature is a deployment where WhatsApp and SMTP are not
// wired up, so the panel must not leave anyone waiting for a message that is never coming.
import { useEffect, useRef, useState } from 'react';
import { type SetupLinkDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Button, Dialog, toast } from '../../../../shared/ui';
import { CheckIcon, ClipboardIcon } from '../../../../shared/ui/icons';
import { formatDateTime } from '../../../../shared/lib/format';

/**
 * The dialog's CONTENT, exported on its own so it can be rendered and asserted.
 *
 * `Dialog` mounts through `createPortal(…, document.body)`, and the web suite runs with
 * `environment: 'node'` (`vitest.config.ts`) — there is no `document`, so the wrapper cannot be
 * rendered here at all. Everything this feature must state to the administrator lives in this
 * component, which CAN be, and the spec beside it renders it directly rather than proving the copy
 * exists by grepping for it.
 */
export const SetupLinkPanel = ({
  link,
  userName,
}: {
  link: SetupLinkDto;
  userName: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = (): void => {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    // No clipboard over plain HTTP and none in some embedded webviews. The link is already on
    // screen and selectable, so the fallback is to say so rather than to fail silently.
    if (clipboard === undefined) {
      toast.info(t('systemAdmin.users.setupLink.copyUnavailable'));
      return;
    }
    void clipboard.writeText(link.url).then(() => {
      setCopied(true);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <>
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('systemAdmin.users.setupLink.intro', { name: userName })}
        </p>

        {/* Read-only rather than disabled: an administrator with no clipboard must still be able to
            select the text, and a disabled input cannot be selected in every browser. */}
        <label htmlFor="setup-link-url" className="sr-only">
          {t('systemAdmin.users.setupLink.title')}
        </label>
        <input
          id="setup-link-url"
          readOnly
          dir="ltr"
          value={link.url}
          onFocus={(event) => event.currentTarget.select()}
          className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />

        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <strong className="font-semibold">
            {t('systemAdmin.users.setupLink.onceTitle')}
          </strong>{' '}
          {t('systemAdmin.users.setupLink.onceBody')}
        </p>

        <ul className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
          <li>
            {t('systemAdmin.users.setupLink.expires', {
              at: formatDateTime(link.expiresAt, locale),
            })}
          </li>
          <li>{t('systemAdmin.users.setupLink.singleUse')}</li>
          <li>{t('systemAdmin.users.setupLink.supersedes')}</li>
          <li>{t('systemAdmin.users.setupLink.notSent')}</li>
        </ul>
      </div>
      <div className="mt-4 flex justify-end">
        <Button size="sm" onClick={copy}>
          {copied ? <CheckIcon className="h-4 w-4" /> : <ClipboardIcon className="h-4 w-4" />}
          {t(copied ? 'systemAdmin.users.setupLink.copied' : 'systemAdmin.users.setupLink.copy')}
        </Button>
      </div>
    </>
  );
};

/** The panel above, in the shared modal. Rendered only when there is a link to show. */
export const SetupLinkDialog = ({
  link,
  userName,
  onClose,
}: {
  link: SetupLinkDto | null;
  userName: string;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <Dialog
      open={link !== null}
      onClose={onClose}
      title={t('systemAdmin.users.setupLink.title')}
      size="md"
      footer={
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      {link !== null && <SetupLinkPanel link={link} userName={userName} />}
    </Dialog>
  );
};
