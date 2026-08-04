// A record's technical code, available without being on display.
//
// Codes like `APP-2026-000078` identify a row; they do not identify a person, and putting one
// beside someone's name trains everyone to read the serial first. But the code is still real —
// it is what search matches, what a phone call quotes, what a spreadsheet keys on — so it cannot
// simply be deleted from the interface. It moves behind this control: hidden on the screen, in the
// tooltip on hover, on the clipboard on click.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../platform/localization/useT';
import { CheckIcon, ClipboardIcon } from './icons';
import { toast } from './toast/toast-store';

export const CopyIdButton = ({ code, label }: { code: string; label?: string }): JSX.Element => {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  // The tick is a timed state change, so it must not fire on an unmounted component.
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const title = `${label ?? t('common.copyId')}: ${code}`;

  const copy = (): void => {
    // No clipboard over plain HTTP, and none in some embedded webviews. Show the code instead —
    // on demand and transient, which is the one place it is still allowed to appear.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (clipboard === undefined) {
      toast.info(t('common.copyId.failed'), code);
      return;
    }
    void clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        // The tick is only visible; the toast is what a screen reader hears.
        toast.success(t('common.copyId.done'));
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => toast.info(t('common.copyId.failed'), code));
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={title}
      aria-label={title}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-emerald-600" />
      ) : (
        <ClipboardIcon className="h-3.5 w-3.5" />
      )}
    </button>
  );
};
