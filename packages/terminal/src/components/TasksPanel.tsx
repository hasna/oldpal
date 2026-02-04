import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Task, TaskPriority, TaskStatus } from '@hasna/assistants-core';

interface TasksPanelProps {
  tasks: Task[];
  paused: boolean;
  onAdd: (description: string, priority: TaskPriority) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRun: (id: string) => Promise<void>;
  onClearPending: () => Promise<void>;
  onClearCompleted: () => Promise<void>;
  onTogglePause: () => Promise<void>;
  onChangePriority: (id: string, priority: TaskPriority) => Promise<void>;
  onClose: () => void;
}

type Mode = 'list' | 'create' | 'delete-confirm' | 'priority-select';

const STATUS_ICONS: Record<TaskStatus, string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
  failed: '✗',
};

const STATUS_COLORS: Record<TaskStatus, string | undefined> = {
  pending: undefined,
  in_progress: 'yellow',
  completed: 'green',
  failed: 'red',
};

const PRIORITY_ICONS: Record<TaskPriority, string> = {
  high: '↑',
  normal: '-',
  low: '↓',
};

const PRIORITY_COLORS: Record<TaskPriority, string | undefined> = {
  high: 'red',
  normal: undefined,
  low: 'gray',
};

/**
 * Format date for task display
 */
function formatTaskTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).toLowerCase();
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  }).toLowerCase();
}

