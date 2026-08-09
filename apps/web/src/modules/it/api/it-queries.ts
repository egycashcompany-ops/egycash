// TanStack Query hooks for the IT app (ADR-013). Keys follow the platform factory —
// ['it', feature, kind, params] — so every write invalidates exactly its own subtree.
//
// One rule carries this file: an asset mutation invalidates the ASSETS subtree and reseeds the
// detail cache, because the server derives `status` and allocates `assetCode` — a client that
// kept its own copy would show a stale truth the moment either changed.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AssignItAsset,
  type AssignItTicket,
  type CancelItMaintenanceOrder,
  type CompleteItMaintenanceOrder,
  type CreateItMaintenanceOrder,
  type CreateItMaintenancePlan,
  type CreateItSparePart,
  type ReceiveItSparePart,
  type StartItMaintenanceOrder,
  type UpdateItMaintenanceOrder,
  type UpdateItMaintenancePlan,
  type UpdateItSparePart,
  type CancelItTicket,
  type ChangeItTicketStatus,
  type CloseItTicket,
  type CreateItTicket,
  type CreateItTicketComment,
  type CreateItTicketPriority,
  type ReopenItTicket,
  type ResolveItTicket,
  type UpdateItTicket,
  type UpdateItTicketPriority,
  type CreateItAsset,
  type CreateItCatalogItem,
  type CreateItVendor,
  type DisposeItAsset,
  type ItCatalogKind,
  type ReturnItAsset,
  type TransferItAsset,
  type UpdateItAsset,
  type UpdateItCatalogItem,
  type UpdateItVendor,
} from '@ecms/contracts';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import * as api from './it-api';
import { type ItListParams } from './it-api';

const MODULE = 'it';

// Feature-subtree invalidation targets — internal: every consumer outside this file goes through
// the hooks, never the keys.
const itKeys = {
  assets: featureKey(MODULE, 'assets'),
  catalogs: featureKey(MODULE, 'catalogs'),
  vendors: featureKey(MODULE, 'vendors'),
  /** Custody intervals and the asset history — both move on every custody action. */
  custody: featureKey(MODULE, 'custody'),
  tickets: featureKey(MODULE, 'tickets'),
  /** The ticket stream: comments AND history. Any ticket write can add to it. */
  ticketStream: featureKey(MODULE, 'ticketStream'),
  priorities: featureKey(MODULE, 'priorities'),
  /** Orders and the plans whose clocks a completion advances. */
  maintenance: featureKey(MODULE, 'maintenance'),
  maintenancePlans: featureKey(MODULE, 'maintenancePlans'),
  /** Parts, their levels and the ledger — one subtree, because a movement moves both. */
  spareParts: featureKey(MODULE, 'spareParts'),
} as const;

// ── Platform references ─────────────────────────────────────────────────────

/** Branches for the asset form and the list filter. Rarely changes — cached for the session. */
export const useItBranchOptions = () =>
  useQuery({
    queryKey: listKey(MODULE, 'branchOptions'),
    queryFn: api.listBranchOptions,
    staleTime: 5 * 60_000,
  });

/**
 * One platform user, resolved by id. Cached for the session under its own subtree: a name is
 * stable and the ticket screens ask for the same handful of ids over and over.
 */
export const useItUser = (id: string, enabled = true) =>
  useQuery({
    queryKey: detailKey(MODULE, 'users', id),
    queryFn: () => api.getUser(id),
    enabled: enabled && id !== '',
    staleTime: 5 * 60_000,
    retry: false,
  });

// ── Catalog items ───────────────────────────────────────────────────────────

/** Admin list for the catalogs screen — same subtree as the selects' cached lists. */
export const useItCatalogItems = (params: ItListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'catalogs', params),
    queryFn: () => api.listCatalogItems(params),
    placeholderData: (prev) => prev,
  });

/**
 * The active rows of one kind, for a form select. Catalog items are a small fixed list with no
 * server-side `search`, so loading the kind is the intended read — ADR-019 rule 5 governs GROWTH
 * catalogs (vendors, assets), which search instead. `pageSize: 100` is the API's own bound.
 */
export const useItCatalog = (kind: ItCatalogKind) =>
  useQuery({
    queryKey: listKey(MODULE, 'catalogs', { kind, select: true }),
    queryFn: () => api.listCatalogItems({ kind, pageSize: 100, sortBy: 'sortOrder' }),
    staleTime: 60_000,
  });

