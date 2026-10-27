// A button that opens a short menu of actions (the Topbar's menu, `platform/layout/Topbar.tsx`):
// «طباعة النوتس» with its three choices, Control's handover per bank, a route's options (§9.4,
// §9.7). Each item is a real button, so a print item's click is the user's click — the print tab
// is opened inside it (§8). Escape closes the menu and gives the focus back to its button (§9.10).
import { useRef, useState, type ReactNode } from 'react';
import { cn } from '../../../../shared/lib/cn';
import { useOnClickOutside } from '../../../../shared/lib/useOnClickOutside';
import { Button, type ButtonProps } from '../../../../shared/ui/Button';
import { ChevronIcon } from '../../../../shared/ui/icons';

export interface MenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export const MenuButton = ({
  label,
  ariaLabel,
  items,
  variant = 'secondary',
  size = 'md',
  disabled = false,
  icon,
}: {
  label?: ReactNode;
  /** Required when `label` is an icon only (§9.10). */
  ariaLabel?: string;
  items: readonly MenuItem[];
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  disabled?: boolean;
  icon?: ReactNode;
}): JSX.Element => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);
  return (
    <div
      className="relative"
      ref={ref}
      onKeyDown={(e) => {
        if (!open || e.key !== 'Escape') return;
        e.stopPropagation();
        setOpen(false);
        ref.current?.querySelector<HTMLButtonElement>('button[aria-haspopup]')?.focus();
      }}
    >
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        {label}
        {label !== undefined && <ChevronIcon className="h-4 w-4" />}
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 z-50 mt-1 min-w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-elevated dark:border-slate-700 dark:bg-slate-800"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled === true}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                'flex w-full items-center px-4 py-2 text-start text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-700',
                item.danger === true
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-slate-700 dark:text-slate-200',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
