'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useChatStore } from '@/lib/store';
import { chatWs } from '@/lib/ws';

const commands = [
  { id: 'new', label: 'New session', action: 'new' },
  { id: 'clear', label: 'Clear messages', action: 'clear' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const { createSession, clearMessages, isStreaming, sessionId } = useChatStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  // Store the previously focused element when opening
  const handleOpen = useCallback(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    setOpen(true);
  }, []);

  // Restore focus when closing
  const handleClose = useCallback(() => {
    setOpen(false);
    // Restore focus after state update
    requestAnimationFrame(() => {
      previousFocusRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isCmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (isCmdK) {
        event.preventDefault();
        if (open) {
          handleClose();
        } else {
          handleOpen();
        }
      }
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleOpen, handleClose]);

  // Focus first button when opened
  useEffect(() => {
    if (open && firstButtonRef.current) {
      firstButtonRef.current.focus();
    }
  }, [open]);

  // Focus trap
  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleFocusTrap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusableElements = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey) {
        // Shift + Tab: if on first element, wrap to last
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement?.focus();
        }
      } else {
        // Tab: if on last element, wrap to first
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleFocusTrap);
    return () => document.removeEventListener('keydown', handleFocusTrap);
  }, [open]);

  const executeCommand = (action: string) => {
    if (action === 'new') {
      if (isStreaming && sessionId) {
        chatWs.send({ type: 'cancel', sessionId });
      }
      const newId = createSession();
      chatWs.send({ type: 'session', sessionId: newId });
    }
    if (action === 'clear') {
      clearMessages();
    }
    handleClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        // Close when clicking backdrop
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-lg"
      >
        <div id="command-palette-title" className="text-xs uppercase tracking-[0.3em] text-gray-500">
          Commands
        </div>
        <div className="mt-4 space-y-2" role="menu">
          {commands.map((command, index) => (
            <button
              key={command.id}
              ref={index === 0 ? firstButtonRef : undefined}
              role="menuitem"
              className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
              onClick={() => executeCommand(command.action)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  executeCommand(command.action);
                }
              }}
            >
              <span>{command.label}</span>
              <span className="text-xs text-gray-500">Enter</span>
            </button>
          ))}
        </div>
        <p className="mt-4 text-xs text-gray-500">Tip: Press Esc to close.</p>
      </div>
    </div>
  );
}
