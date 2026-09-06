// Thin HTTP mapping only (ADR-003). The one decision made here is which sections this caller may
// be shown — read off their own grants, each with that grant's data scope, and handed to the
// service as data rather than asked about again inside it.
import { type Request, type Response } from 'express';
import { ok } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { hasPermission, scopeSelector } from '../../../shared/types';
import { fleetDashboardService, type DashboardGrants } from './dashboard.service';

export const getFleetDashboard = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const grantFor = (key: string): ReturnType<typeof scopeSelector> | null =>
    hasPermission(ctx, key) ? scopeSelector(ctx, key) : null;
  const grants: DashboardGrants = {
    vehicles: grantFor('fleetVehicle.view'),
    drivers: grantFor('fleetDriver.view'),
    odometer: grantFor('fleetOdometer.view'),
    maintenance: grantFor('fleetMaintenance.view'),
    accidents: grantFor('fleetAccident.view'),
  };
  ok(res, await fleetDashboardService.build(grants, new Date()));
};
