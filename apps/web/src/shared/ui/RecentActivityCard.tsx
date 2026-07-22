// Recent-activity panel for module home pages. A UI-only placeholder for now — it shows the panel
// and its empty state; no activity feed is wired to the backend yet.
import { useT } from '../../platform/localization/useT';
import { Card, CardBody, CardHeader } from './Card';
import { EmptyState } from './states/EmptyState';

export const RecentActivityCard = (): JSX.Element => {
  const t = useT();
  return (
    <Card className="h-full">
      <CardHeader title={t('home.recentActivity.title')} />
      <CardBody>
        <EmptyState
          title={t('home.recentActivity.emptyTitle')}
          description={t('home.recentActivity.emptyBody')}
        />
      </CardBody>
    </Card>
  );
};
