// الإخطارات — «اول ما اخش اختار النماذج»: the screen opens on the insurers' forms and nothing
// else. Picking one opens it to be filled.
import { Link } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { NOTICE_TEMPLATES } from '../lib/notice-templates';

export const NoticesPage = (): JSX.Element => {
  const t = useT();
  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.notices')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.notices') },
        ]}
      />
      <h2 className="mb-4 text-base font-semibold text-slate-800 dark:text-slate-100">
        {t('fleet.notices.choose')}
      </h2>
      <div className="flex flex-wrap gap-5">
        {NOTICE_TEMPLATES.map((template) => (
          <Link
            key={template.key}
            to={`/fleet/notices/${template.key}`}
            data-notice-template={template.key}
            className="w-64 rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm transition hover:border-brand-400 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-slate-800 dark:bg-slate-900"
          >
            <img
              src={template.pages[0]}
              alt=""
              className="w-full rounded-md border border-slate-200 dark:border-slate-700"
            />
            <span className="mt-3 block text-base font-bold text-slate-800 dark:text-slate-100">
              {template.insurer}
            </span>
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
              {template.title} ·{' '}
              {t('fleet.notices.pageCount', { count: String(template.pages.length) })}
            </span>
          </Link>
        ))}
      </div>
    </PageContainer>
  );
};
