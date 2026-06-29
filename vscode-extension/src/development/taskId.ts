import * as path from 'node:path';
import type { TaskEntry } from './types.js';

export function generateTaskId(workspaceRoot: string, existingTasks: TaskEntry[]): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const alias = path.basename(workspaceRoot).toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const prefix = `${today}-${alias}`;
  const sameDay = existingTasks.filter(t => t.taskId.startsWith(prefix));
  return sameDay.length === 0 ? prefix : `${prefix}-${sameDay.length + 1}`;
}
