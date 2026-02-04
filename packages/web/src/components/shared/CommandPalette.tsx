'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  MessageSquare,
  Bot,
  Clock,
  Inbox,
  Settings,
  CreditCard,
  Plus,
  Trash2,
  Keyboard,
  LogOut,
  Search,
  ArrowRight,
  Moon,
  Sun,
} from 'lucide-react';
import { useChatStore } from '@/lib/store';
import { chatWs } from '@/lib/ws';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';

// Custom event for opening keyboard shortcuts help
const SHORTCUTS_HELP_EVENT = 'open-keyboard-shortcuts-help';

export function dispatchShortcutsHelpEvent() {
  window.dispatchEvent(new CustomEvent(SHORTCUTS_HELP_EVENT));
}

export { SHORTCUTS_HELP_EVENT };

interface Command {
  id: string;
  label: string;
  category: 'navigation' | 'actions' | 'help';
  action: string;
  shortcut?: string;
  icon?: React.ComponentType<{ className?: string }>;
  keywords?: string[];
}

const commands: Command[] = [
  // Navigation commands
  { id: 'nav-chat', label: 'Go to Chat', category: 'navigation', action: 'nav:/chat', icon: MessageSquare, keywords: ['conversation', 'talk'] },
  { id: 'nav-sessions', label: 'Go to Sessions', category: 'navigation', action: 'nav:/sessions', icon: MessageSquare, keywords: ['history', 'conversations'] },
  { id: 'nav-agents', label: 'Go to Agents', category: 'navigation', action: 'nav:/agents', icon: Bot, keywords: ['assistant', 'ai'] },
  { id: 'nav-schedules', label: 'Go to Schedules', category: 'navigation', action: 'nav:/schedules', icon: Clock, keywords: ['cron', 'automation', 'timer'] },
  { id: 'nav-messages', label: 'Go to Messages', category: 'navigation', action: 'nav:/messages', icon: Inbox, keywords: ['inbox', 'notifications'] },
  { id: 'nav-settings', label: 'Go to Settings', category: 'navigation', action: 'nav:/settings', icon: Settings, keywords: ['preferences', 'profile'] },
  { id: 'nav-billing', label: 'Go to Billing', category: 'navigation', action: 'nav:/billing', icon: CreditCard, keywords: ['payment', 'subscription', 'plan'] },

  // Action commands
  { id: 'new-session', label: 'New chat session', category: 'actions', action: 'new', shortcut: 'Cmd+N', icon: Plus, keywords: ['create', 'start'] },
  { id: 'clear-messages', label: 'Clear messages', category: 'actions', action: 'clear', icon: Trash2, keywords: ['delete', 'reset'] },
  { id: 'toggle-theme', label: 'Toggle dark mode', category: 'actions', action: 'toggle-theme', icon: Moon, keywords: ['theme', 'light', 'dark', 'appearance'] },
  { id: 'sign-out', label: 'Sign out', category: 'actions', action: 'signout', icon: LogOut, keywords: ['logout', 'exit'] },

  // Help commands
  { id: 'shortcuts', label: 'Keyboard shortcuts', category: 'help', action: 'shortcuts', shortcut: 'Cmd+/', icon: Keyboard, keywords: ['hotkeys', 'keys'] },
];

const categoryLabels: Record<string, string> = {
  navigation: 'Navigation',
  actions: 'Actions',
  help: 'Help',
};

const categoryOrder = ['navigation', 'actions', 'help'];