const useCatalogMutation = <TInput>(mutationFn: (input: TInput) => Promise<unknown>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: itKeys.catalogs });
      // A category rename or archive changes what asset rows and forms display.
      void qc.invalidateQueries({ queryKey: itKeys.assets });
    },
  });
};

export const useCreateItCatalogItem = () =>
  useCatalogMutation((body: CreateItCatalogItem) => api.createCatalogItem(body));
export const useUpdateItCatalogItem = () =>
  useCatalogMutation(({ id, body }: { id: string; body: UpdateItCatalogItem }) =>
    api.updateCatalogItem(id, body),
  );

// ── Vendors ─────────────────────────────────────────────────────────────────

export const useItVendors = (params: ItListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'vendors', params),
    queryFn: () => api.listVendors(params),
    placeholderData: (prev) => prev,
    enabled,
  });

/**
 * One vendor by id — what a picker or a detail page needs to turn a stored `vendorId` into a
 * name. Cached under the vendors subtree, so renaming a vendor invalidates it with everything
 * else.
 */
export const useItVendor = (id: string, enabled = true) =>
  useQuery({
    queryKey: detailKey(MODULE, 'vendors', id),
    queryFn: () => api.getVendor(id),
    enabled: enabled && id !== '',
    staleTime: 60_000,
  });

const useVendorMutation = <TInput>(mutationFn: (input: TInput) => Promise<unknown>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: itKeys.vendors });
      void qc.invalidateQueries({ queryKey: itKeys.assets });
    },
  });
};

export const useCreateItVendor = () =>
  useVendorMutation((body: CreateItVendor) => api.createVendor(body));
export const useUpdateItVendor = () =>
  useVendorMutation(({ id, body }: { id: string; body: UpdateItVendor }) =>
    api.updateVendor(id, body),
  );

// ── Assets ──────────────────────────────────────────────────────────────────

/** `enabled` mirrors the caller's §7 permission, so a card never fetches what it may not show. */
export const useItAssets = (params: ItListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'assets', params),
    queryFn: () => api.listAssets(params),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useItAsset = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, 'assets', id),
    queryFn: () => api.getAsset(id),
    enabled: id !== '',
  });

/**
 * Scan resolve. Deliberately NOT cached long: the point of scanning is to see the asset's state
 * right now, and a scan is a deliberate, low-frequency action.
 */
export const useItAssetByCode = (code: string) =>
  useQuery({
    queryKey: listKey(MODULE, 'assets', { byCode: code }),
    queryFn: () => api.getAssetByCode(code),
    enabled: code.trim() !== '',
    retry: false,
    staleTime: 0,
  });

const useAssetMutation = <TInput, TResult extends { id: string } | void>(
  mutationFn: (input: TInput) => Promise<TResult>,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (doc) => {
      if (doc !== undefined && doc !== null) {
        qc.setQueryData(detailKey(MODULE, 'assets', doc.id), doc);
      }
      void qc.invalidateQueries({ queryKey: itKeys.assets });
    },
  });
};

export const useCreateItAsset = () =>
  useAssetMutation((body: CreateItAsset) => api.createAsset(body));
export const useUpdateItAsset = () =>
  useAssetMutation(({ id, body }: { id: string; body: UpdateItAsset }) =>
    api.updateAsset(id, body),
  );
export const useDeleteItAsset = () => useAssetMutation((id: string) => api.deleteAsset(id));

// ── Custody (IT-2) ──────────────────────────────────────────────────────────

export const useItAssetHistory = (assetId: string, params: ItListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'custody', { history: assetId, ...params }),
    queryFn: () => api.listAssetHistory(assetId, params),
    placeholderData: (prev) => prev,
    enabled: enabled && assetId !== '',
  });

export const useItAssetAssignments = (assetId: string, params: ItListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'custody', { assignments: assetId, ...params }),
    queryFn: () => api.listAssetAssignments(assetId, params),
    placeholderData: (prev) => prev,
    enabled: enabled && assetId !== '',
  });

/** The cross-asset register: what is out, and who has it. */
export const useItAssignments = (params: ItListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'custody', params),
    queryFn: () => api.listAssignments(params),
    placeholderData: (prev) => prev,
    enabled,
  });

