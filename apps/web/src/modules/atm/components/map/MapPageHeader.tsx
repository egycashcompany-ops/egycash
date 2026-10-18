// «خريطة الماكينات»'s header (docs/12-planning/atm-map-zones.md §8.3): the title with the four
// figures and the two actions in view mode — and in edit mode the title ALONE, no figures and no
// actions (`Edit.dc.html:62-64`): while zones are being changed, counts of the view and a way to
// another screen are the wrong things to offer. No subtitle in either (`PageContainer.tsx`).
import { type ReactNode } from 'react';
import { PageHeader } from '../../../../platform/layout/PageContainer';

export const MapPageHeader = ({
  title,
  editing,
  figures,
  actions,
}: {
  title: string;
  editing: boolean;
  figures: ReactNode;
  actions: ReactNode;
}): JSX.Element =>
  editing ? (
    <PageHeader title={title} />
  ) : (
    <PageHeader title={title} figures={figures} actions={actions} />
  );
