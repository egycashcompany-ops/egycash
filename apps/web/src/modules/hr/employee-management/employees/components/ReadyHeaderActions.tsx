// The head of «جاهزون للتعيين» and «المعينون» — A28: «عاوز نرجع ال زرار بتاع مستندات الوظائف لوحده زي مكان
// و عاوز ال toggle slider يبقا بين جاهزون للتعيين و المعينون و … ميكنش ال tggole background اخده الصفحه
// كلها لا هو عاوزين يبقا اخد مساحه صغيره فوق الزرار بتاع المستندات».
//
// A small sliding toggle — the HR settings bar in its compact form — between the two lists, each a
// link with its own address; beside it, with room between («جمب المستندات مش فوقو و متخلهوش لازق
// فيه»), «مستندات الوظائف», the button that opens its popup, as before.
// «المعينون» is offered only to who may print; the button only to who may change the templates.
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useT } from '../../../../../platform/localization/useT';
import { Can, useCan } from '../../../../../platform/rbac/Can';
import { Button } from '../../../../../shared/ui/Button';
import { SettingsTabBar, type SettingsTab } from '../../../settings/components/SettingsTabBar';
import { JobPapersDialog } from '../../../contracts/components/JobPapersDialog';

export const READY_ROUTE = '/employees/ready';
export const HIRED_ROUTE = '/employees/ready/hired';

/** The list `pathname` shows: «المعينون» under its own address, else «جاهزون للتعيين». */
export const readyViewOf = (pathname: string): 'ready' | 'hired' =>
  pathname.replace(/\/+$/, '') === HIRED_ROUTE ? 'hired' : 'ready';

export const ReadyHeaderActions = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const { pathname } = useLocation();
  const [jobPapers, setJobPapers] = useState(false);
  const tabs: SettingsTab[] = [
    { key: 'ready', label: t('employees.ready.title'), to: READY_ROUTE, group: 'ready' },
    ...(can('contract.print')
      ? [{ key: 'hired', label: t('employees.hired.title'), to: HIRED_ROUTE, group: 'ready' }]
      : []),
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2" data-ready-actions>
      {tabs.length > 1 && (
        <SettingsTabBar
          compact
          tabs={tabs}
          active={readyViewOf(pathname)}
          label={t('employees.readyHub.label')}
          groupLabel={() => t('employees.readyHub.label')}
        />
      )}
      <Can permission="contractTemplate.manage">
        <Button variant="secondary" onClick={() => setJobPapers(true)} data-job-papers-open>
          {t('employees.ready.jobPapers')}
        </Button>
        <JobPapersDialog open={jobPapers} onClose={() => setJobPapers(false)} />
      </Can>
    </div>
  );
};
