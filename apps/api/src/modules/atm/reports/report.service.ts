// The daily report's one read. Nothing is stored and nothing is audited — a report is a read
// (the operations report precedent). A day or a period (2026-11-02, «تسمح بإنى أختار فترة من إلى
// .. بس الـ Default يكون اليوم»): the same counts over every day from the first to the last.
import { type AtmDailyReportDto, type AtmDailyReportQuery } from '@ecms/contracts';
import { hasPermission, scopeSelector, type AuthContext } from '../../../shared/types';
import { cairoDateString, cairoDayRange } from '../shared/cairo-time';
import { atmReplenishmentRepository } from '../replenishments/replenishment.repository';
import { atmMaintenanceRepository } from '../maintenances/maintenance.repository';

/**
 * Pure, apart from the clock: which days a query asks for. One bound alone serves as both, a
 * legacy single `date` serves when neither is given, none is today, and the two are put in order.
 */
export const reportPeriod = (
  query: AtmDailyReportQuery,
  today: string,
): { from: string; to: string } => {
  const from = query.from ?? query.to ?? query.date ?? today;
  const to = query.to ?? query.from ?? query.date ?? today;
  return from <= to ? { from, to } : { from: to, to: from };
};

class AtmReportService {
  async daily(query: AtmDailyReportQuery, ctx: AuthContext): Promise<AtmDailyReportDto> {
    const { from, to } = reportPeriod(query, cairoDateString(new Date()));
    // From the first day's midnight to the midnight AFTER the last: the last day counts whole.
    const { start } = cairoDayRange(from);
    const { end } = cairoDayRange(to);

    // Each half is computed only for a caller who may read it. Absent a grant the list is empty
    // rather than absent, so the screen renders one honest zero-row section instead of guessing.
    const replenishments = hasPermission(ctx, 'atmReplenishment.view')
      ? await atmReplenishmentRepository.countsByBankForDay({
          from: start,
          to: end,
          scope: scopeSelector(ctx, 'atmReplenishment.view'),
        })
      : [];
    const maintenances = hasPermission(ctx, 'atmMaintenance.view')
      ? await atmMaintenanceRepository.countsByBankForDay({
          from: start,
          to: end,
          scope: scopeSelector(ctx, 'atmMaintenance.view'),
        })
      : [];

    return { from, to, date: from, replenishments, maintenances };
  }
}

export const atmReportService = new AtmReportService();
