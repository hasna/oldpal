'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  MessageSquare,
  Send,
  Archive,
  CheckCircle,
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Reply,
  Loader2,
} from 'lucide-react';

interface ThreadMessage {
  id: string;
  threadId: string;
  parentId: string | null;
  fromAssistantId: string | null;
  toAssistantId: string | null;
  subject: string | null;
  body: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'unread' | 'read' | 'archived' | 'injected';
  createdAt: string;
  readAt: string | null;
}

interface Assistant {
  id: string;
  name: string;
}

interface ThreadDetailDialogProps {
  threadId: string | null;
  initialSubject?: string | null;
  onClose: () => void;
  onMessageUpdate?: () => void;
}

export function ThreadDetailDialog({
  threadId,
  initialSubject,
  onClose,
  onMessageUpdate,
}: ThreadDetailDialogProps) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // Reply form state
  const [replyBody, setReplyBody] = useState('');
  const [replyToAssistantId, setReplyToAssistantId] = useState('');
  const [replyFromAssistantId, setReplyFromAssistantId] = useState('');

  const loadThread = useCallback(async () => {
    if (!threadId) return;

    setIsLoading(true);
    setError('');
    try {
      const response = await fetchWithAuth(`/api/v1/messages/threads/${threadId}`);
      const data = await response.json();
      if (data.success) {
        setMessages(data.data.messages);
        // Auto-mark unread messages as read
        const unreadMessages = data.data.messages.filter(
          (m: ThreadMessage) => m.status === 'unread'
        );
        for (const msg of unreadMessages) {
          await fetchWithAuth(`/api/v1/messages/${msg.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'read' }),
          });
        }
        if (unreadMessages.length > 0 && onMessageUpdate) {
          onMessageUpdate();
        }
      } else {
        setError(data.error?.message || 'Failed to load thread');
      }
    } catch {
      setError('Failed to load thread');
    } finally {
      setIsLoading(false);
    }
  }, [threadId, fetchWithAuth, onMessageUpdate]);

  const loadAssistants = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/api/v1/assistants');
      const data = await response.json();
      if (data.success) {
        setAssistants(data.data.items || []);
      }
    } catch {
      // Silently fail - assistants list is optional
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    if (threadId) {
      loadThread();
      loadAssistants();
    }
  }, [threadId, loadThread, loadAssistants]);

  const handleSendReply = async () => {
    if (!replyBody.trim() || !replyToAssistantId) return;

    setIsSending(true);
    try {
      const lastMessage = messages[messages.length - 1];
      const response = await fetchWithAuth('/api/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          parentId: lastMessage?.id,
          toAssistantId: replyToAssistantId,
          fromAssistantId: replyFromAssistantId || undefined,
          body: replyBody.trim(),
          subject: initialSubject ? `Re: ${initialSubject}` : undefined,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setReplyBody('');
        setIsReplying(false);
        loadThread();
        toast({
          title: 'Reply sent',
          description: 'Your message has been sent.',
        });
      } else {
        toast({
          title: 'Error',
          description: data.error?.message || 'Failed to send reply',
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to send reply',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  const archiveThread = async () => {
    try {
      // Archive all messages in thread
      for (const msg of messages) {
        if (msg.status !== 'archived') {
          await fetchWithAuth(`/api/v1/messages/${msg.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'archived' }),
          });
        }
      }
      toast({
        title: 'Thread archived',
        description: 'All messages in this thread have been archived.',
      });
      onMessageUpdate?.();
      onClose();
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to archive thread',
        variant: 'destructive',
      });
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case 'high':
        return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      default:
        return null;
    }
  };

  const getAssistantName = (assistantId: string | null) => {
    if (!assistantId) return 'User';
    const assistant = assistants.find((a) => a.id === assistantId);
    return assistant?.name || 'Unknown Assistant';
  };

  if (!threadId) return null;

  return (
    <Dialog open={!!threadId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            {initialSubject || 'Thread'}
          </DialogTitle>
          <DialogDescription>
            {messages.length > 0 && `${messages.length} message${messages.length !== 1 ? 's' : ''} in thread`}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4 py-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : error ? (
          <div className="py-8 text-center text-red-500">{error}</div>
        ) : (
          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="space-y-4 py-4">
              {messages.map((message, index) => (
                <div
                  key={message.id}
                  className={cn(
                    'rounded-lg p-4 border',
                    message.status === 'unread'
                      ? 'bg-sky-50 border-sky-200'
                      : 'bg-gray-50 border-gray-200'
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Header */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {message.fromAssistantId ? (
                          <Badge variant="outline" className="text-xs">
                            From: {getAssistantName(message.fromAssistantId)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            From: User
                          </Badge>
                        )}
                        <span className="text-gray-400">→</span>
                        <Badge variant="outline" className="text-xs">
                          To: {getAssistantName(message.toAssistantId)}
                        </Badge>
                        {getPriorityIcon(message.priority)}
                        {message.status === 'unread' && (
                          <Badge className="bg-sky-100 text-sky-700 text-xs">New</Badge>
                        )}
                      </div>

                      {/* Body */}
                      <p className="mt-3 text-gray-800 whitespace-pre-wrap">{message.body}</p>

                      {/* Footer */}
                      <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                        <Clock className="h-3 w-3" />
                        {new Date(message.createdAt).toLocaleString()}
                        {message.readAt && (
                          <>
                            <span className="mx-1">•</span>
                            <CheckCircle className="h-3 w-3 text-green-500" />
                            Read {new Date(message.readAt).toLocaleString()}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {/* Reply Section */}
        {!isLoading && !error && (
          <>
            {isReplying ? (
              <div className="border-t pt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">
                      Send to
                    </label>
                    <Select value={replyToAssistantId} onValueChange={setReplyToAssistantId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select recipient assistant" />
                      </SelectTrigger>
                      <SelectContent>
                        {assistants.map((assistant) => (
                          <SelectItem key={assistant.id} value={assistant.id}>
                            {assistant.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">
                      Send as (optional)
                    </label>
                    <Select value={replyFromAssistantId} onValueChange={setReplyFromAssistantId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Send as user" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Send as user</SelectItem>
                        {assistants.map((assistant) => (
                          <SelectItem key={assistant.id} value={assistant.id}>
                            {assistant.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Textarea
                  placeholder="Type your reply..."
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  className="min-h-[100px]"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsReplying(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSendReply}
                    disabled={!replyBody.trim() || !replyToAssistantId || isSending}
                  >
                    {isSending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-2" />
                        Send Reply
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <DialogFooter className="border-t pt-4 gap-2 sm:gap-0">
                <Button variant="outline" onClick={archiveThread}>
                  <Archive className="h-4 w-4 mr-2" />
                  Archive Thread
                </Button>
                <Button onClick={() => setIsReplying(true)}>
                  <Reply className="h-4 w-4 mr-2" />
                  Reply
                </Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
