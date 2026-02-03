'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/Button';

interface AgentMessage {
  id: string;
  threadId: string;
  subject: string | null;
  body: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'unread' | 'read' | 'archived' | 'injected';
  createdAt: string;
  readAt: string | null;
}

export default function MessagesPage() {
  const { fetchWithAuth } = useAuth();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'archived'>('all');

  const loadMessages = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter === 'unread') params.set('status', 'unread');
      if (filter === 'archived') params.set('status', 'archived');

      const response = await fetchWithAuth(`/api/v1/messages?${params}`);
      const data = await response.json();
      if (data.success) {
        setMessages(data.data.items);
      } else {
        setError(data.error?.message || 'Failed to load messages');
      }
    } catch {
      setError('Failed to load messages');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, filter]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const markAsRead = async (id: string) => {
    try {
      const response = await fetchWithAuth(`/api/v1/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'read' }),
      });
      const data = await response.json();
      if (data.success) {
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, status: 'read', readAt: new Date().toISOString() } : m))
        );
      }
    } catch {
      setError('Failed to update message');
    }
  };

  const archiveMessage = async (id: string) => {
    try {
      const response = await fetchWithAuth(`/api/v1/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      const data = await response.json();
      if (data.success) {
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, status: 'archived' } : m))
        );
      }
    } catch {
      setError('Failed to archive message');
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'text-red-600';
      case 'high':
        return 'text-orange-600';
      case 'low':
        return 'text-gray-400';
      default:
        return 'text-gray-500';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-400"></div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Messages</h1>
        <div className="flex gap-2">
          {(['all', 'unread', 'archived'] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {messages.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500">No messages</p>
          <p className="text-gray-400 text-sm mt-1">
            {filter === 'unread' ? 'All messages have been read' : 'Your inbox is empty'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`p-4 rounded-lg border bg-white ${
                message.status === 'unread' ? 'border-sky-500/30' : 'border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {message.status === 'unread' && (
                      <span className="w-2 h-2 rounded-full bg-sky-500"></span>
                    )}
                    <span className="text-gray-900 font-medium">
                      {message.subject || 'No subject'}
                    </span>
                    <span className={`text-xs ${getPriorityColor(message.priority)}`}>
                      {message.priority}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-2 line-clamp-2">{message.body}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    {new Date(message.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {message.status === 'unread' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markAsRead(message.id)}
                    >
                      Mark Read
                    </Button>
                  )}
                  {message.status !== 'archived' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => archiveMessage(message.id)}
                    >
                      Archive
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
