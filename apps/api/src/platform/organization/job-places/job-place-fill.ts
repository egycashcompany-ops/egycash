// The one-time fill (P-ORG-3 §7, D-ORG3-2): each company department gets the job places where its
// holders sit — employees not exited, accepted offers not yet hired — ONCE. After that the places are
// edited by hand, and a place a user removes is never put back.
//
// ONCE PER DEPARTMENT, with a mark row per department entry (`job_title_place_fills`), written in the
// same transaction as its places and BEFORE them, so either a department is filled and marked or
// nothing happened. Racing processes (the API, the worker and the CLIs all boot the platform) collide
// on the marks' unique index: one commits, the other retries into "nothing to do" or gets a duplicate
// key, which is the lost race and nothing more.
//
// The platform may not read HR (eslint boundaries), so HR hands the facts in through `readHolders`,
// which is only called when some department still needs filling — every start after the first returns
// before reading a single employee.
import { Types } from 'mongoose';
import { JOB_PLACES_MAX } from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { unitOfWork } from '../../kernel/unit-of-work';
import { auditService, type AuditEntry } from '../../audit';
import {
  indexOrgChart,
  type ChartDepartmentGroup,
  type ChartSectionGroup,
} from '../org-chart/org-chart.groups';
import { loadOrgChart } from '../org-chart/org-chart.load';
import { keyOf, labelPlaces, type PlaceKeyed } from '../org-chart/job-place-plan';
import { JobPlaceModel } from './job-place.model';
import { JobPlaceFillModel } from './job-place-fill.model';

export interface HeldUnit {
  departmentId: string;
  sectionId: string | null;
  jobTitleId: string;
}

export interface FillResult {
  departments: number;
  placed: number;
  skipped: number;
}

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/** The departments a fill would cover: a catalog group, shown, not yet marked. */
const pending = (departments: readonly ChartDepartmentGroup[], marked: ReadonlySet<string>) =>
  departments.filter((d) => d.entry !== null && d.shown && !marked.has(d.entry.id));