/**
 * A custody action moves three things at once: the asset (its `status` and
 * `currentAssignmentId`), the custody intervals, and the asset's history. Invalidating only the
 * asset would leave the history tab showing a chain that is missing the entry the user just
 * created — so both subtrees go, every time.
 */
const useCustodyMutation = <TInput extends { id: string }>(
  mutationFn: (input: TInput) => Promise<{ id: string }>,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (asset) => {
      qc.setQueryData(detailKey(MODULE, 'assets', asset.id), asset);
      void qc.invalidateQueries({ queryKey: itKeys.assets });
      void qc.invalidateQueries({ queryKey: itKeys.custody });
    },
  });
};

export const useAssignItAsset = () =>
  useCustodyMutation(({ id, body }: { id: string; body: AssignItAsset }) =>
    api.assignAsset(id, body),
  );
export const useReturnItAsset = () =>
  useCustodyMutation(({ id, body }: { id: string; body: ReturnItAsset }) =>
    api.returnAsset(id, body),
  );
export const useTransferItAsset = () =>
  useCustodyMutation(({ id, body }: { id: string; body: TransferItAsset }) =>
    api.transferAsset(id, body),
  );
export const useDisposeItAsset = () =>
  useCustodyMutation(({ id, body }: { id: string; body: DisposeItAsset }) =>
    api.disposeAsset(id, body),
  );

// ── Help desk (IT-3) ────────────────────────────────────────────────────────

/**
 * Priorities. Read by the ticket form's dropdown and by the help-desk settings screen, which is
 * why the API takes either grant — cached for the session, since they change rarely.
 */
export const useItTicketPriorities = (params: ItListParams = { pageSize: 100 }, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'priorities', params),
    queryFn: () => api.listTicketPriorities(params),
    staleTime: 60_000,
    enabled,
  });

const usePriorityMutation = <TInput>(mutationFn: (input: TInput) => Promise<unknown>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: itKeys.priorities });
      // A renamed priority changes what ticket rows display — but NOT their SLA, which was
      // snapshotted at creation and is never recomputed.
      void qc.invalidateQueries({ queryKey: itKeys.tickets });
    },
  });
};

export const useCreateItTicketPriority = () =>
  usePriorityMutation((body: CreateItTicketPriority) => api.createTicketPriority(body));
export const useUpdateItTicketPriority = () =>
  usePriorityMutation(({ id, body }: { id: string; body: UpdateItTicketPriority }) =>
    api.updateTicketPriority(id, body),
  );

export const useItTickets = (params: ItListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'tickets', params),
    queryFn: () => api.listTickets(params),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useItTicket = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, 'tickets', id),
    queryFn: () => api.getTicket(id),
    enabled: id !== '',
  });

export const useItTicketComments = (id: string, params: ItListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'ticketStream', { ticketId: id, ...params }),
    queryFn: () => api.listTicketComments(id, params),
    placeholderData: (prev) => prev,
    enabled: enabled && id !== '',
  });

/**
 * A ticket write moves the ticket AND its stream — every transition appends a `statusChanged` row,
 * and an assignment appends two. Invalidating only the ticket would leave the timeline missing the
 * entry the user just caused, which reads as the action having silently failed.
 */
const useTicketMutation = <TInput, TResult extends { id: string }>(
  mutationFn: (input: TInput) => Promise<TResult>,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (ticket: TResult) => {
      qc.setQueryData(detailKey(MODULE, 'tickets', ticket.id), ticket);
      void qc.invalidateQueries({ queryKey: itKeys.tickets });
      void qc.invalidateQueries({ queryKey: itKeys.ticketStream });
    },
  });
};

export const useCreateItTicket = () =>
  useTicketMutation((body: CreateItTicket) => api.createTicket(body));
export const useUpdateItTicket = () =>
  useTicketMutation(({ id, body }: { id: string; body: UpdateItTicket }) =>
    api.updateTicket(id, body),
  );
export const useAssignItTicket = () =>
  useTicketMutation(({ id, body }: { id: string; body: AssignItTicket }) =>
    api.assignTicket(id, body),
  );
export const useChangeItTicketStatus = () =>
  useTicketMutation(({ id, body }: { id: string; body: ChangeItTicketStatus }) =>
    api.changeTicketStatus(id, body),
  );
