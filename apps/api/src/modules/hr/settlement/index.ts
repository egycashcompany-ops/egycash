// Public surface of the Final Settlement feature (P-HR-11).
//
// The router, and the service for the tests that read it directly. There is no model, no repository
// and no mapper to export — this feature stores nothing, so there is nothing behind it to reach.
export { buildSettlementRouter } from './settlement.routes';
export { settlementService } from './settlement.service';
