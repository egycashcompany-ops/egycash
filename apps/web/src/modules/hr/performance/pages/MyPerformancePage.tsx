// «كيف كان أدائي» — the employee's own finalized reviews (P-HR-PRF D15).
//
// SELF-SERVICE, SO NO PERMISSION AND NO NAVIGATION ROW — the same stance My Attendance takes, and
// `seed-navigation.ts` says why in as many words: it is reachable by every employee login rather
// than by a key. Gating it on `performanceReview.view` would mean somebody could read their own
// assessment only if they could also read everybody's.
//
// FINALIZED ONLY, AND THE SERVER DECIDES THAT. There is no status filter here because there is
// none there: a draft is the evaluator thinking and a submitted review is somebody else's to
// decide, and showing either would turn an assessment into a negotiation.
//
// NO TREND, NO COMPARISON, NO CHART. A line drawn through two ratings is a derived claim about a
// person — «improving», «declining» — made by arithmetic rather than by anybody who watched them
// work. It is the same claim D8 refuses inside a single review, and it does not become true by
// being drawn across several.
import { type Locale, type PerformanceReviewDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Card } from '../../../../shared/ui/Card';
import { Pagination } from '../../../../shared/ui/Pagination';
import { Spinner } from '../../../../shared/ui/Spinner';
import { formatDate } from '../../../../shared/lib/format';
import { useMyPerformanceReviews } from '../api/performance-queries';
import { useSearchParams } from 'react-router-dom';

const PAGE_SIZE = 10;

const ReviewCard = ({
  review,
  locale,
}: {
  review: PerformanceReviewDto;
  locale: Locale;
}): JSX.Element => {
  const t = useT();
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
          {locale === 'ar' ? review.cycleName.ar : review.cycleName.en}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {review.finalizedAt === null ? '' : formatDate(review.finalizedAt, locale)}
        </span>
      </div>

      {/* The rating as the evaluator entered it. No scale printed beside it here — the round's
          name is what identifies which ruler was used, and inventing «/5» from a number the page
          does not have would be worse than showing the number alone. */}
      {review.rating !== null && (
        <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100" dir="ltr">
          {review.rating}
        </p>
      )}

      {review.evaluatorName !== null && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {`${t('performance.review.evaluator')}: ${review.evaluatorName}`}
        </p>
      )}

      {review.strengths !== null && (
        <div className="mt-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('performance.review.strengths')}
          </p>
          <p className="text-sm text-slate-700 dark:text-slate-200">{review.strengths}</p>
        </div>
      )}
      {review.improvements !== null && (
        <div className="mt-2">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('performance.review.improvements')}
          </p>
          <p className="text-sm text-slate-700 dark:text-slate-200">{review.improvements}</p>
        </div>
      )}
    </Card>
  );
};

export const MyPerformancePage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const { data, isLoading } = useMyPerformanceReviews({ page, pageSize: PAGE_SIZE });
  const reviews = data?.items ?? [];

  return (
    <PageContainer>
      <PageHeader
        title={t('performance.mine.title')}
        description={t('performance.mine.subtitle')}
      />

      {isLoading && (
        <div className="grid place-items-center py-12">
          <Spinner />
        </div>
      )}

      {!isLoading && reviews.length === 0 && (
        <Card>
          {/* «None yet» rather than «none»: a round in progress has no finalized review, and the
              wording must not read as «nobody has assessed you». */}
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('performance.mine.none')}</p>
        </Card>
      )}

      <div className="space-y-3">
        {reviews.map((review) => (
          <ReviewCard key={review.id} review={review} locale={locale} />
        ))}
      </div>

      {data !== undefined && data.meta.totalItems > PAGE_SIZE && (
        <div className="mt-4">
          <Pagination
            meta={data.meta}
            onPageChange={(p) => {
              const next = new URLSearchParams(sp);
              next.set('page', String(p));
              setSp(next);
            }}
          />
        </div>
      )}
    </PageContainer>
  );
};
