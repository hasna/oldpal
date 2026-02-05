import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

// Maximum visible items in lists before pagination kicks in
const MAX_VISIBLE_ITEMS = 5;

type ViewMode = 'list' | 'detail' | 'delete-confirm' | 'inject-confirm';

interface MessageEntry {
  id: string;
  threadId: string;
  fromAgentId: string;
  fromAgentName: string;
  subject?: string;
  preview: string;
  body?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'unread' | 'read' | 'archived' | 'injected';
  createdAt: string;
  replyCount?: number;
}

interface MessagesPanelProps {
  messages: MessageEntry[];
  onRead: (id: string) => Promise<MessageEntry>;
  onDelete: (id: string) => Promise<void>;
  onInject: (id: string) => Promise<void>;
  onReply: (id: string, body: string) => Promise<void>;
  onClose: () => void;
  error?: string | null;
}

/**
 * Calculate the visible window range for paginated lists
 */
function getVisibleRange(
  selectedIndex: number,
  totalItems: number,
  maxVisible: number = MAX_VISIBLE_ITEMS
): { start: number; end: number; hasMore: { above: number; below: number } } {
  if (totalItems <= maxVisible) {
    return {
      start: 0,
      end: totalItems,
      hasMore: { above: 0, below: 0 },
    };
  }

  const halfWindow = Math.floor(maxVisible / 2);
  let start = selectedIndex - halfWindow;
  let end = selectedIndex + (maxVisible - halfWindow);

  if (start < 0) {
    start = 0;
    end = maxVisible;
  }

  if (end > totalItems) {
    end = totalItems;
    start = Math.max(0, totalItems - maxVisible);
  }

  return {
    start,
    end,
    hasMore: {
      above: start,
      below: totalItems - end,
    },
  };
}

/**
 * Format relative time
 */
function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Get priority color
 */
function getPriorityColor(priority: MessageEntry['priority']): string {
  switch (priority) {
    case 'urgent':
      return 'red';
    case 'high':
      return 'yellow';
    case 'normal':
      return 'white';
    case 'low':
      return 'gray';
    default:
      return 'white';
  }
}

/**
 * Get status icon
 */
function getStatusIcon(status: MessageEntry['status']): string {
  switch (status) {
    case 'unread':
      return '📬';
    case 'read':
      return '📖';
    case 'injected':
      return '👁️';
    case 'archived':
      return '📦';
    default:
      return '📨';
  }
}

/**
 * Interactive panel for managing agent messages
 */
