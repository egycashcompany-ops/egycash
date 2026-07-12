// Notification bell for the topbar — the entry point to the in-app inbox. The live inbox
// (server notifications + Socket.IO badge) is a later feature; this establishes the placement,
// popover, unread-badge slot, and empty state that it will fill.
import { useRef, useState } from 'react';
import { useT } from '../localization/useT';
import { useOnClickOutside } from '../../shared/lib/useOnClickOutside';
import { BellIcon, InboxIcon } from '../../shared/ui/icons';

export const NotificationBell = (): JSX.Element => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);
  const unread = 0; // wired to the notifications service in a later feature

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        aria-label={t('notifications.title')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute end-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('notifications.title')}
          className="absolute end-0 mt-2 w-80 max-w-[90vw] rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-700">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {t('notifications.title')}
            </p>
          </div>
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <InboxIcon className="h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('notifications.empty')}</p>
          </div>
        </div>
      )}
    </div>
  );
};
