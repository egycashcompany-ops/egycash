// A13 — the generation progress surface: queued/rendering show a live spinner (the detail
// query polls), failed shows the error with a Retry (permission-gated by the caller).
import { type ContractGenerationDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Badge, Spinner } from '../../../../shared/ui';

export const GenerationStatus = ({ generation }: { generation: ContractGenerationDto }): JSX.Element | null => {
  const t = useT();
  switch (generation.status) {
    case 'idle':
      return null;
    case 'queued':
    case 'rendering':
      return (
        <span className="inline-flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" />
          {t(`contracts.generation.${generation.status}`)}
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-2">
          <Badge tone="danger">{t('contracts.generation.failed')}</Badge>
          {generation.error !== null && (
            <span className="text-xs text-slate-500" dir="ltr">{generation.error}</span>
          )}
        </span>
      );
    case 'completed':
      return (
        <Badge tone="success">
          {generation.pdfFileId === null
            ? t('contracts.generation.completedNoPdf')
            : t('contracts.generation.completed')}
        </Badge>
      );
  }
};
