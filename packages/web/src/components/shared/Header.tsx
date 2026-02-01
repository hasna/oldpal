'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { useChatStore } from '@/lib/store';
import { chatWs } from '@/lib/ws';

export function Header() {
  const { createSession, sessionId, isStreaming } = useChatStore();

  return (
    <header className="glass flex items-center justify-between px-6 py-4">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Assistants</p>
        <h1 className="font-display text-xl text-slate-100">Operations Console</h1>
      </div>
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="outline" size="sm">
            Settings
          </Button>
        </Link>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            if (isStreaming && sessionId) {
              chatWs.send({ type: 'cancel', sessionId });
            }
            createSession();
          }}
        >
          New Session
        </Button>
      </div>
    </header>
  );
}
