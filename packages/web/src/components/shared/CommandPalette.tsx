'use client';

import { useEffect, useState } from 'react';
import { useChatStore } from '@/lib/store';
import { chatWs } from '@/lib/ws';

const commands = [
  { id: 'new', label: 'New session', action: 'new' },
  { id: 'clear', label: 'Clear messages', action: 'clear' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const { createSession, clearMessages, isStreaming, sessionId } = useChatStore();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isCmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (isCmdK) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-lg">
        <div className="text-xs uppercase tracking-[0.3em] text-gray-500">Commands</div>
        <div className="mt-4 space-y-2">
          {commands.map((command) => (
            <button
              key={command.id}
              className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 hover:border-gray-400"
              onClick={() => {
                if (command.action === 'new') {
                  if (isStreaming && sessionId) {
                    chatWs.send({ type: 'cancel', sessionId });
                  }
                  const newId = createSession();
                  chatWs.send({ type: 'session', sessionId: newId });
                }
                if (command.action === 'clear') {
                  clearMessages();
                }
                setOpen(false);
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
