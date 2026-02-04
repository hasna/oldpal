import { join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { generateId } from '@hasna/assistants-shared';
import type { Task, TaskPriority, TaskStatus, TaskStoreData } from './types';
import { PRIORITY_ORDER } from './types';

const TASKS_DIR = '.assistants/tasks';
const TASKS_FILE = 'tasks.json';

function tasksDir(cwd: string): string {
  return join(cwd, TASKS_DIR);
}

function tasksPath(cwd: string): string {
  return join(tasksDir(cwd), TASKS_FILE);
}

async function ensureTasksDir(cwd: string): Promise<void> {
  await mkdir(tasksDir(cwd), { recursive: true });
}

function defaultStoreData(): TaskStoreData {
  return {
    tasks: [],
    paused: false,
    autoRun: true,
  };
}

/**
 * Load task store data from disk
 */
export async function loadTaskStore(cwd: string): Promise<TaskStoreData> {
  try {
    const raw = await readFile(tasksPath(cwd), 'utf-8');
    const data = JSON.parse(raw) as TaskStoreData;
    // Validate structure
    if (!Array.isArray(data.tasks)) {
      return defaultStoreData();
    }
    return {
      tasks: data.tasks,
      paused: data.paused ?? false,
      autoRun: data.autoRun ?? true,
    };
  } catch {
    return defaultStoreData();
  }
}

/**
 * Save task store data to disk
 */
export async function saveTaskStore(cwd: string, data: TaskStoreData): Promise<void> {
  await ensureTasksDir(cwd);
  await writeFile(tasksPath(cwd), JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Get all tasks
 */
export async function getTasks(cwd: string): Promise<Task[]> {
  const data = await loadTaskStore(cwd);
  return data.tasks;
}

/**
 * Get a single task by ID
 */
export async function getTask(cwd: string, id: string): Promise<Task | null> {
  const data = await loadTaskStore(cwd);
  return data.tasks.find((t) => t.id === id) || null;
}

/**
 * Add a new task to the queue
 */
export async function addTask(
  cwd: string,
  description: string,
  priority: TaskPriority = 'normal',
  projectId?: string
): Promise<Task> {
  const data = await loadTaskStore(cwd);
  const now = Date.now();
  const task: Task = {
    id: generateId(),
    description: description.trim(),
    status: 'pending',
    priority,
    createdAt: now,
    projectId,
  };
  data.tasks.push(task);
  await saveTaskStore(cwd, data);
  return task;
}

/**
 * Update a task
 */
export async function updateTask(
  cwd: string,
  id: string,
  updates: Partial<Pick<Task, 'status' | 'priority' | 'result' | 'error' | 'startedAt' | 'completedAt'>>
): Promise<Task | null> {
  const data = await loadTaskStore(cwd);
  const task = data.tasks.find((t) => t.id === id);
  if (!task) return null;

  if (updates.status !== undefined) task.status = updates.status;
  if (updates.priority !== undefined) task.priority = updates.priority;
  if (updates.result !== undefined) task.result = updates.result;
  if (updates.error !== undefined) task.error = updates.error;
  if (updates.startedAt !== undefined) task.startedAt = updates.startedAt;
  if (updates.completedAt !== undefined) task.completedAt = updates.completedAt;

  await saveTaskStore(cwd, data);
  return task;
}

/**
 * Delete a task
 */
export async function deleteTask(cwd: string, id: string): Promise<boolean> {
  const data = await loadTaskStore(cwd);
  const index = data.tasks.findIndex((t) => t.id === id);
  if (index === -1) return false;
  data.tasks.splice(index, 1);
  await saveTaskStore(cwd, data);
  return true;
}

/**
 * Clear all pending tasks
 */
export async function clearPendingTasks(cwd: string): Promise<number> {
  const data = await loadTaskStore(cwd);
  const before = data.tasks.length;
  data.tasks = data.tasks.filter((t) => t.status !== 'pending');
  const cleared = before - data.tasks.length;
  await saveTaskStore(cwd, data);
  return cleared;
}

/**
 * Clear completed tasks
 */
export async function clearCompletedTasks(cwd: string): Promise<number> {
  const data = await loadTaskStore(cwd);
  const before = data.tasks.length;
  data.tasks = data.tasks.filter((t) => t.status !== 'completed' && t.status !== 'failed');
  const cleared = before - data.tasks.length;
  await saveTaskStore(cwd, data);
  return cleared;
}

/**
 * Get the next pending task by priority
 */
export async function getNextTask(cwd: string): Promise<Task | null> {
  const data = await loadTaskStore(cwd);
  const pending = data.tasks.filter((t) => t.status === 'pending');
  if (pending.length === 0) return null;

  // Sort by priority (high first), then by creation time (oldest first)
  pending.sort((a, b) => {
    const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return a.createdAt - b.createdAt;
  });

  return pending[0];
}

/**
 * Check if the task queue is paused
 */
export async function isPaused(cwd: string): Promise<boolean> {
  const data = await loadTaskStore(cwd);
  return data.paused;
}

/**
 * Set the paused state
 */
export async function setPaused(cwd: string, paused: boolean): Promise<void> {
  const data = await loadTaskStore(cwd);
  data.paused = paused;
  await saveTaskStore(cwd, data);
}

/**
 * Check if auto-run is enabled
 */
export async function isAutoRun(cwd: string): Promise<boolean> {
  const data = await loadTaskStore(cwd);
  return data.autoRun;
}

/**
 * Set auto-run state
 */
export async function setAutoRun(cwd: string, autoRun: boolean): Promise<void> {
  const data = await loadTaskStore(cwd);
  data.autoRun = autoRun;
  await saveTaskStore(cwd, data);
}

/**
 * Mark a task as started
 */
export async function startTask(cwd: string, id: string): Promise<Task | null> {
  return updateTask(cwd, id, {
    status: 'in_progress',
    startedAt: Date.now(),
  });
}

/**
 * Mark a task as completed
 */
export async function completeTask(cwd: string, id: string, result?: string): Promise<Task | null> {
  return updateTask(cwd, id, {
    status: 'completed',
    completedAt: Date.now(),
    result,
  });
}

/**
 * Mark a task as failed
 */
export async function failTask(cwd: string, id: string, error?: string): Promise<Task | null> {
  return updateTask(cwd, id, {
    status: 'failed',
    completedAt: Date.now(),
    error,
  });
}

/**
 * Get task counts by status
 */
export async function getTaskCounts(cwd: string): Promise<Record<TaskStatus, number>> {
  const data = await loadTaskStore(cwd);
  const counts: Record<TaskStatus, number> = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
  };
  for (const task of data.tasks) {
    counts[task.status]++;
  }
  return counts;
}