export function TasksPanel({
  tasks,
  paused,
  onAdd,
  onDelete,
  onRun,
  onClearPending,
  onClearCompleted,
  onTogglePause,
  onChangePriority,
  onClose,
}: TasksPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>('normal');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, tasks.length)));
  }, [tasks.length]);

  useInput((input, key) => {
    // In create mode, handle text input
    if (mode === 'create') {
      if (key.escape) {
        setMode('list');
        setNewDescription('');
        setNewPriority('normal');
        return;
      }
      // Tab to cycle priority
      if (key.tab) {
        setNewPriority((prev) => {
          if (prev === 'normal') return 'high';
          if (prev === 'high') return 'low';
          return 'normal';
        });
        return;
      }
      // Text input handled by TextInput component
      return;
    }

    // In delete confirmation mode
    if (mode === 'delete-confirm') {
      if (input === 'y' || input === 'Y') {
        const task = tasks[selectedIndex];
        if (task) {
          setIsSubmitting(true);
          onDelete(task.id).finally(() => {
            setIsSubmitting(false);
            setMode('list');
          });
        }
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setMode('list');
        return;
      }
      return;
    }

    // In priority select mode
    if (mode === 'priority-select') {
      const task = tasks[selectedIndex];
      if (input === 'h' || input === 'H') {
        if (task) {
          setIsSubmitting(true);
          onChangePriority(task.id, 'high').finally(() => {
            setIsSubmitting(false);
            setMode('list');
          });
        }
        return;
      }
      if (input === 'n' || input === 'N') {
        if (task) {
          setIsSubmitting(true);
          onChangePriority(task.id, 'normal').finally(() => {
            setIsSubmitting(false);
            setMode('list');
          });
        }
        return;
      }
      if (input === 'l' || input === 'L') {
        if (task) {
          setIsSubmitting(true);
          onChangePriority(task.id, 'low').finally(() => {
            setIsSubmitting(false);
            setMode('list');
          });
        }
        return;
      }
      if (key.escape) {
        setMode('list');
        return;
      }
      return;
    }

    // List mode shortcuts
    // n: new task
    if (input === 'n' || input === 'N') {
      setMode('create');
      return;
    }

    // d: delete selected task
    if (input === 'd' || input === 'D') {
      if (tasks.length > 0 && selectedIndex < tasks.length) {
        setMode('delete-confirm');
      }
      return;
    }

    // p: change priority of selected task
    if (input === 'p' || input === 'P') {
      if (tasks.length > 0 && selectedIndex < tasks.length) {
        setMode('priority-select');
      }
      return;
    }

    // r: run selected task
    if (input === 'r' || input === 'R') {
      const task = tasks[selectedIndex];
      if (task && task.status === 'pending') {
        setIsSubmitting(true);
        onRun(task.id).finally(() => {
          setIsSubmitting(false);
          onClose();
        });
      }
      return;
    }

    // Space: toggle pause
    if (input === ' ') {
      setIsSubmitting(true);
      onTogglePause().finally(() => {
        setIsSubmitting(false);
      });
      return;
    }

    // c: clear completed
    if (input === 'c' || input === 'C') {
      setIsSubmitting(true);
      onClearCompleted().finally(() => {
        setIsSubmitting(false);
      });
      return;
    }

    // Escape: close panel
    if (key.escape) {
      onClose();
      return;
    }

    // Enter: run selected task (if pending)
    if (key.return) {
      if (selectedIndex === tasks.length) {
        // "New task" option
        setMode('create');
      } else {
        const task = tasks[selectedIndex];
        if (task && task.status === 'pending') {
          setIsSubmitting(true);
          onRun(task.id).finally(() => {
            setIsSubmitting(false);
            onClose();
          });
        }
      }
      return;
    }

    // Arrow navigation with wraparound
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev === 0 ? tasks.length : prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => (prev === tasks.length ? 0 : prev + 1));
      return;
    }

    // Number keys for quick selection (1-9)
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= tasks.length) {
      setSelectedIndex(num - 1);
      return;
    }
  }, { isActive: mode !== 'create' });

  const handleCreateSubmit = async () => {
    if (!newDescription.trim()) return;
    setIsSubmitting(true);
    try {
      await onAdd(newDescription.trim(), newPriority);
      setNewDescription('');
      setNewPriority('normal');
      setMode('list');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Create mode UI
  if (mode === 'create') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Add New Task</Text>
        </Box>

        <Box flexDirection="column">
          <Box>
            <Text>Task: </Text>
            <TextInput
              value={newDescription}
              onChange={setNewDescription}
              onSubmit={handleCreateSubmit}
              placeholder="What needs to be done..."
            />
          </Box>
          <Box marginTop={1}>
            <Text>Priority: </Text>
            <Text color={PRIORITY_COLORS[newPriority]}>
              {PRIORITY_ICONS[newPriority]} {newPriority}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Enter to add | Tab to change priority | Esc to cancel</Text>
          </Box>
        </Box>

        {isSubmitting && (
          <Box marginTop={1}>
            <Text color="yellow">Adding task...</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Delete confirmation mode
  if (mode === 'delete-confirm') {
    const task = tasks[selectedIndex];
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="red">Delete Task</Text>
        </Box>
        <Box marginBottom={1}>
          <Text>
            Delete task: &quot;{task?.description.slice(0, 50)}{(task?.description.length || 0) > 50 ? '...' : ''}&quot;?
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            Press <Text color="green" bold>y</Text> to confirm or{' '}
            <Text color="red" bold>n</Text> to cancel
          </Text>
        </Box>
      </Box>
    );
  }

  // Priority select mode
  if (mode === 'priority-select') {
    const task = tasks[selectedIndex];
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Change Priority</Text>
        </Box>
        <Box marginBottom={1}>
          <Text>Task: {task?.description.slice(0, 50)}{(task?.description.length || 0) > 50 ? '...' : ''}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text color="red" bold>h</Text> High priority
          </Text>
          <Text>
            <Text bold>n</Text> Normal priority
          </Text>
          <Text>
            <Text color="gray" bold>l</Text> Low priority
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press letter to select | Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  // Count tasks by status
  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;

  // List mode UI
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Box>
          <Text bold>Tasks </Text>
          <Text color={paused ? 'yellow' : 'green'}>
            {paused ? '(Paused)' : '(Active)'}
          </Text>
        </Box>
        <Text dimColor>[n]ew [Space]pause</Text>
      </Box>

      {/* Status summary */}
      <Box marginBottom={1}>
        <Text dimColor>
          {pendingCount} pending, {inProgressCount} running, {completedCount} done, {failedCount} failed
        </Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
      >
        {tasks.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No tasks yet. Press n to add one.</Text>
          </Box>
        ) : (
          tasks.map((task, index) => {
            const isSelected = index === selectedIndex;
            const statusIcon = STATUS_ICONS[task.status];
            const statusColor = STATUS_COLORS[task.status];
            const priorityIcon = PRIORITY_ICONS[task.priority];
            const priorityColor = PRIORITY_COLORS[task.priority];
            const time = formatTaskTime(task.createdAt);
            const desc = task.description.slice(0, 40) + (task.description.length > 40 ? '...' : '');

            return (
              <Box key={task.id} paddingY={0}>
                <Text inverse={isSelected} dimColor={!isSelected && task.status === 'completed'}>
                  <Text color={statusColor}>{statusIcon}</Text>
                  {' '}
                  <Text color={priorityColor}>[{priorityIcon}]</Text>
                  {' '}
                  {index + 1}. {desc.padEnd(42)} {time}
                </Text>
              </Box>
            );
          })
        )}

        {/* New task option */}
        <Box marginTop={1} paddingY={0}>
          <Text
            inverse={selectedIndex === tasks.length}
            dimColor={selectedIndex !== tasks.length}
            color={selectedIndex === tasks.length ? 'cyan' : undefined}
          >
            + Add task (n)
          </Text>
        </Box>
      </Box>

      {/* Selected task details */}
      {tasks.length > 0 && selectedIndex < tasks.length && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor wrap="wrap">
            {tasks[selectedIndex].description}
          </Text>
          {tasks[selectedIndex].error && (
            <Text color="red">Error: {tasks[selectedIndex].error}</Text>
          )}
          {tasks[selectedIndex].result && (
            <Text color="green">Result: {tasks[selectedIndex].result}</Text>
          )}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          Enter/r run | p priority | d delete | c clear done | Esc close
        </Text>
      </Box>
    </Box>
  );
}
