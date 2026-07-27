// A23 — the PUBLIC verification page the PDF's QR opens. No authentication: the
// SHA-256 key in the URL is bound to the exact issued snapshot and the verdict
// carries no personal data — it confirms authenticity, nothing more.
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { type ContractVerificationDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { BrandMark, Card, CardBody, LoadingState } from '../../../../shared/ui';
import { formatDateTime } from '../../../../shared/lib/format';
import { get, buildQuery } from '../../../../shared/lib/api-client';

const fetchVerdict = (code: string, key: string): Promise<ContractVerificationDto> =>
  get<ContractVerificationDto>(`/hr/contracts/verify${buildQuery({ code, key })}`);

export const VerifyContractPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp] = useSearchParams();
  const code = sp.get('code') ?? '';
  const key = sp.get('key') ?? '';
  const usable = code !== '' && /^[a-f0-9]{64}$/.test(key);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['hr', 'contracts', 'verify', code, key],
    queryFn: () => fetchVerdict(code, key),
    enabled: usable,
    retry: 1,
  });

  const verdict = usable ? data : { valid: false };

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><BrandMark /></div>
        <Card>
          <CardBody>
            <h1 className="mb-4 text-center text-lg font-semibold">{t('contracts.verify.title')}</h1>
            {usable && isLoading ? (
              <LoadingState />
            ) : isError ? (
              <p className="text-center text-sm text-slate-500">{t('contracts.verify.error')}</p>
            ) : verdict?.valid === true ? (
              <div className="space-y-3">
                <p className="rounded-lg bg-emerald-50 px-4 py-3 text-center font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  ✓ {t('contracts.verify.valid')}
                </p>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400">{t('contracts.columns.code')}</dt>
                    <dd className="font-mono" dir="ltr">{verdict.code}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400">{t('contracts.columns.version')}</dt>
                    <dd className="font-mono">v{verdict.contractVersion}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400">{t('contracts.columns.status')}</dt>
                    <dd>{t(`contracts.status.${verdict.status ?? 'active'}`)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400">{t('contracts.verify.generatedAt')}</dt>
                    <dd>{verdict.generatedAt === undefined ? '—' : formatDateTime(verdict.generatedAt, locale)}</dd>
                  </div>
                </dl>
                <p className="text-center text-xs text-slate-400">{t('contracts.verify.validHint')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="rounded-lg bg-red-50 px-4 py-3 text-center font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                  ✗ {t('contracts.verify.invalid')}
                </p>
                <p className="text-center text-xs text-slate-400">{t('contracts.verify.invalidHint')}</p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
};

export default VerifyContractPage;
