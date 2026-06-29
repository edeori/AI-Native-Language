import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TaskEntry, TaskResult, TaskStatus } from './types.js';

const TASKS_FILE = 'tasks.json';

function devDir(artifactRoot: string): string {
  return path.join(artifactRoot, 'development');
}

function tasksPath(artifactRoot: string): string {
  return path.join(devDir(artifactRoot), TASKS_FILE);
}

export async function loadTasks(artifactRoot: string): Promise<TaskEntry[]> {
  try {
    const raw = await fs.readFile(tasksPath(artifactRoot), 'utf8');
    return JSON.parse(raw) as TaskEntry[];
  } catch {
    return [];
  }
}

async function saveTasks(artifactRoot: string, tasks: TaskEntry[]): Promise<void> {
  await fs.mkdir(devDir(artifactRoot), { recursive: true });
  await fs.writeFile(tasksPath(artifactRoot), JSON.stringify(tasks, null, 2), 'utf8');
}

export async function addTask(artifactRoot: string, task: TaskEntry): Promise<TaskEntry[]> {
  const tasks = await loadTasks(artifactRoot);
  tasks.unshift(task);
  await saveTasks(artifactRoot, tasks);
  return tasks;
}

export async function updateTaskStatus(artifactRoot: string, taskId: string, status: TaskStatus): Promise<TaskEntry[]> {
  const tasks = await loadTasks(artifactRoot);
  const t = tasks.find(x => x.taskId === taskId);
  if (t) t.status = status;
  await saveTasks(artifactRoot, tasks);
  return tasks;
}

export async function updateTaskResult(artifactRoot: string, taskId: string, result: TaskResult): Promise<TaskEntry[]> {
  const tasks = await loadTasks(artifactRoot);
  const t = tasks.find(x => x.taskId === taskId);
  if (t) {
    t.result = result;
    t.status = 'done';
  }
  await saveTasks(artifactRoot, tasks);
  return tasks;
}

export async function patchTask(artifactRoot: string, taskId: string, patch: Partial<TaskEntry>): Promise<TaskEntry[]> {
  const tasks = await loadTasks(artifactRoot);
  const t = tasks.find(x => x.taskId === taskId);
  if (t) Object.assign(t, patch);
  await saveTasks(artifactRoot, tasks);
  return tasks;
}

export async function deleteTask(artifactRoot: string, taskId: string): Promise<TaskEntry[]> {
  const tasks = await loadTasks(artifactRoot);
  const filtered = tasks.filter(x => x.taskId !== taskId);
  await saveTasks(artifactRoot, filtered);
  const runDirectory = path.join(devDir(artifactRoot), 'runs', taskId);
  await fs.rm(runDirectory, { recursive: true, force: true });
  return filtered;
}

export async function runDir(artifactRoot: string, taskId: string): Promise<string> {
  const dir = path.join(devDir(artifactRoot), 'runs', taskId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
