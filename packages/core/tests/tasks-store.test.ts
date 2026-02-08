import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  addTask,
  clearCompletedTasks,
  clearPendingTasks,
  deleteTask,
  getTask,
  loadTaskStore,
  updateTask,
} from '../src/tasks/store';

describe('Task store dependency cleanup', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tasks-store-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('deleteTask removes references from blockedBy/blocks', async () => {
    const t1 = await addTask(tempDir, { description: 't1' });
    const t2 = await addTask(tempDir, { description: 't2', blockedBy: [t1.id] });

    expect((await getTask(tempDir, t2.id))?.blockedBy).toEqual([t1.id]);

    const deleted = await deleteTask(tempDir, t1.id);
    expect(deleted).toBe(true);

    const updatedT2 = await getTask(tempDir, t2.id);
    expect(updatedT2?.blockedBy).toBeUndefined();
  });

  test('clearPendingTasks removes references from remaining tasks', async () => {
    const t1 = await addTask(tempDir, { description: 't1' });
    const t2 = await addTask(tempDir, { description: 't2', blockedBy: [t1.id] });

    const removed = await clearPendingTasks(tempDir);
    expect(removed).toBe(2);

    const updatedT2 = await getTask(tempDir, t2.id);
    expect(updatedT2).toBeNull();
  });

  test('clearCompletedTasks removes references to completed tasks', async () => {
    const t1 = await addTask(tempDir, { description: 't1' });
    const t2 = await addTask(tempDir, { description: 't2', blockedBy: [t1.id] });

    await updateTask(tempDir, t1.id, { status: 'completed' });

    const removed = await clearCompletedTasks(tempDir);
    expect(removed).toBe(1);

    const updatedT2 = await getTask(tempDir, t2.id);
    expect(updatedT2?.blockedBy).toBeUndefined();
  });

  test('loadTaskStore drops missing dependency references', async () => {
    const tasksDir = join(tempDir, '.assistants', 'tasks');
    await mkdir(tasksDir, { recursive: true });
    const payload = {
      tasks: [
        {
          id: 'task-1',
          description: 'orphaned deps',
          status: 'pending',
          priority: 'normal',
          createdAt: Date.now(),
          blockedBy: ['missing-task'],
          blocks: ['missing-task'],
        },
      ],
      paused: false,
      autoRun: true,
    };
    await writeFile(join(tasksDir, 'tasks.json'), JSON.stringify(payload, null, 2), 'utf-8');

    const data = await loadTaskStore(tempDir);
    expect(data.tasks.length).toBe(1);
    expect(data.tasks[0].blockedBy).toBeUndefined();
    expect(data.tasks[0].blocks).toBeUndefined();
  });

  test('addTask ignores blockedBy/blocks that do not exist', async () => {
    const task = await addTask(tempDir, {
      description: 'child',
      blockedBy: ['missing-1'],
      blocks: ['missing-2'],
    });

    expect(task.blockedBy).toBeUndefined();
    expect(task.blocks).toBeUndefined();
  });
});
