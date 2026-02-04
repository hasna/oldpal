'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { X, Keyboard } from 'lucide-react';
import { SHORTCUTS_HELP_EVENT } from './CommandPalette';

interface Shortcut {
  keys: string[];
  description: string;
}

interface ShortcutCategory {
  title: string;
  shortcuts: Shortcut[];
}

const shortcutCategories: ShortcutCategory[] = [
  {
    title: 'General',
    shortcuts: [
      { keys: ['Cmd/Ctrl', 'K'], description: 'Open command palette' },
      { keys: ['Cmd/Ctrl', '/'], description: 'Show keyboard shortcuts' },
      { keys: ['Esc'], description: 'Close modal/dialog' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Cmd/Ctrl', 'N'], description: 'New chat session' },
      { keys: ['Arrow', 'Keys'], description: 'Navigate lists and menus' },
      { keys: ['Enter'], description: 'Select/confirm action' },
      { keys: ['Tab'], description: 'Move to next element' },
      { keys: ['Shift', 'Tab'], description: 'Move to previous element' },
    ],
  },
  {
    title: 'Chat',
    shortcuts: [
      { keys: ['Enter'], description: 'Send message' },
      { keys: ['Shift', 'Enter'], description: 'New line in message' },
      { keys: ['Cmd/Ctrl', 'Enter'], description: 'Send message (alternative)' },
    ],
  },
  {
    title: 'Forms',
    shortcuts: [
      { keys: ['Tab'], description: 'Next field' },
      { keys: ['Shift', 'Tab'], description: 'Previous field' },
      { keys: ['Space'], description: 'Toggle checkbox/button' },
      { keys: ['Esc'], description: 'Cancel/close form' },
    ],
  },
];

function KeyboardKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-xs font-medium text-foreground bg-muted border border-border rounded shadow-sm">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const handleOpen = useCallback(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => {
      previousFocusRef.current?.focus();
    });
  }, []);

  // Listen for Cmd+/ or Ctrl+/ to open
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isCmdSlash = (event.metaKey || event.ctrlKey) && event.key === '/';
      const isQuestionMark = event.key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey;

      if (isCmdSlash || isQuestionMark) {
        // Don't trigger if user is typing in an input/textarea
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }

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

  // Listen for custom event from command palette
  useEffect(() => {
    const handler = () => {
      handleOpen();
    };

    window.addEventListener(SHORTCUTS_HELP_EVENT, handler);
    return () => window.removeEventListener(SHORTCUTS_HELP_EVENT, handler);
  }, [handleOpen]);

  // Focus close button when opened
  useEffect(() => {
    if (open && closeButtonRef.current) {
      closeButtonRef.current.focus();
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
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleFocusTrap);
    return () => document.removeEventListener('keydown', handleFocusTrap);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-help-title"
        className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-lg"
      >
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-6 py-4">
          <div className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-muted-foreground" />
            <h2 id="shortcuts-help-title" className="text-lg font-semibold text-foreground">
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            onClick={handleClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {shortcutCategories.map((category) => (
            <div key={category.title}>
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
                {category.title}
              </h3>
              <div className="space-y-2">
                {category.shortcuts.map((shortcut, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted"
                  >
                    <span className="text-sm text-foreground">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, keyIndex) => (
                        <span key={keyIndex} className="flex items-center gap-1">
                          <KeyboardKey>{key}</KeyboardKey>
                          {keyIndex < shortcut.keys.length - 1 && (
                            <span className="text-muted-foreground text-xs">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4 bg-muted">
          <p className="text-xs text-muted-foreground text-center">
            Press <KeyboardKey>Esc</KeyboardKey> or <KeyboardKey>Cmd/Ctrl</KeyboardKey> + <KeyboardKey>/</KeyboardKey> to close
          </p>
        </div>
      </div>
    </div>
  );
}

// Export a hook to programmatically open the shortcuts help
export function useKeyboardShortcutsHelp() {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  return { isOpen, open, close, toggle };
}
