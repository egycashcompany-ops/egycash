// `YYYY-MM` helpers shared by the month screens. The bounds are inclusive date-only strings,
// which is exactly what the day endpoint's `from`/`to` expect.
export const thisMonth = (): string => new Date().toISOString().slice(0, 7);

export const monthBounds = (month: string): { from: string; to: string } => {
  const [year, monthIndex] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
};
