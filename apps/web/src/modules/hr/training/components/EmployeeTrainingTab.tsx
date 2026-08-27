// The employee profile's Training tab (P-HR-TRN, T5) — default export, lazy-loaded by the profile
// hub exactly as the Loans and Attendance tabs are, so the employees chunk stays free of this
// feature for everyone who never opens it.
//
// TWO LISTS, IN THIS ORDER, AND THE ORDER IS THE ANSWER TO A QUESTION. «What has this person been
// taught» is what somebody opening this tab almost always means — a manager deciding whether to
// put them on a run, an auditor asking what the company can prove. «What are they booked on» is
// the smaller, more perishable question, so it sits underneath.
//
// BOTH READ EXISTING ENDPOINTS. Records filter by `employeeId`, seats filter by `employeeId`, and
// both already did before this tab existed. No API was added to make this screen possible, which
// is the shape a profile tab should have: it asks the same questions the module's own screens ask,
// narrowed to one person.
//
// NOTHING HERE IS EDITABLE. A record is never revised (D8), and a seat is granted or taken back
// from the session that owns it — offering either here would be a second door onto a decision that
// already has one.
import { type EmployeeDto, type Locale, type TrainingEnrollmentDto, type TrainingRecordDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Badge, DataTable, EmptyState, type Column } from '../../../../shared/ui';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { formatDate } from '../../../../shared/lib/format';
import { useTrainingEnrollments, useTrainingRecords } from '../api/training-queries';

const PAGE_SIZE = 20;

/** The seats they hold that have not been settled yet — what is still ahead of them. */
const UPCOMING = ['enrolled'] as const;

export default function EmployeeTrainingTab({ employee }: { employee: EmployeeDto }): JSX.Element {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  const records = useTrainingRecords({ employeeId: employee.id, page: 1, pageSize: PAGE_SIZE });
  const seats = useTrainingEnrollments({
    employeeId: employee.id,
    page: 1,
    pageSize: PAGE_SIZE,
    status: UPCOMING[0],
  });

  const recordColumns: Column<TrainingRecordDto>[] = [
    {
      key: 'course',
      header: t('training.session.course'),
      // The record's own copy of the name — D8 on screen. Renaming the course changes nothing here.
      render: (r) => <span>{locale === 'ar' ? r.courseNameAr : r.courseNameEn}</span>,
    },
    {
      key: 'completedAt',
      header: t('training.record.completedAt'),
      render: (r) => <span>{formatDate(r.completedAt, locale)}</span>,
    },
    {
      key: 'expiresAt',
      header: t('training.record.expiresAt'),
      // Shown because it is on the paper. Not coloured, not sorted on, not counted (D10).
      render: (r) => <span>{r.expiresAt === null ? '—' : formatDate(r.expiresAt, locale)}</span>,
    },
    {
      key: 'certificate',
      header: t('training.record.certificate'),
      render: (r) => (
        <Badge tone={r.certificateFileName === null ? 'neutral' : 'success'}>
          {t(r.certificateFileName === null ? 'training.record.noCertificate' : 'training.record.held')}
        </Badge>
      ),
    },
  ];

  const seatColumns: Column<TrainingEnrollmentDto>[] = [
    { key: 'course', header: t('training.session.course'), render: (s) => <span>{s.courseKey}</span> },
    {
      key: 'session',
      header: t('training.session.code'),
      render: (s) => (
        <span className="font-mono text-xs" dir="ltr">
          {s.sessionCode}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('training.statusColumn'),
      render: (s) => <Badge tone="info">{t(`training.enrollment.status.${s.status}`)}</Badge>,
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t('training.tab.history')} description={t('training.tab.historyHint')} />
        <CardBody>
          {records.data !== undefined && records.data.items.length === 0 ? (
            <EmptyState title={t('training.tab.noHistory')} />
          ) : (
            <DataTable
              columns={recordColumns}
              rows={records.data?.items ?? []}
              rowKey={(r) => r.id}
              loading={records.isLoading}
              error={records.isError ? records.error : undefined}
              onRetry={() => void records.refetch()}
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('training.tab.upcoming')} description={t('training.tab.upcomingHint')} />
        <CardBody>
          {seats.data !== undefined && seats.data.items.length === 0 ? (
            <EmptyState title={t('training.tab.noUpcoming')} />
          ) : (
            <DataTable
              columns={seatColumns}
              rows={seats.data?.items ?? []}
              rowKey={(s) => s.id}
              loading={seats.isLoading}
              error={seats.isError ? seats.error : undefined}
              onRetry={() => void seats.refetch()}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
