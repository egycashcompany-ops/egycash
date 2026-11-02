// A long form's sections, made easy to move through: each section is a card with an icon tile, its
// number and a clear title; `FormSectionNav` is a sticky strip of the same sections that shows where
// the reader is and jumps to any of them. Colours are the app's own (brand + slate) — this changes
// how a long form reads, not how the product looks.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface FormSectionItem {
  id: string;
  label: string;
  icon: ReactNode;
}

export const FormSection = ({
  id,
  index,
  icon,
  title,
  description,
  actions,
  children,
}: {
  id: string;
  index: number;
  icon: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}): JSX.Element => (
  <section
    id={id}
    className="scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card transition-shadow focus-within:shadow-md dark:border-slate-800 dark:bg-slate-900"
  >
    <header className="flex items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-l from-slate-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-slate-800/40 dark:to-slate-900">
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 dark:bg-brand-950/60 dark:text-brand-300 dark:ring-brand-900">
          {icon}
          <span className="absolute -end-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
            {index}
          </span>
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-bold text-slate-800 dark:text-slate-100">
            {title}
          </h3>
          {description !== undefined && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>
          )}
        </div>
      </div>
      {actions !== undefined && <div className="shrink-0">{actions}</div>}
    </header>
    {children}
  </section>
);

/** The element that scrolls `el` — the app shell's main pane, or the page itself. */
const scrollParent = (el: HTMLElement): HTMLElement | null => {
  for (let p = el.parentElement; p !== null; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
};

/** Gap kept between the bar and a section's top after a jump. */
const JUMP_GAP = 12;

/** Sticky chips for the form's sections: the one on screen is highlighted; a click jumps to it. */
export const FormSectionNav = ({ items }: { items: FormSectionItem[] }): JSX.Element => {
  const [active, setActive] = useState(items[0]?.id ?? '');
  const navRef = useRef<HTMLElement>(null);
  // While a jump's smooth scroll runs, the sections it passes must not steal the highlight.
  const jumping = useRef<string | null>(null);
  // Keyed on the ids, not the array: the host form re-renders on every keystroke and hands a new
  // array each time, which must not tear the listener down and rebuild it.
  const ids = items.map((item) => item.id).join('|');

  useEffect(() => {
    const order = ids.split('|');
    let frame = 0;
    let settle = 0;
    // The section being read is the last one whose top has reached the bar's bottom edge; at the
    // very end of the page it is the last section, which may be too short to ever reach the bar.
    const track = (): void => {
      frame = 0;
      const nav = navRef.current;
      if (nav === null) return;
      // A jump keeps the chip that was clicked lit, even for a short section near the end that
      // can never reach the bar; tracking resumes with the reader's own next scroll.
      if (jumping.current !== null) {
        window.clearTimeout(settle);
        settle = window.setTimeout(() => {
          jumping.current = null;
        }, 150);
        return;
      }
      const line = nav.getBoundingClientRect().bottom + JUMP_GAP + 8;
      const scroller = scrollParent(nav);
      const atEnd =
        scroller === null
          ? window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
          : scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      let current = order[0] ?? '';
      for (const id of order) {
        const el = document.getElementById(id);
        if (el !== null && el.getBoundingClientRect().top <= line) current = id;
      }
      setActive(atEnd ? (order[order.length - 1] ?? current) : current);
    };
    const onScroll = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(track);
    };
    // Captured on the document, so it hears whichever element actually scrolls.
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll);
    track();
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [ids]);

  // Keep the highlighted chip in view inside the bar on narrow screens. Only the strip moves:
  // `scrollIntoView` would also scroll the page and cut short a jump's smooth scroll.
  useEffect(() => {
    const chip = navRef.current?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    const strip = chip?.closest('ol');
    if (chip == null || strip == null) return;
    const c = chip.getBoundingClientRect();
    const s = strip.getBoundingClientRect();
    if (c.left < s.left) strip.scrollLeft -= s.left - c.left + 8;
    else if (c.right > s.right) strip.scrollLeft += c.right - s.right + 8;
  }, [active]);

  const jump = (id: string): void => {
    const nav = navRef.current;
    const el = document.getElementById(id);
    if (nav === null || el === null) return;
    setActive(id);
    jumping.current = id;
    // Land the section's top just under the bar where it sticks — not where it sits now, which
    // is lower down until the page has scrolled past the reader card above it.
    const scroller = scrollParent(nav);
    const stuckBottom =
      (scroller === null ? 0 : scroller.getBoundingClientRect().top) +
      (parseFloat(getComputedStyle(nav).top) || 0) +
      nav.offsetHeight;
    const delta = el.getBoundingClientRect().top - stuckBottom - JUMP_GAP;
    if (scroller === null) window.scrollBy({ top: delta, behavior: 'smooth' });
    else scroller.scrollBy({ top: delta, behavior: 'smooth' });
    // If nothing can scroll (already there, or the page's end), no scroll event clears the lock.
    const top = scroller === null ? window.scrollY : scroller.scrollTop;
    window.setTimeout(() => {
      const now = scroller === null ? window.scrollY : scroller.scrollTop;
      if (jumping.current === id && Math.abs(now - top) < 1) jumping.current = null;
    }, 100);
  };

  return (
    <nav
      ref={navRef}
      className="sticky top-2 z-20 rounded-2xl border border-slate-200 bg-white/90 p-1.5 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/90"
    >
      <ol className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {items.map((item, i) => (
          <li key={item.id} className="shrink-0">
            <button
              type="button"
              data-section={item.id}
              aria-current={active === item.id ? 'location' : undefined}
              onClick={() => jump(item.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors',
                active === item.id
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[10px]',
                  active === item.id ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-800',
                )}
              >
                {i + 1}
              </span>
              {item.label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
};
