// «إعداد المذكرات» — the names his seven papers print with, read and saved; and the snapshot every
// memo and every letter takes of its own paper when it is made, so a later change to the set-up
// never rewrites a paper that was already printed.
import { type ClientSession } from 'mongoose';
import {
  DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES,
  ErrorCodes,
  FLEET_CUSTODY_PAPERS,
  FleetCustodyPaperSetSchema,
  type FleetCustodyPaper,
  type FleetCustodyPaperSet,
  type FleetCustodyPaperSettingsDto,
  type FleetCustodyPaperSignatures,
  type SaveFleetCustodyPaperSettings,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { ConflictError, StaleDocumentError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetCustodyPaperSettingsRepository } from './custody-paper-settings.repository';

const SETTINGS_KEY = 'default';

/** A deep copy — no caller may ever hold a reference into the defaults or another paper. */
const copy = <T>(value: T): T => structuredClone(value);

/**
 * What the papers are, from what is stored: each paper as saved when it still passes the
 * contract's own rule for that paper, his default otherwise — a paper never saved, or saved under
 * an older shape, prints his names rather than half a block. Pure, for its spec.
 */
export const mergePaperSettings = (stored: unknown): FleetCustodyPaperSet => {
  const map =
    stored !== null && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const out = {} as Record<FleetCustodyPaper, FleetCustodyPaperSignatures>;
  for (const paper of FLEET_CUSTODY_PAPERS) {
    const parsed = FleetCustodyPaperSetSchema.shape[paper].safeParse(map[paper]);
    out[paper] = parsed.success
      ? copy(parsed.data)
      : copy(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES[paper]);
  }
  return out;
};

const entityRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'custodyPaperSettings',
  entityId: id,
});

class FleetCustodyPapersService {
  async getSettings(session?: ClientSession): Promise<FleetCustodyPaperSettingsDto> {
    const doc = await fleetCustodyPaperSettingsRepository.findByKey(SETTINGS_KEY, session);
    return doc === null
      ? { papers: copy(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES), version: null }
      : { papers: mergePaperSettings(doc.papers), version: doc.__v };
  }

  /**
   * A save without a version is the FIRST one — the page read «nothing saved yet» — and may only
   * create the row: when a row exists by now (someone saved meanwhile), or two first saves race and
   * the unique key refuses the second, it is a stale 409, never a silent overwrite. Every later save
   * carries the version it read (a stale one is 409 too).
   */
  async saveSettings(
    input: SaveFleetCustodyPaperSettings,
    by: string,
  ): Promise<FleetCustodyPaperSettingsDto> {
    const before = await fleetCustodyPaperSettingsRepository.findByKey(SETTINGS_KEY);
    const papers = copy(input.papers);
    if (before !== null && input.version === undefined) throw new StaleDocumentError();
    const saved =
      before === null
        ? await this.createFirst(papers, by)
        : await fleetCustodyPaperSettingsRepository.updateById(
            String(before._id),
            { papers },
            { by, version: input.version ?? before.__v },
          );
    await auditService.record({
      entityRef: entityRef(String(saved._id)),
      action: before === null ? 'create' : 'update',
      changes: diffChanges(before === null ? {} : { ...mergePaperSettings(before.papers) }, {
        ...mergePaperSettings(saved.papers),
      }),
    });
    return { papers: mergePaperSettings(saved.papers), version: saved.__v };
  }

  /** The first row; a racing first save that lost on the unique key reads as stale. */
  private async createFirst(papers: FleetCustodyPaperSet, by: string) {
    try {
      return await fleetCustodyPaperSettingsRepository.create(
        { key: SETTINGS_KEY, papers },
        { by },
      );
    } catch (error) {
      if (error instanceof ConflictError && error.code === ErrorCodes.DUPLICATE) {
        throw new StaleDocumentError();
      }
      throw error;
    }
  }

  /**
   * One paper's signatures as they stand now — a deep copy, to be stored as a memo's or a letter's
   * snapshot. Read OUTSIDE the writer's transaction is fine: a set-up saved a moment later is the
   * next paper's, not this one's.
   */
  async signaturesFor(
    paper: FleetCustodyPaper,
    session?: ClientSession,
  ): Promise<FleetCustodyPaperSignatures> {
    return copy((await this.getSettings(session)).papers[paper]);
  }
}

export const fleetCustodyPapersService = new FleetCustodyPapersService();