export const useResolveItTicket = () =>
  useTicketMutation(({ id, body }: { id: string; body: ResolveItTicket }) =>
    api.resolveTicket(id, body),
  );
export const useCloseItTicket = () =>
  useTicketMutation(({ id, body }: { id: string; body: CloseItTicket }) =>
    api.closeTicket(id, body),
  );
export const useReopenItTicket = () =>
  useTicketMutation(({ id, body }: { id: string; body: ReopenItTicket }) =>
    api.reopenTicket(id, body),
  );
export const useCancelItTicket = () =>
  useTicketMutation(({ id, body }: { id: string; body: CancelItTicket }) =>
    api.cancelTicket(id, body),
  );

// ── Ticket attachments (design §2 files row) ────────────────────────────────

/**
 * A ticket's attachments, straight from the platform Files service. `enabled` mirrors the
 * caller's `file.view`, so the panel never fetches what it may not read.
 */
export const useItTicketAttachments = (ticketId: string, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'attachments', ticketId),
    queryFn: () => api.listTicketAttachments(ticketId),
    enabled: enabled && ticketId !== '',
  });

/** Platform reference data — one small list, cached for the session. */
export const useItFileCategories = (enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'fileCategories'),
    queryFn: api.listFileCategories,
    staleTime: 5 * 60_000,
    enabled,
  });

/**
 * One comment's attachments. Fetched only for comments the stream returned — and the server
 * enforces the same rule again, so this is convenience, not the boundary.
 */
export const useItCommentAttachments = (commentId: string, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'attachments', { comment: commentId }),
    queryFn: () => api.listCommentAttachments(commentId),
    enabled: enabled && commentId !== '',
  });

export const useUploadItCommentAttachment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      commentId,
      file,
      categoryId,
    }: {
      commentId: string;
      file: File;
      categoryId: string;
    }) => api.uploadCommentAttachment(commentId, file, categoryId),
    onSuccess: (_file, variables) => {
      void qc.invalidateQueries({
        queryKey: listKey(MODULE, 'attachments', { comment: variables.commentId }),
      });
    },
  });
};

export const useUploadItTicketAttachment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      ticketId,
      file,
      categoryId,
    }: {
      ticketId: string;
      file: File;
      categoryId: string;
    }) => api.uploadTicketAttachment(ticketId, file, categoryId),
    onSuccess: (_file, variables) => {
      void qc.invalidateQueries({ queryKey: listKey(MODULE, 'attachments', variables.ticketId) });
    },
  });
};

/** Posting a comment appends to the stream only — the ticket row itself does not change. */
export const useCreateItTicketComment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CreateItTicketComment }) =>
      api.createTicketComment(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: itKeys.ticketStream });
      // A first public technician comment stamps `firstResponseAt` server-side, so the ticket's
      // SLA panel moves too.
      void qc.invalidateQueries({ queryKey: itKeys.tickets });
    },
  });
};

// ── Maintenance (IT-4) ──────────────────────────────────────────────────────

export const useItMaintenanceOrders = (params: ItListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'maintenance', params),
    queryFn: () => api.listMaintenanceOrders(params),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useItMaintenanceOrder = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, 'maintenance', id),
    queryFn: () => api.getMaintenanceOrder(id),
    enabled: id !== '',
  });

/**
 * The parts an order consumed — read from the LEDGER, never from the order (ADR-024). Cached under
 * the spare-parts subtree, so a movement anywhere invalidates it with the levels it changed.
 */
export const useItMaintenanceOrderParts = (id: string, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'spareParts', { orderId: id }),
    queryFn: () => api.listMaintenanceOrderParts(id),
    enabled: enabled && id !== '',
  });

/**
 * An order write moves more than the order: `start` and `complete` change the ASSET's status
 * (§2.7), a completion consumes STOCK and advances a preventive PLAN's clock (§4.6). Anything less
 * than invalidating all four leaves a screen showing a fact the user's own action just changed.
 */
