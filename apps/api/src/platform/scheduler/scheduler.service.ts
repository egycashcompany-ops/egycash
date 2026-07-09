// Thin scheduler (Review R3): services DECLARE tasks in code; the registry syncs to
// one collection (inventory + pause/run-now controls); BullMQ repeatable jobs execute.
import { type ScheduledTaskDto } from '@ecms/contracts';
import { logger } from '../../infrastructure/logging/logger';
import {
  enqueue,
  registerJobHandler,
  removeRepeatable,
  scheduleRepeatable,
} from '../../infrastructure/queue/jobs';
import { NotFoundError } from '../../shared/errors';
import { auditService } from '../audit';
import { ScheduledTaskModel, type ScheduledTaskDoc } from './scheduled-task.model';

export interface ScheduledTaskDeclaration {
  /** `<service>.<taskName>`, e.g. `platform.outboxSweep`. */
  key: string;
  description: string;
  /** 5-field cron expression. */
  cron: string;
  ownerService: string;
  handler: () => Promise<void>;
}

class SchedulerService {
  private readonly declarations = new Map<string, ScheduledTaskDeclaration>();

  declareTask(declaration: ScheduledTaskDeclaration): void {
    if (this.declarations.has(declaration.key)) {
      throw new Error(`duplicate scheduled task: ${declaration.key}`);
    }
    this.declarations.set(declaration.key, declaration);
    registerJobHandler('scheduled', declaration.key, async () => {
      try {
        await declaration.handler();
        await ScheduledTaskModel.updateOne(
          { key: declaration.key },
          { $set: { lastRunAt: new Date(), lastResult: 'ok' } },
        ).exec();
      } catch (error) {
        await ScheduledTaskModel.updateOne(
          { key: declaration.key },
          { $set: { lastRunAt: new Date(), lastResult: 'failed' } },
        ).exec();
        logger.error({ err: error, task: declaration.key }, 'scheduled task failed');
        throw error;
      }
    });
  }

  /** Boot: mirror declarations into the registry collection (keeps manual pause state). */
  async syncRegistry(): Promise<void> {
    const keys = [...this.declarations.keys()];
    for (const declaration of this.declarations.values()) {
      await ScheduledTaskModel.updateOne(
        { key: declaration.key },
        {
          $set: {
            description: declaration.description,
            cron: declaration.cron,
            ownerService: declaration.ownerService,
          },
          $setOnInsert: { status: 'active' },
        },
        { upsert: true },
      ).exec();
    }
    await ScheduledTaskModel.deleteMany({ key: { $nin: keys } }).exec();
  }

  /** Worker boot: arm repeatable jobs for every active task. */
  async startSchedules(): Promise<void> {
    const rows = await ScheduledTaskModel.find().lean<ScheduledTaskDoc[]>().exec();
    for (const row of rows) {
      const declaration = this.declarations.get(row.key);
      if (declaration === undefined) continue;
      if (row.status === 'active') {
        await scheduleRepeatable('scheduled', row.key, declaration.cron, {});
      }
    }
    logger.info({ count: rows.length }, 'scheduler armed');
  }

  async list(): Promise<ScheduledTaskDto[]> {
    const rows = await ScheduledTaskModel.find().sort({ key: 1 }).lean<ScheduledTaskDoc[]>().exec();
    return rows.map((row) => ({
      key: row.key,
      description: row.description,
      cron: row.cron,
      ownerService: row.ownerService,
      status: row.status,
      lastRunAt: row.lastRunAt === null ? null : row.lastRunAt.toISOString(),
      lastResult: row.lastResult,
    }));
  }

  private async getTask(key: string): Promise<ScheduledTaskDoc> {
    const row = await ScheduledTaskModel.findOne({ key }).lean<ScheduledTaskDoc>().exec();
    if (row === null) throw new NotFoundError('Unknown scheduled task');
    return row;
  }

  async pause(key: string): Promise<void> {
    const row = await this.getTask(key);
    await ScheduledTaskModel.updateOne({ key }, { $set: { status: 'paused' } }).exec();
    await removeRepeatable('scheduled', key, row.cron);
    await auditService.record({
      entityRef: { moduleId: 'platform', entityType: 'scheduledTask', entityId: key },
      action: 'update',
      changes: [{ field: 'status', old: row.status, new: 'paused' }],
    });
  }

  async resume(key: string): Promise<void> {
    const row = await this.getTask(key);
    await ScheduledTaskModel.updateOne({ key }, { $set: { status: 'active' } }).exec();
    await scheduleRepeatable('scheduled', key, row.cron, {});
    await auditService.record({
      entityRef: { moduleId: 'platform', entityType: 'scheduledTask', entityId: key },
      action: 'update',
      changes: [{ field: 'status', old: row.status, new: 'active' }],
    });
  }

  async runNow(key: string): Promise<void> {
    await this.getTask(key);
    await enqueue('scheduled', key, {});
  }
}

export const schedulerService = new SchedulerService();
