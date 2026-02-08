import { join } from 'path';
import { mkdir, readFile, open, unlink } from 'fs/promises';
import { generateId } from '@hasna/assistants-shared';
import type { Task, TaskPriority, TaskStatus, TaskStoreData, TaskCreateOptions, TaskRecurrence } from './types';
import { PRIORITY_ORDER } from './types';
import { getNextCronRun } from '../scheduler/cron';
import { atomicWriteFile } from '../utils/atomic-write';

const TASKS_DIR = '.assistants/tasks';
const TASKS_FILE = 'tasks.json';
const TASKS_LOCK_FILE = 'tasks.lock.json';
const DEFAULT_TASK_LOCK_TTL_MS = 10 * 1000;
const MAX_TASK_LOCK_RETRIES = 2;

function tasksDir(cwd: string): string {
  return join(cwd, TASKS_DIR);
}

function tasksPath(cwd: string): string {
  return join(tasksDir(cwd), TASKS_FILE);
}

function taskLockPath(cwd: string): string {
  return join(tasksDir(cwd), TASKS_LOCK_FILE);
}

async function ensureTasksDir(cwd: string): Promise<void> {
  await mkdir(tasksDir(cwd), { recursive: true });
}

async function acquireTaskLock(
  cwd: string,
  ownerId: string,
  ttlMs: number = DEFAULT_TASK_LOCK_TTL_MS,
  retryDepth: number = 0
): Promise<boolean> {
  if (retryDepth >= MAX_TASK_LOCK_RETRIES) return false;
  await ensureTasksDir(cwd);
  const path = taskLockPath(cwd);
  const now = Date.now();

  try {
    const handle = await open(path, 'wx');
    await handle.writeFile(JSON.stringify({ ownerId, createdAt: now, updatedAt: now, ttlMs }, null, 2), 'utf-8');
    await handle.close();
    return true;
  } catch {
    try {
      const raw = await readFile(path, 'utf-8');
      const lock = JSON.parse(raw) as { ownerId?: string; createdAt?: number; updatedAt?: number; ttlMs?: number };
      const updatedAt = lock?.updatedAt || lock?.createdAt || 0;
      const ttl = lock?.ttlMs ?? ttlMs;
      if (now - updatedAt > ttl) {
        await unlink(path);
        return acquireTaskLock(cwd, ownerId, ttlMs, retryDepth + 1);
      }
    } catch {
      if (retryDepth < MAX_TASK_LOCK_RETRIES) {
        try {
          await unlink(path);
          return acquireTaskLock(cwd, ownerId, ttlMs, retryDepth + 1);
        } catch {
          return false;
        }
      }
    }
  }

  return false;
}

async function releaseTaskLock(cwd: string, ownerId: string): Promise<void> {
  const path = taskLockPath(cwd);
  try {
    const raw = await readFile(path, 'utf-8');
    const lock = JSON.parse(raw) as { ownerId?: string };
    if (lock?.ownerId === ownerId) {
      await unlink(path);
    }
  } catch {
    // Ignore missing lock
  }
}

