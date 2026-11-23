/**
 * A list of months, each named and counted — «أكتوبر 2026 (2)» — oldest first. What every month
 * filter of the Fleet boards offers: only months something falls in, never a calendar of empty
 * choices.
 *
 * Arabic names the month in Arabic and writes the year and the count in Latin digits, as the rest
 * of the system does (owner, 2026-11-22, «صلحهم» — the options read «أكتوبر ٢٠٢٦ (١٢)» beside
 * screens that write every other figure «12»). `-u-nu-latn` changes the digits only; the month
 * names and their order stay ar-EG's.
 */
export const monthCountOptions = (
  months: readonly { month: string; count: number }[],
  locale: string,
): { value: string; label: string }[] => {
  const tag = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
  const digits = new Intl.NumberFormat(tag);
  const name = new Intl.DateTimeFormat(tag, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return [...months]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(({ month, count }) => ({
      value: month,
      label: `${name.format(new Date(`${month}-01T00:00:00.000Z`))} (${digits.format(count)})`,
    }));
};

/**
 * The months the registry's licences run out in — the options of «شهر انتهاء الترخيص», each with
 * how many cars it holds.
 */
export const licenceMonthOptions = (
  vehicles: readonly { licenseExpiresAt: string | null }[],
  locale: string,
): { value: string; label: string }[] => {
  const counts = new Map<string, number>();
  for (const vehicle of vehicles) {
    if (vehicle.licenseExpiresAt === null) continue;
    const month = vehicle.licenseExpiresAt.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return monthCountOptions(
    [...counts.entries()].map(([month, count]) => ({ month, count })),
    locale,
  );
};
