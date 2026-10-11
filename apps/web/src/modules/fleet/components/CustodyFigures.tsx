// The custody board's figures — behind «الإحصائيات» on the board, and leading «داش بورد».
//
// «عاوز الاحصائيات الكوتش لوحده والغسيل لوحده»: five figures, not four — everything the fund paid,
// then each kind on its own tile in its own colour and icon (`CustodyKinds.tsx`). The numbers are
// the server's, over the whole filtered set, never the page.
import { type FleetCustodySummaryDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { CUSTODY_KIND, CUSTODY_KINDS, CUSTODY_TOTAL_TILE } from './CustodyKinds';
import { FigureChip, moneyChip } from './FleetFigures';
import { PATH } from './FuelCardBoard';

/** Each figure's words, the kind's own key under `fleet.custody.totals`. */
const KIND_LABEL = {
  dealership: 'fleet.custody.totals.dealership',
  fuel: 'fleet.custody.totals.fuel',
  tyres: 'fleet.custody.totals.tyres',
  wash: 'fleet.custody.totals.wash',
} as const;

export const CustodyFigures = ({ totals }: { totals: FleetCustodySummaryDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <section
      data-custody-figures="true"
      // Five across only where five sums fit (measured: a 1,024px board cuts «ج.م.» off a tile
      // of five); between 1,280 and 1,536 the figure a size down, so a sum in the millions fits —
      // and should one still not, «ج.م.» goes under it rather than off the tile.
      className="grid shrink-0 animate-drop-in grid-cols-2 gap-3 xl:grid-cols-5 xl:[&_.text-2xl]:text-xl 2xl:[&_.text-2xl]:text-2xl [&_.items-baseline]:flex-wrap"
    >
      {/* A sum of money takes the whole row on a phone, so «ج.م.» stays on the tile; the total
          keeps a row of its own until the five fit on one. */}
      <div className="col-span-2 xl:col-span-1" data-custody-figure="total">
        <FigureChip
          icon={PATH.box}
          iconClass={CUSTODY_TOTAL_TILE}
          label={t('fleet.custody.totals.total')}
          {...moneyChip(totals.total, locale)}
        />
      </div>
      {CUSTODY_KINDS.map((kind) => (
        <div key={kind} className="col-span-2 sm:col-span-1" data-custody-figure={kind}>
          <FigureChip
            icon={CUSTODY_KIND[kind].icon}
            iconClass={cn(CUSTODY_KIND[kind].fill, CUSTODY_KIND[kind].ink)}
            label={t(KIND_LABEL[kind])}
            {...moneyChip(totals[kind], locale)}
          />
        </div>
      ))}
    </section>
  );
};
