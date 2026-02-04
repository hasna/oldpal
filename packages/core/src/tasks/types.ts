/**
 * Task types for the task queue management system
 */

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type TaskPriority = 'high' | 'normal' | 'low';

/**
 * A task in the queue
 */
export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  projectId?: string; // Optional association with project
}

/**
 * The persisted task store data
 */
export interface TaskStoreData {
  tasks: Task[];
  paused: boolean;
  autoRun: boolean;
}

/**
 * Priority order for sorting (higher value = higher priority)
 */
export const PRIORITY_ORDER: Record<TaskPriority, number> = {
  high: 3,
  normal: 2,
  low: 1,
};
