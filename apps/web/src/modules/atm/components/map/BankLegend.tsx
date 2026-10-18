// The bank colours, bottom-left inside the map while the dots are coloured by bank (§8.8): the
// Data Report's six banks, plus «بنك غير محدد» for a machine without an open register entry (DM-17,
// §8.13). Inside the map frame, so it stays light in dark mode like the rest of the map.
import { ATM_BANK_CODES, ATM_BANK_NAMES, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { bankColor } from '../../lib/map-colors';

export const BankLegend = ({ locale }: { locale: Locale }): JSX.Element => {
  const t = useT();
  const rows = [
    ...ATM_BANK_CODES.map((code) => ({
      key: code,
      color: bankColor(code),
      name: ATM_BANK_NAMES[code][locale],
    })),
    { key: 'none', color: bankColor(null), name: t('atm.map.filters.bankNone') },
  ];
  return (
    <div
      data-map-legend="bank"
      role="group"
      aria-label={t('atm.map.legend.bank')}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      className="absolute bottom-[34px] left-3 z-[1100] flex flex-col gap-1.5 rounded-xl bg-white/95 px-3 py-2.5 text-xs text-slate-700 shadow"
    >
      {rows.map((row) => (
        <span key={row.key} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-[11px] w-[11px] rounded-full shadow-[inset_0_0_0_1.5px_rgba(15,23,42,0.35)]"
            style={{ backgroundColor: row.color }}
          />
          {row.name}
        </span>
      ))}
    </div>
  );
};
