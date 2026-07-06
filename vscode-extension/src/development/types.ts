export type TaskStatus = 'queued' | 'pending' | 'running' | 'done' | 'failed';

export interface TaskResult {
  summary: string;
  changedFiles: number;
  risks: number;
  timestamp: string;
}

export interface TaskEntry {
  taskId: string;
  direction: string;
  status: TaskStatus;
  createdAt: string;
  result?: TaskResult;
  docDrift?: boolean;
  // Why the last run failed (e.g. a timeout or CLI error). A failed run keeps
  // status 'failed' (it is NOT re-queued) so it stays out of the automatic
  // queue run; this lets the UI explain what went wrong and offer a retry.
  failureReason?: string;
  failedAt?: string;
}

