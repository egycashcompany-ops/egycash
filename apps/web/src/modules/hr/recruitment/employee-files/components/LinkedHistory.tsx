// The linked recruitment history (BD-008 — "link all applicant history"): deep-links from the
// Electronic Employee File into the applicant, screening, interviews, offer and hiring-documents
// screens. The Job Requisition has no frontend screen yet, so it shows as a read-only reference.
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { type EmployeeFileLinksDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';

const Row = ({ label, children }: { label: string; children: ReactNode }): JSX.Element => (
  <div className="flex flex-wrap items-center justify-between gap-2 py-2">
    <span className="text-xs text-slate-400">{label}</span>
    <span className="flex flex-wrap items-center gap-2 text-sm">{children}</span>
  </div>
);

const RefLink = ({ to, label }: { to: string; label: string }): JSX.Element => (
  <Link to={to} className="text-brand-600 hover:underline">{label}</Link>
);

export const LinkedHistory = ({ links }: { links: EmployeeFileLinksDto }): JSX.Element => {
  const t = useT();
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      <Row label={t('employeeFiles.links.applicant')}>
        <RefLink to={`/applicants/${links.applicantId}`} label={t('employeeFiles.links.open')} />
      </Row>
      <Row label={t('employeeFiles.links.screening')}>
        {links.screeningId === null ? (
          <span className="text-slate-400">—</span>
        ) : (
          <RefLink to={`/screening/${links.screeningId}`} label={t('employeeFiles.links.open')} />
        )}
      </Row>
      <Row label={t('employeeFiles.links.interviews')}>
        {links.interviewIds.length === 0 ? (
          <span className="text-slate-400">—</span>
        ) : (
          links.interviewIds.map((id, i) => (
            <RefLink key={id} to={`/interviews/${id}`} label={`#${i + 1}`} />
          ))
        )}
      </Row>
      <Row label={t('employeeFiles.links.offer')}>
        {links.jobOfferId === null ? (
          <span className="text-slate-400">—</span>
        ) : (
          <RefLink to={`/job-offers/${links.jobOfferId}`} label={t('employeeFiles.links.open')} />
        )}
      </Row>
      <Row label={t('employeeFiles.links.hiringDocuments')}>
        <RefLink to={`/hiring-documents/${links.hiringDocumentsId}`} label={t('employeeFiles.links.open')} />
      </Row>
      <Row label={t('employeeFiles.links.requisition')}>
        <span className="font-mono text-xs text-slate-400" dir="ltr">#{links.jobRequisitionId.slice(-6)}</span>
      </Row>
    </div>
  );
};
