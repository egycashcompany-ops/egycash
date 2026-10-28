// «بيانات ناقصة» (DEC-37) as a row of the register shows it: an amber pill beside the Name.
//
// The owner's call (final): a machine Operations add on /atm/data-edit lands in the register as an
// OPEN receipt dated the add day — counted in the Data Report and giving settlements its bank from
// day one — flagged so Efficiency can find it and complete it. The pill is how they see it in the
// grid; the filter «بيانات ناقصة فقط» is how they find them all. Its tooltip says what is still
// empty (`missingForCompletion`) and, for an Operations row, where it came from. The flag is stored,
// never derived from the gaps: only a person clears it.
import { type AtmRegisterEntryDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Badge } from '../../../../shared/ui/Badge';
import { missingForCompletion, registerGapLabelKey } from '../../lib/register-grid';

/** The tooltip's lines: the mark, what is still empty, and who recorded the row. */
export const incompleteLines = (
  row: AtmRegisterEntryDto,
  t: (key: string, params?: Record<string, string | number>) => string,
  locale: Locale,
): string[] => {
  const gaps = missingForCompletion(row).map((gap) => t(registerGapLabelKey(gap)));
  return [
    t('atm.register.incomplete'),
    gaps.length === 0
      ? t('atm.register.incompleteNoGaps')
      : t('atm.register.incompleteMissing', { fields: gaps.join(locale === 'ar' ? '، ' : ', ') }),
    ...(row.source === 'operations' ? [t('atm.register.source.operations')] : []),
  ];
};

export const IncompleteBadge = ({ row }: { row: AtmRegisterEntryDto }): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  if (!row.dataIncomplete) return null;
  const tooltip = incompleteLines(row, t, locale).join('\n');
  return (
    <span data-register-incomplete="true" title={tooltip} className="inline-flex shrink-0">
      <Badge size="sm" tone="warning">
        {t('atm.register.incomplete')}
      </Badge>
      <span className="sr-only">{tooltip}</span>
    </span>
  );
};
