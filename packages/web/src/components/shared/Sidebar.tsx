'use client';

import { useChatStore } from '@/lib/store';
import { chatWs } from '@/lib/ws';

export function Sidebar() {
  const { sessions, sessionId, switchSession, isStreaming } = useChatStore();

  return (
    <aside className="glass flex h-full w-72 flex-col gap-6 border-r border-gray-200 px-6 py-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Sessions</p>
        <div className="mt-4 flex flex-col gap-2">
          {sessions.length === 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
              No sessions yet.
            </div>
          )}
          {sessions.map((session) => (
            <button
              key={session.id}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                sessionId === session.id
                  ? 'border-sky-400/60 bg-sky-50 text-gray-900'
                  : 'border-transparent bg-gray-50 text-gray-700 hover:border-gray-300'
              }`}
              onClick={() => {
                if (isStreaming && sessionId) {
                  chatWs.send({ type: 'cancel', sessionId });
                }
                switchSession(session.id);
                chatWs.send({ type: 'session', sessionId: session.id });
              }}
            >
              {session.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500">
        Tip: Use /help inside chat to see available commands.
      </div>
    </aside>
  );
}