export function MessagesPanel({
  messages,
  onRead,
  onDelete,
  onInject,
  onClose,
  error,
}: MessagesPanelProps) {
  const [mode, setMode] = useState<ViewMode>('list');
  const [messageIndex, setMessageIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<MessageEntry | null>(null);
  const [injectTarget, setInjectTarget] = useState<MessageEntry | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detailMessage, setDetailMessage] = useState<MessageEntry | null>(null);

  // Calculate visible range for messages list
  const messageRange = useMemo(
    () => getVisibleRange(messageIndex, messages.length),
    [messageIndex, messages.length]
  );

  const currentMessage = messages[messageIndex];

  // Handle view details
  const handleViewDetails = async () => {
    if (!currentMessage) return;

    setIsProcessing(true);
    try {
      const details = await onRead(currentMessage.id);
      setDetailMessage(details);
      setMode('detail');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!deleteTarget) return;

    setIsProcessing(true);
    try {
      await onDelete(deleteTarget.id);
      setMode('list');
      setDeleteTarget(null);
      setDetailMessage(null);
      // Adjust index if needed
      if (messageIndex >= messages.length - 1 && messageIndex > 0) {
        setMessageIndex(messageIndex - 1);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle inject
  const handleInject = async () => {
    if (!injectTarget) return;

    setIsProcessing(true);
    try {
      await onInject(injectTarget.id);
      setMode('list');
      setInjectTarget(null);
      setDetailMessage(null);
    } finally {
      setIsProcessing(false);
    }
  };

  // Keyboard navigation
  useInput((input, key) => {
    if (isProcessing) return;

    // Exit with q or Escape at top level
    if (input === 'q' || (key.escape && mode === 'list')) {
      onClose();
      return;
    }

    // Escape to go back
    if (key.escape) {
      if (mode === 'detail') {
        setMode('list');
        setDetailMessage(null);
      } else if (mode === 'delete-confirm') {
        setMode('detail');
        setDeleteTarget(null);
      } else if (mode === 'inject-confirm') {
        setMode('detail');
        setInjectTarget(null);
      }
      return;
    }

    // List mode navigation
    if (mode === 'list') {
      if (key.upArrow) {
        setMessageIndex((prev) => (prev === 0 ? messages.length - 1 : prev - 1));
        return;
      }
      if (key.downArrow) {
        setMessageIndex((prev) => (prev === messages.length - 1 ? 0 : prev + 1));
        return;
      }
      if (key.return && currentMessage) {
        handleViewDetails();
        return;
      }
      // Number keys for quick selection
      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= messages.length) {
        setMessageIndex(num - 1);
      }
      return;
    }

    // Detail mode
    if (mode === 'detail') {
      if (input === 'i') {
        if (detailMessage) {
          setInjectTarget(detailMessage);
          setMode('inject-confirm');
        }
        return;
      }
      if (input === 'x' || key.delete) {
        if (detailMessage) {
          setDeleteTarget(detailMessage);
          setMode('delete-confirm');
        }
        return;
      }
      return;
    }

    // Delete confirm mode
    if (mode === 'delete-confirm') {
      if (input === 'y') {
        handleDelete();
        return;
      }
      if (input === 'n') {
        setMode('detail');
        setDeleteTarget(null);
        return;
      }
    }

    // Inject confirm mode
    if (mode === 'inject-confirm') {
      if (input === 'y') {
        handleInject();
        return;
      }
      if (input === 'n') {
        setMode('detail');
        setInjectTarget(null);
        return;
      }
    }
  });

  // Empty state
  if (messages.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Messages</Text>
        </Box>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          paddingY={1}
        >
          <Text dimColor>No messages in inbox.</Text>
          <Text dimColor>Use the messages_send tool to send messages to other agents.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>q quit</Text>
        </Box>
      </Box>
    );
  }

  // Delete confirmation
  if (mode === 'delete-confirm' && deleteTarget) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="red">Delete Message</Text>
        </Box>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="red"
          paddingX={1}
          paddingY={1}
        >
          <Text>Are you sure you want to delete this message?</Text>
          <Text dimColor>From: {deleteTarget.fromAgentName}</Text>
          {deleteTarget.subject && <Text dimColor>Subject: {deleteTarget.subject}</Text>}
          <Text dimColor>This action cannot be undone.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>y confirm | n cancel</Text>
        </Box>
      </Box>
    );
  }

  // Inject confirmation
  if (mode === 'inject-confirm' && injectTarget) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="green">Inject Message</Text>
        </Box>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="green"
          paddingX={1}
          paddingY={1}
        >
          <Text>Inject this message into the current conversation?</Text>
          <Text dimColor>From: {injectTarget.fromAgentName}</Text>
          {injectTarget.subject && <Text dimColor>Subject: {injectTarget.subject}</Text>}
          <Text dimColor>The message will be added to the context.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>y confirm | n cancel</Text>
        </Box>
      </Box>
    );
  }

  // Detail view
  if (mode === 'detail' && detailMessage) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">{getStatusIcon(detailMessage.status)} Message</Text>
          <Text color={getPriorityColor(detailMessage.priority)}> [{detailMessage.priority}]</Text>
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          paddingY={1}
        >
          <Box>
            <Text dimColor>From: </Text>
            <Text>{detailMessage.fromAgentName}</Text>
          </Box>

          {detailMessage.subject && (
            <Box>
              <Text dimColor>Subject: </Text>
              <Text bold>{detailMessage.subject}</Text>
            </Box>
          )}

          <Box>
            <Text dimColor>Received: </Text>
            <Text>{formatRelativeTime(detailMessage.createdAt)}</Text>
            <Text dimColor> ({new Date(detailMessage.createdAt).toLocaleString()})</Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Message:</Text>
            <Text>{detailMessage.body || detailMessage.preview}</Text>
          </Box>
        </Box>

        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            i inject | x delete | Esc back
          </Text>
        </Box>
      </Box>
    );
  }

  // List view (default)
  const visibleMessages = messages.slice(messageRange.start, messageRange.end);

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Messages</Text>
        {messages.length > MAX_VISIBLE_ITEMS && (
          <Text dimColor> ({messageIndex + 1}/{messages.length})</Text>
        )}
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
      >
        {messageRange.hasMore.above > 0 && (
          <Box paddingY={0}>
            <Text dimColor>  ↑ {messageRange.hasMore.above} more above</Text>
          </Box>
        )}

        {visibleMessages.map((msg, visibleIdx) => {
          const actualIdx = messageRange.start + visibleIdx;
          const isSelected = actualIdx === messageIndex;
          const prefix = isSelected ? '> ' : '  ';
          const statusIcon = getStatusIcon(msg.status);
          const priorityColor = getPriorityColor(msg.priority);
          const fromName = msg.fromAgentName.slice(0, 12).padEnd(12);
          const subject = (msg.subject || msg.preview.slice(0, 25)).padEnd(25);

          return (
            <Box key={msg.id} paddingY={0}>
              <Text inverse={isSelected} dimColor={!isSelected}>
                {prefix}{statusIcon}{' '}
              </Text>
              <Text color={priorityColor} inverse={isSelected}>
                {msg.priority === 'urgent' ? '!' : msg.priority === 'high' ? '↑' : ' '}
              </Text>
              <Text inverse={isSelected} dimColor={msg.status === 'read'}>
                {' '}{fromName}
              </Text>
              <Text inverse={isSelected} dimColor={msg.status === 'read'}>
                {' '}{subject}
              </Text>
              <Text inverse={isSelected} dimColor>
                {' '}{formatRelativeTime(msg.createdAt)}
              </Text>
            </Box>
          );
        })}

        {messageRange.hasMore.below > 0 && (
          <Box paddingY={0}>
            <Text dimColor>  ↓ {messageRange.hasMore.below} more below</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Legend: </Text>
        <Text>📬</Text>
        <Text dimColor> unread | </Text>
        <Text>📖</Text>
        <Text dimColor> read | </Text>
        <Text>👁️</Text>
        <Text dimColor> injected</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ select | Enter view | q quit
        </Text>
      </Box>
    </Box>
  );
}
