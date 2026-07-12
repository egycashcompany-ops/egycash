// Recruitment sidebar: a persistent rail on desktop (lg+) and an off-canvas drawer on mobile
// (driven by ui.sidebarOpen). Nav items are permission-filtered (UX only). Fully RTL-safe via
// logical borders/spacing; the drawer slides from the reading-start edge.
import { NavLink } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../store';
import { setSidebarOpen } from '../../store/uiSlice';
import { useCan } from '../rbac/Can';
import { useT } from '../localization/useT';
import { cn } from '../../shared/lib/cn';
import { CloseIcon } from '../../shared/ui/icons';
import { type NavSection } from '../navigation/nav';

const NavList = ({ nav, onNavigate }: { nav: NavSection[]; onNavigate: () => void }): JSX.Element => {
  const t = useT();
  const can = useCan();
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {nav.map((section, i) => {
        const items = section.items.filter((item) => item.permission === undefined || can(item.permission));
        if (items.length === 0) return null;
        return (
          <div key={section.titleKey ?? `section-${i}`}>
            {section.titleKey !== undefined && (
              <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {t(section.titleKey)}
              </p>
            )}
            <ul className="space-y-1">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end ?? false}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200'
                            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                        )
                      }
                    >
                      {Icon !== undefined && <Icon className="h-5 w-5 shrink-0" />}
                      <span className="truncate">{t(item.labelKey)}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
};

const Brand = ({ titleKey }: { titleKey: string }): JSX.Element => {
  const t = useT();
  return (
    <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-5 dark:border-slate-800">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
        E
      </span>
      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t(titleKey)}</span>
    </div>
  );
};

export const Sidebar = ({ nav, titleKey }: { nav: NavSection[]; titleKey: string }): JSX.Element => {
  const t = useT();
  const dispatch = useAppDispatch();
  const open = useAppSelector((state) => state.ui.sidebarOpen);
  const close = (): void => {
    dispatch(setSidebarOpen(false));
  };

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden w-64 shrink-0 flex-col border-e border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:flex">
        <Brand titleKey={titleKey} />
        <NavList nav={nav} onNavigate={() => undefined} />
      </aside>

      {/* Mobile drawer */}
      <div className={cn('fixed inset-0 z-40 lg:hidden', open ? '' : 'pointer-events-none')} aria-hidden={!open}>
        <div
          className={cn(
            'absolute inset-0 bg-slate-900/50 transition-opacity',
            open ? 'opacity-100' : 'opacity-0',
          )}
          onClick={close}
        />
        <aside
          className={cn(
            'absolute inset-y-0 start-0 flex w-72 max-w-[80%] flex-col bg-white shadow-xl transition-transform dark:bg-slate-900',
            open ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full',
          )}
          role="dialog"
          aria-modal="true"
          aria-label={t(titleKey)}
        >
          <div className="flex items-center justify-between border-b border-slate-200 pe-2 dark:border-slate-800">
            <Brand titleKey={titleKey} />
            <button
              type="button"
              onClick={close}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={t('common.close')}
            >
              <CloseIcon />
            </button>
          </div>
          <NavList nav={nav} onNavigate={close} />
        </aside>
      </div>
    </>
  );
};
