// The daily report's one read. Nothing is stored and nothing is audited — a report is a read
// (the operations report precedent).
import { type AtmDailyReportDto, type AtmDailyReportQuery } from '@ecms/contracts';
import { hasPermission, scopeSelector, type AuthContext } from '../../../shared/types';
import { cairoDateString, cairoDayRange } from '../shared/cairo-time';
import { atmReplenishmentRepository } from '../replenishments/replenishment.repository';
import { atmMaintenanceRepository } from '../maintenances/maintenance.repository';

class AtmReportService {
  async daily(query: AtmDailyReportQuery, ctx: AuthContext): Promise<AtmDailyReportDto> {
    const date = query.date ?? cairoDateString(new Date());
    const { start, end } = cairoDayRange(date);

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

    return { date, replenishments, maintenances };
  }
}

export const atmReportService = new AtmReportService();