export const fillJobPlacesFromHolders = async (
  readHolders: () => Promise<HeldUnit[]>,
): Promise<FillResult | null> => {
  // The race guard IS this index. If the boot step could not build it, do not run at all (§7).
  const indexes = await JobPlaceFillModel.collection.listIndexes().toArray();
  if (!indexes.some((index) => index.name === 'ux_departmentCatalogId')) {
    logger.error('job places: the fill marks have no unique index; the one-time fill did not run');
    return null;
  }

  // Cheap check first, outside any transaction: is there anything to fill at all?
  const marks = await JobPlaceFillModel.find({}, { departmentCatalogId: 1 }).lean().exec();
  const markedNow = new Set(marks.map((mark) => String(mark.departmentCatalogId)));
  if (pending(indexOrgChart(await loadOrgChart()).departments, markedNow).length === 0) return null;

  const holders = await readHolders();
  try {
    const outcome = await unitOfWork(async (session) => {
      const chart = await loadOrgChart({ session });
      const index = indexOrgChart(chart);
      const marked = new Set(
        (
          await JobPlaceFillModel.find({}, { departmentCatalogId: 1 })
            .session(session)
            .lean()
            .exec()
        ).map((m) => String(m.departmentCatalogId)),
      );
      const toFill = pending(index.departments, marked);
      if (toFill.length === 0) return null;

      // A department that already holds any place, live or deleted, was edited by hand: it is marked
      // and left as it is, so the users' edits win (§7 step 4).
      const touched = new Set(
        (
          await JobPlaceModel.distinct('departmentCatalogId', {
            departmentCatalogId: { $in: toFill.map((d) => new Types.ObjectId(d.entry?.id ?? '')) },
          }).session(session)
        ).map(String),
      );
      const filling = new Map(
        toFill.filter((d) => !touched.has(d.entry?.id ?? '')).map((d) => [d.entry?.id ?? '', d]),
      );

      const departmentOfRow = new Map<string, ChartDepartmentGroup>();
      const sectionOfRow = new Map<
        string,
        { department: ChartDepartmentGroup; section: ChartSectionGroup }
      >();
      for (const department of index.departments) {
        for (const row of department.rows) departmentOfRow.set(row.id, department);
        for (const section of department.sections) {
          for (const row of section.rows) sectionOfRow.set(row.id, { department, section });
        }
      }
      const activeJobs = new Set(
        chart.jobs.filter((job) => job.status === 'active').map((job) => job.id),
      );

      let skipped = 0;
      const placesByJob = new Map<string, Map<string, PlaceKeyed>>();
      const seenTriples = new Set<string>();
      for (const held of holders) {
        const triple =
          `${held.departmentId}|${held.sectionId ?? ''}|${held.jobTitleId}`.toLowerCase();
        if (seenTriples.has(triple)) continue;
        seenTriples.add(triple);
        const department = departmentOfRow.get(held.departmentId.toLowerCase());
        const entryId = department?.entry?.id ?? null;
        // Gone; a name group (no entry, and the fill creates none); already marked or hand-edited; or a
        // job that is not active — skipped, and counted.
        if (
          department === undefined ||
          entryId === null ||
          !filling.has(entryId) ||
          !activeJobs.has(held.jobTitleId.toLowerCase())
        ) {
          skipped += 1;
          continue;
        }
        const inSection =
          held.sectionId === null ? undefined : sectionOfRow.get(held.sectionId.toLowerCase());
        const sectionEntry =
          inSection !== undefined && inSection.department === department
            ? inSection.section.entry
            : null;
        const place: PlaceKeyed = {
          departmentCatalogId: entryId,
          sectionCatalogId:
            sectionEntry !== null && sectionEntry.departmentCatalogId === entryId
              ? sectionEntry.id
              : null,
        };
        const jobId = held.jobTitleId.toLowerCase();
        const set = placesByJob.get(jobId) ?? new Map<string, PlaceKeyed>();
        set.set(keyOf(place), place);
        placesByJob.set(jobId, set);
      }

      // What each job already has, in other departments (a department being filled has none, §7).
      const storedOf = (jobId: string): PlaceKeyed[] =>
        chart.places
          .filter((place) => place.jobTitleId.toLowerCase() === jobId)
          .map((place) => ({
            departmentCatalogId: place.departmentCatalogId,
            sectionCatalogId: place.sectionCatalogId,
          }));
      // Never store a set the job's own update would refuse back (JOB_PLACES_MAX): a job whose holders
      // sit in more places than that is left for a person to place.
      for (const [jobId, set] of placesByJob) {
        if (storedOf(jobId).length + set.size > JOB_PLACES_MAX) {
          logger.warn(
            { jobId, places: set.size },
            'job places: holders sit in more places than a job may have; left unplaced',
          );
          skipped += set.size;
          placesByJob.delete(jobId);
        }
      }

      const placedPer = new Map<string, number>();
      for (const set of placesByJob.values()) {
        for (const place of set.values()) {
          placedPer.set(
            place.departmentCatalogId,
            (placedPer.get(place.departmentCatalogId) ?? 0) + 1,
          );
        }
      }
      const at = new Date();
      // Marks FIRST: when two processes race, they collide here before either writes a place.
      await JobPlaceFillModel.create(
        toFill.map((d) => ({
          departmentCatalogId: new Types.ObjectId(d.entry?.id ?? ''),
          at,
          placed: placedPer.get(d.entry?.id ?? '') ?? 0,
        })),
        { session, ordered: true },
      );
      const docs = [...placesByJob.entries()].flatMap(([jobId, set]) =>
        [...set.values()].map((place) => ({
          jobTitleId: new Types.ObjectId(jobId),
          departmentCatalogId: new Types.ObjectId(place.departmentCatalogId),
          sectionCatalogId:
            place.sectionCatalogId === null ? null : new Types.ObjectId(place.sectionCatalogId),
          createdBy: null,
          updatedBy: null,
        })),
      );
      if (docs.length > 0) await JobPlaceModel.create(docs, { session, ordered: true });

      // The job's whole set before and after, as the job's own update records it.
      const audits: AuditEntry[] = [...placesByJob.entries()].map(([jobId, set]) => {
        const stored = storedOf(jobId);
        return {
          entityRef: { moduleId: 'platform', entityType: 'jobTitle', entityId: jobId },
          action: 'update',
          changes: [
            {
              field: 'places',
              old: labelPlaces(stored, chart),
              new: labelPlaces([...stored, ...set.values()], chart),
            },
          ],
          actor: { userId: null, ip: null, userAgent: null },
        };
      });
      return { result: { departments: toFill.length, placed: docs.length, skipped }, audits };
    });
    if (outcome === null) return null;
    if (outcome.audits.length > 0) await auditService.recordMany(outcome.audits);
    return outcome.result;
  } catch (error) {
    if (isDuplicateKey(error)) {
      logger.info('job places: another process filled the same departments first');
      return null;
    }
    throw error;
  }
};