async function withTaskStoreLock<T>(cwd: string, fn: (data: TaskStoreData) => Promise<T>): Promise<T> {
  const ownerId = generateId();
  const locked = await acquireTaskLock(cwd, ownerId);
  if (!locked) {
    throw new Error('Task store is locked');
  }

  try {
    const data = await loadTaskStore(cwd);
    const result = await fn(data);
    await saveTaskStore(cwd, data);
    return result;
  } finally {
    await releaseTaskLock(cwd, ownerId);
  }
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
    // Sanitize blockedBy/blocks to remove references to missing tasks
    const knownIds = new Set(data.tasks.map((t) => t.id));
    for (const task of data.tasks) {
      if (task.blockedBy?.length) {
        const filtered = task.blockedBy.filter((id) => knownIds.has(id));
        task.blockedBy = filtered.length > 0 ? Array.from(new Set(filtered)) : undefined;
      }
      if (task.blocks?.length) {
        const filtered = task.blocks.filter((id) => knownIds.has(id));
        task.blocks = filtered.length > 0 ? Array.from(new Set(filtered)) : undefined;
      }
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
  await atomicWriteFile(tasksPath(cwd), JSON.stringify(data, null, 2));
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
 * Resolve a task by exact ID or unique ID prefix
 */
export async function resolveTaskId(
  cwd: string,
  idOrPrefix: string,
  filter?: (task: Task) => boolean
): Promise<{ task: Task | null; matches: Task[] }> {
  const data = await loadTaskStore(cwd);
  const candidates = filter ? data.tasks.filter(filter) : data.tasks;

  const exact = candidates.find((t) => t.id === idOrPrefix);
  if (exact) {
    return { task: exact, matches: [exact] };
  }

  const matches = candidates.filter((t) => t.id.startsWith(idOrPrefix));
  return { task: matches.length === 1 ? matches[0] : null, matches };
}

/**
 * Calculate the next run time for a recurring task
 */
function calculateNextRunAt(recurrence: TaskRecurrence, fromTime: number): number | undefined {
  if (recurrence.endAt && fromTime >= recurrence.endAt) {
    return undefined; // Past end date
  }
  if (recurrence.maxOccurrences && (recurrence.occurrenceCount ?? 0) >= recurrence.maxOccurrences) {
    return undefined; // Reached max occurrences
  }

  if (recurrence.kind === 'cron' && recurrence.cron) {
    return getNextCronRun(recurrence.cron, fromTime, recurrence.timezone);
  }

  if (recurrence.kind === 'interval' && recurrence.intervalMs) {
    return fromTime + recurrence.intervalMs;
  }

  return undefined;
}

/**
 * Add a new task to the queue
 */
export async function addTask(
  cwd: string,
  options: TaskCreateOptions | string,
  priority: TaskPriority = 'normal',
  projectId?: string
): Promise<Task> {
  return withTaskStoreLock(cwd, async (data) => {
    const now = Date.now();

    // Support both old (description, priority, projectId) and new (options object) signatures
    const opts: TaskCreateOptions =
      typeof options === 'string'
        ? { description: options, priority, projectId }
        : options;

    // Build recurrence config if provided
    let recurrence: TaskRecurrence | undefined;
    let nextRunAt: number | undefined;
    let isRecurringTemplate = false;

    if (opts.recurrence) {
      recurrence = {
        kind: opts.recurrence.kind,
        cron: opts.recurrence.cron,
        intervalMs: opts.recurrence.intervalMs,
        timezone: opts.recurrence.timezone,
        maxOccurrences: opts.recurrence.maxOccurrences,
        endAt: opts.recurrence.endAt,
        occurrenceCount: 0,
      };
      nextRunAt = calculateNextRunAt(recurrence, now);
      isRecurringTemplate = true;
    }

    const existingIds = new Set(data.tasks.map((t) => t.id));
    const filteredBlockedBy = opts.blockedBy?.filter((id) => existingIds.has(id)) ?? [];
    const filteredBlocks = opts.blocks?.filter((id) => existingIds.has(id)) ?? [];

    const task: Task = {
      id: generateId(),
      description: opts.description.trim(),
      status: 'pending',
      priority: opts.priority ?? 'normal',
      createdAt: now,
      projectId: opts.projectId,
      blockedBy: filteredBlockedBy.length ? filteredBlockedBy : undefined,
      blocks: filteredBlocks.length ? filteredBlocks : undefined,
      assignee: opts.assignee || undefined,
      recurrence,
      isRecurringTemplate,
      nextRunAt,
    };

    // If this task blocks other tasks, update those tasks' blockedBy arrays
    if (filteredBlocks.length) {
      for (const blockedId of filteredBlocks) {
        const blockedTask = data.tasks.find((t) => t.id === blockedId);
        if (blockedTask) {
          blockedTask.blockedBy = blockedTask.blockedBy || [];
          if (!blockedTask.blockedBy.includes(task.id)) {
            blockedTask.blockedBy.push(task.id);
          }
        }
      }
    }

    // If this task is blocked by others, update those tasks' blocks arrays
    if (filteredBlockedBy.length) {
      for (const blockingId of filteredBlockedBy) {
        const blockingTask = data.tasks.find((t) => t.id === blockingId);
        if (blockingTask) {
          blockingTask.blocks = blockingTask.blocks || [];
          if (!blockingTask.blocks.includes(task.id)) {
            blockingTask.blocks.push(task.id);
          }
        }
      }
    }

    data.tasks.push(task);
    return task;
  });
}

/**
 * Update a task
 */
export async function updateTask(
  cwd: string,
  id: string,
  updates: Partial<Pick<Task, 'status' | 'priority' | 'result' | 'error' | 'startedAt' | 'completedAt'>>
): Promise<Task | null> {
  return withTaskStoreLock(cwd, async (data) => {
    const task = data.tasks.find((t) => t.id === id);
    if (!task) return null;

    if (updates.status !== undefined) task.status = updates.status;
    if (updates.priority !== undefined) task.priority = updates.priority;
    if (updates.result !== undefined) task.result = updates.result;
    if (updates.error !== undefined) task.error = updates.error;
    if (updates.startedAt !== undefined) task.startedAt = updates.startedAt;
    if (updates.completedAt !== undefined) task.completedAt = updates.completedAt;

    return task;
  });
}

/**
 * Delete a task
 */
export async function deleteTask(cwd: string, id: string): Promise<boolean> {
  return withTaskStoreLock(cwd, async (data) => {
    const removedIds = new Set<string>();
    const index = data.tasks.findIndex((t) => t.id === id);
    if (index === -1) return false;
    removedIds.add(data.tasks[index].id);
    data.tasks.splice(index, 1);
    if (removedIds.size > 0) {
      for (const task of data.tasks) {
        if (task.blockedBy?.length) {
          task.blockedBy = task.blockedBy.filter((blockedId) => !removedIds.has(blockedId));
          if (task.blockedBy.length === 0) {
            task.blockedBy = undefined;
          }
        }
        if (task.blocks?.length) {
          task.blocks = task.blocks.filter((blockedId) => !removedIds.has(blockedId));
          if (task.blocks.length === 0) {
            task.blocks = undefined;
          }
        }
      }
    }
    return true;
  });
}

/**
 * Clear all pending tasks
 */
export async function clearPendingTasks(cwd: string): Promise<number> {
  return withTaskStoreLock(cwd, async (data) => {
    const before = data.tasks.length;
    const removedIds = new Set<string>();
    data.tasks = data.tasks.filter((t) => {
      if (t.status === 'pending') {
        removedIds.add(t.id);
        return false;
      }
      return true;
    });
    if (removedIds.size > 0) {
      for (const task of data.tasks) {
        if (task.blockedBy?.length) {
          task.blockedBy = task.blockedBy.filter((blockedId) => !removedIds.has(blockedId));
          if (task.blockedBy.length === 0) {
            task.blockedBy = undefined;
          }
        }
        if (task.blocks?.length) {
          task.blocks = task.blocks.filter((blockedId) => !removedIds.has(blockedId));
          if (task.blocks.length === 0) {
            task.blocks = undefined;
          }
        }
      }
    }
    return before - data.tasks.length;
  });
}

/**
 * Clear completed tasks
 */
export async function clearCompletedTasks(cwd: string): Promise<number> {
  return withTaskStoreLock(cwd, async (data) => {
    const before = data.tasks.length;
    const removedIds = new Set<string>();
    data.tasks = data.tasks.filter((t) => {
      if (t.status === 'completed' || t.status === 'failed') {
        removedIds.add(t.id);
        return false;
      }
      return true;
    });
    if (removedIds.size > 0) {
      for (const task of data.tasks) {
        if (task.blockedBy?.length) {
          task.blockedBy = task.blockedBy.filter((blockedId) => !removedIds.has(blockedId));
          if (task.blockedBy.length === 0) {
            task.blockedBy = undefined;
          }
        }
        if (task.blocks?.length) {
          task.blocks = task.blocks.filter((blockedId) => !removedIds.has(blockedId));
          if (task.blocks.length === 0) {
            task.blocks = undefined;
          }
        }
      }
    }
    return before - data.tasks.length;
  });
}

/**
 * Get the next pending task by priority
 */
export async function getNextTask(cwd: string): Promise<Task | null> {
  const data = await loadTaskStore(cwd);

  // Get completed task IDs for checking blockers
  const completedIds = new Set(
    data.tasks
      .filter((t) => t.status === 'completed')
      .map((t) => t.id)
  );

  // Filter to pending tasks that are not blocked
  const pending = data.tasks.filter((t) => {
    if (t.status !== 'pending') return false;
    // If task has blockers, check if all blockers are completed
    if (t.blockedBy?.length) {
      return t.blockedBy.every((blockerId) => completedIds.has(blockerId));
    }
    return true;
  });

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
  await withTaskStoreLock(cwd, async (data) => {
    data.paused = paused;
  });
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
  await withTaskStoreLock(cwd, async (data) => {
    data.autoRun = autoRun;
  });
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

/**
 * Get all recurring task templates
 */
export async function getRecurringTasks(cwd: string): Promise<Task[]> {
  const data = await loadTaskStore(cwd);
  return data.tasks.filter((t) => t.isRecurringTemplate);
}

/**
 * Get due recurring tasks that need instances created
 */
export async function getDueRecurringTasks(cwd: string): Promise<Task[]> {
  const data = await loadTaskStore(cwd);
  const now = Date.now();
  return data.tasks.filter(
    (t) => t.isRecurringTemplate && t.nextRunAt && t.nextRunAt <= now
  );
}

/**
 * Create a task instance from a recurring template
 */
export async function createRecurringInstance(cwd: string, templateId: string): Promise<Task | null> {
  return withTaskStoreLock(cwd, async (data) => {
    const template = data.tasks.find((t) => t.id === templateId && t.isRecurringTemplate);
    if (!template || !template.recurrence) return null;

    const now = Date.now();

    // Create instance task
    const instance: Task = {
      id: generateId(),
      description: template.description,
      status: 'pending',
      priority: template.priority,
      createdAt: now,
      projectId: template.projectId,
      assignee: template.assignee,
      recurrence: {
        ...template.recurrence,
        parentId: template.id,
      },
    };

    // Update template
    template.recurrence.occurrenceCount = (template.recurrence.occurrenceCount ?? 0) + 1;
    template.nextRunAt = calculateNextRunAt(template.recurrence, now);

    // If no more runs scheduled, mark template as inactive but keep it
    if (!template.nextRunAt) {
      template.status = 'completed';
      template.completedAt = now;
      template.result = `Recurring task completed after ${template.recurrence.occurrenceCount} occurrence(s)`;
    }

    data.tasks.push(instance);
    return instance;
  });
}

/**
 * Process all due recurring tasks and create instances
 */
export async function processDueRecurringTasks(cwd: string): Promise<Task[]> {
  const dueTasks = await getDueRecurringTasks(cwd);
  const createdInstances: Task[] = [];

  for (const template of dueTasks) {
    const instance = await createRecurringInstance(cwd, template.id);
    if (instance) {
      createdInstances.push(instance);
    }
  }

  return createdInstances;
}

/**
 * Cancel a recurring task (stops future instances)
 */
export async function cancelRecurringTask(cwd: string, id: string): Promise<Task | null> {
  return withTaskStoreLock(cwd, async (data) => {
    const task = data.tasks.find((t) => t.id === id && t.isRecurringTemplate);
    if (!task) return null;

    task.status = 'completed';
    task.completedAt = Date.now();
    task.nextRunAt = undefined;
    task.result = 'Recurring task cancelled';

    return task;
  });
}
