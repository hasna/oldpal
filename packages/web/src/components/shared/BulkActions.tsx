'use client';

import { useState, useCallback } from 'react';
import { Trash2, Download, CheckSquare, Square, MinusSquare } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface BulkAction<T> {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  variant?: 'default' | 'destructive' | 'ghost' | 'outline';
  /** If true, shows a confirmation dialog before executing */
  requiresConfirmation?: boolean;
  confirmTitle?: string;
  confirmDescription?: string;
  /** Execute the action on selected items */
  execute: (items: T[]) => Promise<void>;
}

interface BulkActionsToolbarProps<T> {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  actions: BulkAction<T>[];
  selectedItems: T[];
  onActionComplete?: () => void;
}

export function BulkActionsToolbar<T>({
  selectedCount,
  totalCount,
  onSelectAll,
  onDeselectAll,
  actions,
  selectedItems,
  onActionComplete,
}: BulkActionsToolbarProps<T>) {
  const [confirmingAction, setConfirmingAction] = useState<BulkAction<T> | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const handleAction = useCallback(
    async (action: BulkAction<T>) => {
      if (action.requiresConfirmation) {
        setConfirmingAction(action);
        return;
      }

      setIsExecuting(true);
      try {
        await action.execute(selectedItems);
        onActionComplete?.();
      } finally {
        setIsExecuting(false);
      }
    },
    [selectedItems, onActionComplete]
  );

  const executeConfirmedAction = useCallback(async () => {
    if (!confirmingAction) return;

    setIsExecuting(true);
    try {
      await confirmingAction.execute(selectedItems);
      onActionComplete?.();
    } finally {
      setIsExecuting(false);
      setConfirmingAction(null);
    }
  }, [confirmingAction, selectedItems, onActionComplete]);

  if (selectedCount === 0) {
    return null;
  }

  const allSelected = selectedCount === totalCount;
  const someSelected = selectedCount > 0 && selectedCount < totalCount;

  return (
    <>
      <div className="flex items-center gap-3 py-3 px-4 bg-muted/50 rounded-lg border border-border mb-4">
        <button
          type="button"
          onClick={allSelected ? onDeselectAll : onSelectAll}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {allSelected ? (
            <CheckSquare className="h-4 w-4 text-primary" />
          ) : someSelected ? (
            <MinusSquare className="h-4 w-4 text-primary" />
          ) : (
            <Square className="h-4 w-4" />
          )}
          <span>
            {selectedCount} of {totalCount} selected
          </span>
        </button>

        <div className="h-4 w-px bg-border" />

        <div className="flex items-center gap-2">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <Button
                key={action.id}
                variant={action.variant || 'ghost'}
                size="sm"
                onClick={() => handleAction(action)}
                disabled={isExecuting}
              >
                {Icon && <Icon className="h-4 w-4 mr-1.5" />}
                {action.label}
              </Button>
            );
          })}
        </div>

        <div className="flex-1" />

        <Button variant="ghost" size="sm" onClick={onDeselectAll} disabled={isExecuting}>
          Clear selection
        </Button>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmingAction} onOpenChange={(open) => !open && setConfirmingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmingAction?.confirmTitle || `${confirmingAction?.label}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmingAction?.confirmDescription ||
                `Are you sure you want to ${confirmingAction?.label.toLowerCase()} ${selectedCount} item${selectedCount === 1 ? '' : 's'}? This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isExecuting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeConfirmedAction} disabled={isExecuting}>
              {isExecuting ? 'Processing...' : confirmingAction?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface SelectableItemCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function SelectableItemCheckbox({ checked, onChange, disabled }: SelectableItemCheckboxProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onChange(!checked);
      }}
      disabled={disabled}
      className="flex items-center justify-center h-5 w-5 rounded border border-border hover:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      aria-label={checked ? 'Deselect item' : 'Select item'}
    >
      {checked && <CheckSquare className="h-4 w-4 text-primary" />}
      {!checked && <Square className="h-4 w-4 text-muted-foreground hover:text-foreground" />}
    </button>
  );
}

// Hook for managing selection state
export function useSelection<T extends { id: string }>() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const select = useCallback((id: string) => {
    setSelectedIds((prev) => new Set([...prev, id]));
  }, []);

  const deselect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((items: T[]) => {
    setSelectedIds(new Set(items.map((item) => item.id)));
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const getSelectedItems = useCallback(
    (items: T[]) => items.filter((item) => selectedIds.has(item.id)),
    [selectedIds]
  );

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    select,
    deselect,
    toggle,
    selectAll,
    deselectAll,
    isSelected,
    getSelectedItems,
  };
}

// Pre-built actions
export const createDeleteAction = <T,>(
  onDelete: (items: T[]) => Promise<void>,
  itemName = 'item'
): BulkAction<T> => ({
  id: 'delete',
  label: 'Delete',
  icon: Trash2,
  variant: 'destructive',
  requiresConfirmation: true,
  confirmTitle: 'Delete selected items?',
  confirmDescription: `Are you sure you want to delete the selected ${itemName}s? This action cannot be undone.`,
  execute: onDelete,
});

export const createExportAction = <T,>(
  onExport: (items: T[]) => Promise<void>,
  _itemName = 'item'
): BulkAction<T> => ({
  id: 'export',
  label: 'Export',
  icon: Download,
  variant: 'ghost',
  requiresConfirmation: false,
  execute: onExport,
});
