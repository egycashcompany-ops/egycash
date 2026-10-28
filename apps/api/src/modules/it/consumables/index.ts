export { buildItConsumablesRouter } from './consumable.routes';
export { buildItConsumableMovementsRouter } from './consumable-movement.routes';
export { buildItConsumableMemosRouter } from './consumable-memo.routes';
export { itConsumableService } from './consumable.service';
export { itConsumableIssueService, type ItConsumableIssueResult } from './consumable-issue.service';
export { itConsumableMemoService } from './consumable-memo.service';
export {
  consumableMemoFileAuthorizer,
  resolveConsumableMemoCategoryId,
} from './consumable-memo-files';
// What a writer outside the services (the go-live import) builds its rows and its audit from.
export {
  MOVEMENT_AUDIT_ACTION,
  auditConsumableCreated,
  auditStockMovement,
  consumableEntityRef,
  consumableItemRow,
  consumableMemoEntityRef,
  consumableMovementRow,
  consumableSnapshot,
  counterChanges,
  ensureItConsumableCollections,
  type ConsumableItemInput,
  type ConsumableMovementInput,
} from './consumable-history';
export {
  CONSUMABLE_MEMO_SEQUENCE_KEY,
  CONSUMABLE_SEQUENCE_KEY,
  formatConsumableCode,
} from './consumable-number';
export {
  NO_STOCK,
  applyStockEffect,
  beforeStockEffect,
  canTake,
  isBelowMin,
  stockEffect,
  type ConsumableCounters,
  type StockEffect,
} from './consumable-stock';
export { ItConsumableModel, type ItConsumableDoc } from './consumable.model';
export {
  ItConsumableMovementModel,
  type ItConsumableMovementDoc,
} from './consumable-movement.model';
export {
  ItConsumableMemoModel,
  type ItConsumableMemoDoc,
  type ItConsumableMemoLineSub,
} from './consumable-memo.model';
export { itConsumableRepository } from './consumable.repository';
export { itConsumableMovementRepository } from './consumable-movement.repository';
export { itConsumableMemoRepository } from './consumable-memo.repository';
