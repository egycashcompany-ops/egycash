// «عاوز لما اعمل فلتر يجبلى العداد فى حالة الفلتر كام» — the figure above the table, on every
// screen that shows a filtered set of cars.
//
// ONE COMPONENT, THREE SCREENS. The odometer register, the workshop register and the alarms board
// all answer the same question, and a strip that disagreed between two of them about where the
// same car is would be worse than no strip at all. The wording, the shape and the «do not invent
// a number» rule live here once; each page hands it an answer and nothing else.
//
// WHY A MAXIMUM AND NEVER A SUM. A counter is a POSITION on an instrument, not a distance. Adding
// two cars' odometers gives a number that exists on no dashboard in the fleet — the server says
// the same thing at greater length in `highest-reading.ts`, which is where the figure is computed
// and the only place it is.
//
// THE THREE CELLS BESIDE IT ARE NOT THREE MORE FIGURES. They are the label of the one figure: a
// bare maximum over twelve cars names none of them, dates nothing, and does not say twelve. The
// reader's next question is always «بتاعة أنهى عربية», and a strip that cannot answer it sends
// them back to the table to look for the biggest number by eye.
import { type FleetHighestReadingDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { StatStrip, type StatStripItem } from '../../../shared/ui/StatStrip';
import { formatDate, formatNumber } from '../../../shared/lib/format';

export const HighestReadingStrip = ({
  data,
  loading,
}: {
  data: FleetHighestReadingDto | undefined;
  loading: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  // `value` is OMITTED, not undefined, while the answer is in flight — `exactOptionalPropertyTypes`
  // draws that distinction and `StatStrip` reads the absence as «hold the space, do not invent a
  // number». A zero here would be a claim, and it would be wrong as often as it was right.
  const cell = (key: string, value: string | null | undefined): StatStripItem => ({
    key,
    label: t(`fleet.odometer.highest.${key}`),
    loading,
    ...(value === null || value === undefined ? {} : { value }),
  });

  return (
    <StatStrip
      labelFirst
      items={[
        cell(
          'reading',
          data === undefined
            ? undefined
            : data.reading === null
              ? null
              : `${formatNumber(data.reading, locale)} ${t('fleet.vehicle.km')}`,
        ),
        cell('vehicle', data === undefined ? undefined : data.code),
        cell('at', data === undefined ? undefined : data.at === null ? null : formatDate(data.at, locale)),
        cell(
          'vehicles',
          data === undefined ? undefined : formatNumber(data.vehicles, locale),
        ),
      ]}
    />
  );
};
