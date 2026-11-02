// The «الإعدادات» tab bar: one rounded strip, and a pill that SLIDES under the open section.
//
// «خد منه الألوان (بس خليه بالشكل دا)». The colours are the Fleet home bar's (dash-shell.tsx): the
// white strip with its soft shadow, the brand circle at its head, brand-600 under the pressed
// section with white text on it. The shape is the sliding «glider» the owner pointed at: the
// highlight is ONE element that moves from section to section, rather than each section lighting
// up on its own.
//
// Each section is a LINK, not a button: the sections are pages with their own addresses, so a
// section can be bookmarked, opened in a new tab and reached with Back. The bar sits in the layout
// above them and stays mounted while they change, which is what lets the pill travel.
//
// The pill is measured, not computed: Arabic labels are of every width, so it takes the open
// link's offset and width, again whenever the strip resizes (a narrow screen, the fonts arriving).
// Until it has a measurement — the first paint, or a renderer with no layout — the open link paints
// its own brand background, so the pressed section is never shown unpressed.
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../../../shared/lib/cn';
import { CogIcon } from '../../../../shared/ui/icons';

export interface SettingsTab {
  key: string;
  label: string;
  to: string;
  group: string;
}

/** Fleet's bar (dash-shell.tsx NAV_BAR) — white strip, soft shadow, its dark twin. */
const BAR = cn(
  'flex min-h-14 items-center gap-2 rounded-full border p-1.5',
  'border-slate-200/80 bg-white shadow-[0_12px_32px_-14px_rgba(15,23,42,.28),0_2px_6px_-2px_rgba(15,23,42,.06)]',
  'dark:border-[rgba(42,58,84,.65)] dark:bg-[#121a2a] dark:shadow-[0_14px_34px_-12px_rgba(0,0,0,.75),inset_0_1px_0_0_rgba(255,255,255,.05)]',
);
/** Fleet's pressed tab: brand, white text — worn by the pill, or by the link until it is measured. */
const PRESSED = 'bg-brand-600 shadow-md shadow-brand-700/30';

interface Glide {
  x: number;
  w: number;
}

export const SettingsTabBar = ({
  tabs,
  active,
  label,
  groupLabel,
}: {
  tabs: readonly SettingsTab[];
  /** The open section's key; a key no tab carries leaves the pill hidden. */
  active: string | null;
  /** The bar's accessible name. */
  label: string;
  groupLabel: (group: string) => string;
}): JSX.Element => {
  const strip = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [glide, setGlide] = useState<Glide | null>(null);
  // Re-measure when the set of sections or their labels change, not only when the open one does.
  const shape = tabs.map((tab) => `${tab.key}:${tab.label}`).join('|');

  useLayoutEffect(() => {
    const box = row.current;
    if (box === null) return undefined;
    let live = true;
    const measure = (): void => {
      if (!live) return;
      const pill = box.querySelector<HTMLElement>('[aria-current="page"]');
      setGlide(
        pill === null || pill.offsetWidth === 0 ? null : { x: pill.offsetLeft, w: pill.offsetWidth },
      );
    };
    measure();
    const watcher = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    watcher?.observe(box);
    void document.fonts?.ready.then(measure);
    return () => {
      live = false;
      watcher?.disconnect();
    };
  }, [active, shape]);

  // On a narrow screen the strip scrolls sideways: bring the open section into it, sideways only
  // (the page itself never moves) — the same reveal the Fleet bar does.
  useEffect(() => {
    const box = strip.current;
    const pill = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (box === null || box === undefined || pill === null || pill === undefined) return;
    const outer = box.getBoundingClientRect();
    const inner = pill.getBoundingClientRect();
    if (inner.left < outer.left) box.scrollLeft -= outer.left - inner.left + 8;
    else if (inner.right > outer.right) box.scrollLeft += inner.right - outer.right + 8;
  }, [active, shape]);

  // Consecutive tabs of one group, in order: the bar draws a divider where the group changes.
  const groups: SettingsTab[][] = [];
  for (const tab of tabs) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last[0]?.group === tab.group) last.push(tab);
    else groups.push([tab]);
  }
  const measured = glide !== null;

  return (
    <nav aria-label={label} data-settings-bar="true" className={BAR}>
      <span
        aria-hidden="true"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600 text-white shadow-md shadow-brand-700/30"
      >
        <CogIcon className="h-5 w-5" />
      </span>
      {/* Centred while the sections fit; once they overflow the auto margins fall to zero, so every
          section can be scrolled to (a centred overflow would push the first ones out of reach). */}
      <div ref={strip} className="flex min-w-0 flex-1 items-center overflow-x-auto">
        <div ref={row} className="relative mx-auto flex shrink-0 items-center gap-1">
          <span
            aria-hidden="true"
            data-settings-glider="true"
            className={cn(
              'pointer-events-none absolute left-0 top-0 h-11 rounded-full',
              'transition-[transform,width] duration-[250ms] ease-out motion-reduce:transition-none',
              PRESSED,
              measured ? 'opacity-100' : 'opacity-0',
            )}
            style={measured ? { width: glide.w, transform: `translateX(${String(glide.x)}px)` } : undefined}
          />
          {groups.map((group, index) => (
            <Fragment key={group[0]?.group ?? index}>
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className="mx-1 h-6 w-px shrink-0 bg-slate-200 dark:bg-[#26324a]"
                />
              )}
              <div
                role="group"
                aria-label={groupLabel(group[0]?.group ?? '')}
                data-settings-group={group[0]?.group}
                className="flex items-center gap-1"
              >
                {group.map((tab) => {
                  const on = tab.key === active;
                  return (
                    <Link
                      key={tab.key}
                      to={tab.to}
                      aria-current={on ? 'page' : undefined}
                      data-settings-tab={tab.key}
                      className={cn(
                        // Above the pill, which sits in the same row.
                        'relative z-10 inline-flex h-11 shrink-0 items-center whitespace-nowrap rounded-full px-4 text-[14px] font-semibold leading-5 transition-colors duration-[250ms]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-1',
                        on
                          ? cn('text-white', !measured && PRESSED)
                          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.07] dark:hover:text-white',
                      )}
                    >
                      {tab.label}
                    </Link>
                  );
                })}
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </nav>
  );
};
