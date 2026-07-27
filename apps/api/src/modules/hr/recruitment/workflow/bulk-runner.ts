// The shared bulk executor (I4/RW17). Every recruitment bulk endpoint runs through it, so the
// envelope, the ordering and the failure semantics are identical everywhere.
//
// Each item runs its own single-item service method — same rules, same audit, same events, same
// timeline — inside that method's own transaction. A failing item rolls back completely and is
// reported in the envelope; the rest of the selection still applies. The bulk operation itself is
// audited once, so an approval of forty is auditable both as forty decisions and as one act.
import { type BulkActionResultDto } from '@ecms/contracts';
import { auditService } from '../../../../platform/audit';

export interface BulkRunOptions {
  /** For the single audit record of the bulk act itself. */
  entityType: string;
  action: string;
  actorUserId: string;
  reason?: string | null;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Run `perItem` over `ids`, collecting a per-id outcome. Never throws for an item failure — a
 * caller receives the envelope and decides what to surface.
 */
export const runBulk = async (
  ids: string[],
  perItem: (id: string) => Promise<unknown>,
  options: BulkRunOptions,
): Promise<BulkActionResultDto> => {
  const results: BulkActionResultDto['results'] = [];
  for (const id of ids) {
    try {
      await perItem(id);
      results.push({ id, ok: true });
    } catch (error) {
      results.push({ id, ok: false, error: errorMessage(error) });
    }
  }
  const succeeded = results.filter((r) => r.ok).length;

  await auditService.record({
    entityRef: {
      moduleId: 'hr',
      entityType: `${options.entityType}Bulk`,
      entityId: options.actorUserId,
    },
    action: 'update',
    changes: [
      { field: 'action', old: null, new: options.action },
      { field: 'requested', old: null, new: ids.length },
      { field: 'succeeded', old: null, new: succeeded },
      { field: 'failed', old: null, new: results.length - succeeded },
      ...(options.reason === undefined || options.reason === null
        ? []
        : [{ field: 'reason', old: null, new: options.reason }]),
    ],
  });

  return { requested: ids.length, succeeded, failed: results.length - succeeded, results };
};