const useMaintenanceMutation = <TInput, TResult extends { id: string }>(
  mutationFn: (input: TInput) => Promise<TResult>,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (order: TResult) => {
      qc.setQueryData(detailKey(MODULE, 'maintenance', order.id), order);
      void qc.invalidateQueries({ queryKey: itKeys.maintenance });
      void qc.invalidateQueries({ queryKey: itKeys.maintenancePlans });
      void qc.invalidateQueries({ queryKey: itKeys.spareParts });
      // The asset's status and its history both move with the order.
      void qc.invalidateQueries({ queryKey: itKeys.assets });
      void qc.invalidateQueries({ queryKey: itKeys.custody });
    },
  });
};

export const useCreateItMaintenanceOrder = () =>
  useMaintenanceMutation((body: CreateItMaintenanceOrder) => api.createMaintenanceOrder(body));
export const useUpdateItMaintenanceOrder = () =>
  useMaintenanceMutation(({ id, body }: { id: string; body: UpdateItMaintenanceOrder }) =>
    api.updateMaintenanceOrder(id, body),
  );
export const useStartItMaintenanceOrder = () =>
  useMaintenanceMutation(({ id, body }: { id: string; body: StartItMaintenanceOrder }) =>
    api.startMaintenanceOrder(id, body),
  );
export const useCompleteItMaintenanceOrder = () =>
  useMaintenanceMutation(({ id, body }: { id: string; body: CompleteItMaintenanceOrder }) =>
    api.completeMaintenanceOrder(id, body),
  );
export const useCancelItMaintenanceOrder = () =>
  useMaintenanceMutation(({ id, body }: { id: string; body: CancelItMaintenanceOrder }) =>
    api.cancelMaintenanceOrder(id, body),
  );

// ── Preventive plans ────────────────────────────────────────────────────────

export const useItMaintenancePlans = (params: ItListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'maintenancePlans', params),
    queryFn: () => api.listMaintenancePlans(params),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useItMaintenancePlan = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, 'maintenancePlans', id),
    queryFn: () => api.getMaintenancePlan(id),
    enabled: id !== '',
  });

const usePlanMutation = <TInput, TResult extends { id: string }>(
  mutationFn: (input: TInput) => Promise<TResult>,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (plan: TResult) => {
      qc.setQueryData(detailKey(MODULE, 'maintenancePlans', plan.id), plan);
      void qc.invalidateQueries({ queryKey: itKeys.maintenancePlans });
    },
  });
};

export const useCreateItMaintenancePlan = () =>
  usePlanMutation((body: CreateItMaintenancePlan) => api.createMaintenancePlan(body));
export const useUpdateItMaintenancePlan = () =>
  usePlanMutation(({ id, body }: { id: string; body: UpdateItMaintenancePlan }) =>
    api.updateMaintenancePlan(id, body),
  );
export const useSetItMaintenancePlanActive = () =>
  usePlanMutation(({ id, active }: { id: string; active: boolean }) =>
    api.setMaintenancePlanActive(id, active),
  );

// ── Spare parts and the ledger ──────────────────────────────────────────────
//
// There is no consume hook, and its absence is the design (FR-9): stock leaves the store only
// through `useCompleteItMaintenanceOrder`, which invalidates this subtree above.

export const useItSpareParts = (params: ItListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'spareParts', params),
    queryFn: () => api.listSpareParts(params),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useItSparePart = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, 'spareParts', id),
    queryFn: () => api.getSparePart(id),
    enabled: id !== '',
  });

export const useItSparePartMovements = (id: string, params: ItListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'spareParts', { movementsOf: id, ...params }),
    queryFn: () => api.listSparePartMovements(id, params),
    placeholderData: (prev) => prev,
    enabled: enabled && id !== '',
  });

const useSparePartMutation = <TInput>(mutationFn: (input: TInput) => Promise<unknown>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      // One subtree for levels, rows and the ledger: a receipt changes all three at once, and
      // `onHandQty` is denormalized from the movements, so they can never be refreshed apart.
      void qc.invalidateQueries({ queryKey: itKeys.spareParts });
    },
  });
};

export const useCreateItSparePart = () =>
  useSparePartMutation((body: CreateItSparePart) => api.createSparePart(body));
export const useUpdateItSparePart = () =>
  useSparePartMutation(({ id, body }: { id: string; body: UpdateItSparePart }) =>
    api.updateSparePart(id, body),
  );
export const useReceiveItSparePart = () =>
  useSparePartMutation(({ id, body }: { id: string; body: ReceiveItSparePart }) =>
    api.receiveSparePart(id, body),
  );
