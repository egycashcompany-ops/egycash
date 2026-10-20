// The pin at the top of the floating navigation panel, beside the module's name (floating-nav.ts).
//
// «عايزك تخلي موضوع توسيع وطى يبقي أيقونة Pin فوق بعد الـ 4 مربعات بتاعت أسم الموديولات وشيلها
// من تحت». The four squares are the module switcher's grid glyph; the pin sits right after it.
// Hovering the strip shows the panel; this pin keeps it shown, over the page, until it is unpinned.
// Both shells use this one button, so the pin looks and answers the same in either of them.
import { useT } from '../localization/useT';
import { cn } from '../../shared/lib/cn';
import { PushPinIcon } from '../../shared/ui/icons';

export const NavPinButton = ({
  pinned,
  onToggle,
}: {
  pinned: boolean;
  onToggle: () => void;
}): JSX.Element => {
  const t = useT();
  const label = t(pinned ? 'nav.unpinPanel' : 'nav.pinPanel');
  return (
    <button
      data-nav-toggle
      type="button"
      onClick={onToggle}
      aria-pressed={pinned}
      aria-label={label}
      title={label}
      className={cn(
        'grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40',
        pinned
          ? 'bg-slate-900/[0.06] text-slate-800 dark:bg-white/[0.08] dark:text-slate-100'
          : 'text-slate-400 hover:bg-slate-900/[0.04] hover:text-slate-600 dark:text-slate-500 dark:hover:bg-white/[0.05] dark:hover:text-slate-300',
      )}
    >
      {/* Upright and filled when pinned; tilted and hollow when the panel only follows the pointer. */}
      <PushPinIcon
        className={cn('h-4 w-4 transition-transform', pinned ? 'fill-current' : 'rotate-45')}
      />
    </button>
  );
};
