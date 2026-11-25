export { buildAdministrationWarehousesRouter } from './warehouse.routes';
export { administrationWarehouseService } from './warehouse.service';
// What a feature that can hold a warehouse (the stock ledger, P5; each document that names one)
// registers at module load, so a retirement asks it (OD-70 B, §3.6).
export { registerWarehouseHoldChecker, type WarehouseHoldChecker } from './warehouse-holds';
