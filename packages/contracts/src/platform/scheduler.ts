// Scheduler service (Review R3): a thin registry of scheduled tasks — declared in code,
// inventoried in one collection, executed by BullMQ repeatable jobs.
export interface ScheduledTaskDto {
  key: string;
  description: string;
  cron: string;
  ownerService: string;
  status: 'active' | 'paused';
  lastRunAt: string | null;
  lastResult: 'ok' | 'failed' | null;
}
