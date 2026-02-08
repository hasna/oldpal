import React, { useState, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

// Maximum visible items in lists before pagination kicks in
const MAX_VISIBLE_ITEMS = 5;

type ViewMode = 'list' | 'detail' | 'delete-confirm';

interface CardEntry {
  id: string;
  name: string;
  last4: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault?: boolean;
  createdAt?: string;
}

interface WalletPanelProps {
  cards: CardEntry[];
  onGet: (cardId: string) => Promise<CardEntry & { number?: string }>;
  onRemove: (cardId: string) => Promise<void>;
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
 * Format card expiry
 */
function formatExpiry(month?: number, year?: number): string {
  if (!month || !year) return 'N/A';
  return `${month.toString().padStart(2, '0')}/${year.toString().slice(-2)}`;
}

/**
 * Interactive panel for managing wallet cards
 */
export function WalletPanel({
  cards,
  onGet,
  onRemove,
  onClose,
  error,
}: WalletPanelProps) {
  const [mode, setMode] = useState<ViewMode>('list');
  const [cardIndex, setCardIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<CardEntry | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detailCard, setDetailCard] = useState<CardEntry | null>(null);

  // Calculate visible range for cards list
  const cardRange = useMemo(
    () => getVisibleRange(cardIndex, cards.length),
    [cardIndex, cards.length]
  );

  const currentCard = cards[cardIndex];

  // Handle view details
  const handleViewDetails = async () => {
    if (!currentCard) return;

    setIsProcessing(true);
    try {
      const details = await onGet(currentCard.id);
      setDetailCard(details);
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
      await onRemove(deleteTarget.id);
      setMode('list');
      setDeleteTarget(null);
      setDetailCard(null);
      // Adjust index if needed
      if (cardIndex >= cards.length - 1 && cardIndex > 0) {
        setCardIndex(cardIndex - 1);
      }
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
        setDetailCard(null);
      } else if (mode === 'delete-confirm') {
        setMode('detail');
        setDeleteTarget(null);
      }
      return;
    }

    // List mode navigation
    if (mode === 'list') {
      if (key.upArrow) {
        setCardIndex((prev) => (prev === 0 ? cards.length - 1 : prev - 1));
        return;
      }
      if (key.downArrow) {
        setCardIndex((prev) => (prev === cards.length - 1 ? 0 : prev + 1));
        return;
      }
      if (key.return && currentCard) {
        handleViewDetails();
        return;
      }
      // Number keys for quick selection
      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= cards.length) {
        setCardIndex(num - 1);
      }
      return;
    }

    // Detail mode
    if (mode === 'detail') {
      if (input === 'x' || key.delete) {
        if (detailCard) {
          setDeleteTarget(detailCard);
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
  });

  // Empty state
  if (cards.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Wallet</Text>
        </Box>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          paddingY={1}
        >
          <Text dimColor>No cards stored in wallet.</Text>
          <Text dimColor>Use the wallet_add tool to add a card.</Text>
          <Box marginTop={1}>
            <Text color="yellow">⚠️ PCI DSS Warning:</Text>
          </Box>
          <Text dimColor>Storing payment cards requires PCI compliance.</Text>
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
          <Text bold color="red">Remove Card</Text>
        </Box>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="red"
          paddingX={1}
          paddingY={1}
        >
          <Text>Are you sure you want to remove "{deleteTarget.name}"?</Text>
          <Text dimColor>Card ending in {deleteTarget.last4}</Text>
          <Text dimColor>This action cannot be undone.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>y confirm | n cancel</Text>
        </Box>
      </Box>
    );
  }

  // Detail view
  if (mode === 'detail' && detailCard) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">💳 {detailCard.name}</Text>
          {detailCard.isDefault && <Text color="yellow"> (default)</Text>}
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          paddingY={1}
        >
          <Box>
            <Text dimColor>Card Number: </Text>
            <Text>•••• •••• •••• {detailCard.last4}</Text>
          </Box>

          {detailCard.brand && (
            <Box>
              <Text dimColor>Brand: </Text>
              <Text>{detailCard.brand}</Text>
            </Box>
          )}

          <Box>
            <Text dimColor>Expires: </Text>
            <Text>{formatExpiry(detailCard.expiryMonth, detailCard.expiryYear)}</Text>
          </Box>

          {detailCard.createdAt && (
            <Box>
              <Text dimColor>Added: </Text>
              <Text>{new Date(detailCard.createdAt).toLocaleString()}</Text>
            </Box>
          )}
        </Box>

        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            x remove | Esc back
          </Text>
        </Box>
      </Box>
    );
  }

  // List view (default)
  const visibleCards = cards.slice(cardRange.start, cardRange.end);

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Wallet</Text>
        {cards.length > MAX_VISIBLE_ITEMS && (
          <Text dimColor> ({cardIndex + 1}/{cards.length})</Text>
        )}
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
      >
        {cardRange.hasMore.above > 0 && (
          <Box paddingY={0}>
            <Text dimColor>  ↑ {cardRange.hasMore.above} more above</Text>
          </Box>
        )}

        {visibleCards.map((card, visibleIdx) => {
          const actualIdx = cardRange.start + visibleIdx;
          const isSelected = actualIdx === cardIndex;
          const prefix = isSelected ? '> ' : '  ';
          const nameDisplay = card.name.padEnd(20);
          const statusIcon = card.isDefault ? '★' : '○';
          const statusColor = card.isDefault ? 'yellow' : 'gray';

          return (
            <Box key={card.id} paddingY={0}>
              <Text inverse={isSelected} dimColor={!isSelected}>
                {prefix}💳{' '}
              </Text>
              <Text color={statusColor} inverse={isSelected}>
                {statusIcon}
              </Text>
              <Text inverse={isSelected} dimColor={!isSelected}>
                {' '}{nameDisplay}
              </Text>
              <Text inverse={isSelected} dimColor>
                {' '}•••• {card.last4}
              </Text>
              {card.brand && (
                <Text inverse={isSelected} dimColor>
                  {' '}({card.brand})
                </Text>
              )}
            </Box>
          );
        })}

        {cardRange.hasMore.below > 0 && (
          <Box paddingY={0}>
            <Text dimColor>  ↓ {cardRange.hasMore.below} more below</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Legend: </Text>
        <Text color="yellow">★</Text>
        <Text dimColor> default | </Text>
        <Text color="gray">○</Text>
        <Text dimColor> standard</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ select | Enter view | q quit
        </Text>
      </Box>
    </Box>
  );
}
