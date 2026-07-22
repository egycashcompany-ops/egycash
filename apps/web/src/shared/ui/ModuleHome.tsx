// Shared module-home layout: a KPI overview row (placeholder tiles for now), a quick-access grid of
// shortcut cards, and a recent-activity panel. Every module home (Recruitment, Organization, …)
// composes this so they stay visually identical. Items are already permission-filtered and localized
// by the caller.
import { type ComponentType, type SVGProps } from 'react';
import { useT } from '../../platform/localization/useT';
import { Card, CardBody } from './Card';
import { EmptyState } from './states/EmptyState';
import { ShortcutCard } from './ShortcutCard';
import { StatCard } from './StatCard';
import { RecentActivityCard } from './RecentActivityCard';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export interface ModuleShortcut {
  to: string;
  title: string;
  description: string;
  icon: Icon;
}

export interface ModuleKpi {
  label: string;
  icon: Icon;
}

const SectionHeading = ({ children }: { children: string }): JSX.Element => (
  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
    {children}
  </h2>
);

export const ModuleHome = ({
  shortcuts,
  kpis,
  emptyTitle,
  emptyBody,
}: {
  shortcuts: ModuleShortcut[];
  kpis: ModuleKpi[];
  emptyTitle: string;
  emptyBody: string;
}): JSX.Element => {
  const t = useT();

  if (shortcuts.length === 0) {
    return (
      <Card>
        <CardBody>
          <EmptyState title={emptyTitle} description={emptyBody} />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {kpis.length > 0 && (
        <section className="space-y-3">
          <SectionHeading>{t('home.overview')}</SectionHeading>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((k) => (
              <StatCard key={k.label} label={k.label} icon={k.icon} caption={t('home.kpi.placeholder')} />
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2">
          <SectionHeading>{t('home.quickAccess')}</SectionHeading>
          <div className="grid gap-4 sm:grid-cols-2">
            {shortcuts.map((s) => (
              <ShortcutCard key={s.to} to={s.to} title={s.title} description={s.description} icon={s.icon} />
            ))}
          </div>
        </section>
        <aside className="lg:col-span-1">
          <RecentActivityCard />
        </aside>
      </div>
    </div>
  );
};
