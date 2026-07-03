export type TaskStatus = 'queued' | 'pending' | 'running' | 'done';

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
  // Why the last run failed (e.g. a timeout or CLI error). A failed run is put
  // back on the queue, so this lets the UI still explain what went wrong.
  failureReason?: string;
  failedAt?: string;
}

