// The bank colours, bottom-left inside the map while the dots are coloured by bank (§8.8): the
// catalog's banks (DEC-35 — the workbook's six and any bank added since), plus «بنك غير محدد» for a
// machine without an open register entry (DM-17, §8.13). Inside the map frame, so it stays light in
// dark mode like the rest of the map.
import { type AtmBankCode, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { type BankLookup } from '../../lib/bank-catalog';

export const BankLegend = ({
  locale,
  banks,
  codes,
}: {
  locale: Locale;
  banks: BankLookup;
  /** The banks shown, in order (`banksOnShow`: the active ones and any the map's dots carry). */
  codes: readonly AtmBankCode[];
}): JSX.Element => {
  const t = useT();
  const rows = [
    ...codes.map((code) => ({
      key: code,
      color: banks.color(code),
      name: banks.name(code, locale),
    })),
    { key: 'none', color: banks.color(null), name: t('atm.map.filters.bankNone') },
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
        <span key={row.key} className="flex items-center gap-2" data-map-legend-bank={row.key}>
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
