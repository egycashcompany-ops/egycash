// The ⌘K command palette — the fastest, most scalable way to navigate an ERP with dozens of modules
// and hundreds of pages: type to jump to any application (across every module), or switch modules.
// Keyboard-first (↑/↓/↵/esc), portal-rendered, RTL-safe. Pure UI over the existing nav data.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../store';
import { useT } from '../localization/useT';
import { cn } from '../../shared/lib/cn';
import { localized } from '../../shared/lib/format';
import { CornerDownIcon, FileIcon, SearchIcon } from '../../shared/ui/icons';
import { useMyApplications } from './me-applications-queries';
import { resolveNavIcon } from './app-icon';
import { flattenApps, moduleColor, monogram, toModules, type NavApp } from './nav-model';
import { useNavPrefs } from './NavPrefs';

interface Item {
  key: string;
  group: 'recent' | 'apps' | 'modules';
  title: string;
  subtitle: string;
  monogramColor?: string;
  icon?: string;
  run: () => void;
}

export const CommandPalette = ({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const { data = [] } = useMyApplications();
  const { recent, recordRecent } = useNavPrefs();

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const apps = useMemo(() => flattenApps(data), [data]);
  const modules = useMemo(() => toModules(data), [data]);

  const go = (app: NavApp): void => {
    recordRecent(app.id);
    navigate(app.route);
    onClose();
  };

  const items = useMemo<Item[]>(() => {
    const term = query.trim().toLowerCase();
    const appItem = (a: NavApp, group: 'recent' | 'apps'): Item => ({
      key: `${group}:${a.id}`,
      group,
      title: localized(a.name, locale),
      subtitle: localized(a.moduleName, locale),
      icon: a.icon,
      run: () => go(a),
    });

    if (term === '') {
      const recents = recent
        .map((id) => apps.find((a) => a.id === id))
        .filter((a): a is NavApp => a !== undefined)
        .map((a) => appItem(a, 'recent'));
      const mods = modules
        .filter((m) => m.apps.length > 0)
        .map<Item>((m) => ({
          key: `mod:${m.id}`,
          group: 'modules',
          title: localized(m.name, locale),
          subtitle: t('nav.command.module'),
          monogramColor: moduleColor(m.id),
          run: () => go({ ...m.apps[0]!, moduleId: m.id, moduleName: m.name }),
        }));
      return [...recents, ...mods];
    }

    const matchedApps = apps
      .filter(
        (a) =>
          localized(a.name, locale).toLowerCase().includes(term) ||
          localized(a.moduleName, locale).toLowerCase().includes(term),
      )
      .map((a) => appItem(a, 'apps'));
    const matchedMods = modules
      .filter((m) => m.apps.length > 0 && localized(m.name, locale).toLowerCase().includes(term))
      .map<Item>((m) => ({
        key: `mod:${m.id}`,
        group: 'modules',
        title: localized(m.name, locale),
        subtitle: t('nav.command.module'),
        monogramColor: moduleColor(m.id),
        run: () => go({ ...m.apps[0]!, moduleId: m.id, moduleName: m.name }),
      }));
    return [...matchedApps, ...matchedMods];
  }, [query, apps, modules, recent, locale, t]);

  // Reset + focus each time it opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
    // Keyed on `open` only: re-running on an unrelated parent re-render would wipe the query.
  }, [open]);

  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  if (!open) return null;

  const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[active]?.run();
    }
  };

  const groupLabel: Record<Item['group'], string> = {
    recent: t('nav.command.recent'),
    apps: t('nav.command.applications'),
    modules: t('nav.command.modules'),
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('nav.command.placeholder')}
        className="relative flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 dark:border-slate-800">
          <SearchIcon className="h-5 w-5 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            placeholder={t('nav.command.placeholder')}
            className="h-14 w-full bg-transparent text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
            aria-label={t('nav.command.placeholder')}
          />
          <kbd className="hidden shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 dark:border-slate-700 sm:inline">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-2">
          {items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400">{t('nav.command.empty')}</p>
          ) : (
            items.map((item, i) => {
              const showHeader = i === 0 || items[i - 1]!.group !== item.group;
              const isActive = i === active;
              const Icon = item.icon !== undefined ? resolveNavIcon(item.icon, FileIcon) : null;
              return (
                <div key={item.key}>
                  {showHeader && (
                    <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      {groupLabel[item.group]}
                    </p>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => item.run()}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2 text-start',
                      isActive ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                    )}
                  >
                    {item.monogramColor !== undefined ? (
                      <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white', item.monogramColor)}>
                        {monogram(item.title)}
                      </span>
                    ) : Icon !== null ? (
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-800 dark:text-slate-100">{item.title}</span>
                      <span className="block truncate text-xs text-slate-400">{item.subtitle}</span>
                    </span>
                    {isActive && <CornerDownIcon className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400 dark:border-slate-800">
          <span>↑↓ {t('nav.command.hintMove')}</span>
          <span>↵ {t('nav.command.hintOpen')}</span>
          <span>esc {t('nav.command.hintClose')}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
};