export function CommandPalette() {
  const router = useRouter();
  const { logout } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { createSession, clearMessages, isStreaming, sessionId } = useChatStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter commands based on search query
  const filteredCommands = useMemo(() => {
    if (!searchQuery.trim()) {
      return commands;
    }
    const query = searchQuery.toLowerCase();
    return commands.filter((cmd) => {
      const matchesLabel = cmd.label.toLowerCase().includes(query);
      const matchesKeywords = cmd.keywords?.some((kw) => kw.toLowerCase().includes(query));
      return matchesLabel || matchesKeywords;
    });
  }, [searchQuery]);

  // Group commands by category
  const groupedCommands = useMemo(() => {
    const groups: Record<string, Command[]> = {};
    for (const cmd of filteredCommands) {
      if (!groups[cmd.category]) {
        groups[cmd.category] = [];
      }
      groups[cmd.category].push(cmd);
    }
    return groups;
  }, [filteredCommands]);

  // Flat list for keyboard navigation
  const flatList = useMemo(() => {
    const result: Command[] = [];
    for (const category of categoryOrder) {
      if (groupedCommands[category]) {
        result.push(...groupedCommands[category]);
      }
    }
    return result;
  }, [groupedCommands]);

  // Store the previously focused element when opening
  const handleOpen = useCallback(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    setSearchQuery('');
    setSelectedIndex(0);
    setOpen(true);
  }, []);

  // Restore focus when closing
  const handleClose = useCallback(() => {
    setOpen(false);
    setSearchQuery('');
    setSelectedIndex(0);
    requestAnimationFrame(() => {
      previousFocusRef.current?.focus();
    });
  }, []);

  // Keyboard shortcut to open/close
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

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Reset selected index when filtered commands change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands]);

  // Scroll selected item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const selected = listRef.current.querySelector('[data-selected="true"]');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, open]);

  // Handle keyboard navigation in list
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, flatList.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (flatList[selectedIndex]) {
          executeCommand(flatList[selectedIndex].action);
        }
      }
    },
    [flatList, selectedIndex]
  );

  const executeCommand = useCallback(
    (action: string) => {
      // Navigation commands
      if (action.startsWith('nav:')) {
        const path = action.slice(4);
        router.push(path);
        handleClose();
        return;
      }

      // Action commands
      switch (action) {
        case 'new':
          if (isStreaming && sessionId) {
            chatWs.send({ type: 'cancel', sessionId });
          }
          const newId = createSession();
          chatWs.send({ type: 'session', sessionId: newId });
          router.push('/chat');
          break;
        case 'clear':
          clearMessages();
          break;
        case 'toggle-theme':
          setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
          break;
        case 'shortcuts':
          dispatchShortcutsHelpEvent();
          break;
        case 'signout':
          logout();
          break;
      }
      handleClose();
    },
    [isStreaming, sessionId, createSession, clearMessages, router, handleClose, logout, resolvedTheme, setTheme]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50"
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
        aria-labelledby="command-palette-title"
        className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search commands..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none"
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
            esc
          </kbd>
        </div>

        {/* Commands list */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2" role="listbox">
          {flatList.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No commands found for &ldquo;{searchQuery}&rdquo;
            </div>
          ) : (
            categoryOrder.map((category) => {
              const categoryCommands = groupedCommands[category];
              if (!categoryCommands || categoryCommands.length === 0) return null;

              return (
                <div key={category}>
                  <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {categoryLabels[category]}
                  </div>
                  {categoryCommands.map((command) => {
                    const globalIndex = flatList.indexOf(command);
                    const isSelected = globalIndex === selectedIndex;
                    const Icon = command.icon;

                    return (
                      <button
                        key={command.id}
                        role="option"
                        aria-selected={isSelected}
                        data-selected={isSelected}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                          isSelected
                            ? 'bg-primary/10 text-primary'
                            : 'text-foreground hover:bg-muted'
                        }`}
                        onClick={() => executeCommand(command.action)}
                        onMouseEnter={() => setSelectedIndex(globalIndex)}
                      >
                        {Icon && (
                          <Icon
                            className={`h-4 w-4 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}
                          />
                        )}
                        <span className="flex-1 text-left">{command.label}</span>
                        {command.shortcut && (
                          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
                            {command.shortcut}
                          </kbd>
                        )}
                        {!command.shortcut && isSelected && (
                          <ArrowRight className="h-3 w-3 text-primary" />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-muted px-1">↑</kbd>
              <kbd className="rounded border border-border bg-muted px-1">↓</kbd>
              <span>to navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-muted px-1">↵</kbd>
              <span>to select</span>
            </span>
          </div>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-muted px-1">esc</kbd>
            <span>to close</span>
          </span>
        </div>
      </div>
    </div>
  );
}
