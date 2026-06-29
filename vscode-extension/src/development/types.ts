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
}

