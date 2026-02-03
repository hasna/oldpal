'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/Label';
import { Badge } from '@/components/ui/Badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';

interface Agent {
  id: string;
  name: string;
  description: string | null;
  model: string;
  isActive: boolean;
  createdAt: string;
}

export default function AgentsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentDescription, setNewAgentDescription] = useState('');

  const loadAgents = useCallback(async () => {
    setError(''); // Clear any previous errors
    try {
      const response = await fetchWithAuth('/api/v1/agents');
      const data = await response.json();
      if (data.success) {
        setAgents(data.data.items);
      } else {
        setError(data.error?.message || 'Failed to load agents');
      }
    } catch {
      setError('Failed to load agents');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const createAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentName.trim()) return;

    setIsCreating(true);
    try {
      const response = await fetchWithAuth('/api/v1/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newAgentName,
          description: newAgentDescription || undefined,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setAgents((prev) => [data.data, ...prev]);
        setNewAgentName('');
        setNewAgentDescription('');
        toast({
          title: 'Agent created',
          description: `${data.data.name} has been created successfully.`,
        });
      } else {
        setError(data.error?.message || 'Failed to create agent');
      }
    } catch {
      setError('Failed to create agent');
    } finally {
      setIsCreating(false);
    }
  };

  const deleteAgent = async (id: string) => {
    try {
      const response = await fetchWithAuth(`/api/v1/agents/${id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setAgents((prev) => prev.filter((a) => a.id !== id));
        toast({
          title: 'Agent deleted',
          description: 'The agent has been deleted successfully.',
        });
      }
    } catch {
      setError('Failed to delete agent');
    }
  };

  const toggleAgent = async (id: string, isActive: boolean) => {
    try {
      const response = await fetchWithAuth(`/api/v1/agents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      });
      const data = await response.json();
      if (data.success) {
        setAgents((prev) =>
          prev.map((a) => (a.id === id ? { ...a, isActive: !isActive } : a))
        );
      }
    } catch {
      setError('Failed to update agent');
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-32 mb-6" />
        <Card className="mb-8">
          <CardHeader>
            <Skeleton className="h-6 w-40" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-32" />
          </CardContent>
        </Card>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex-1">
                  <Skeleton className="h-5 w-40 mb-2" />
                  <Skeleton className="h-4 w-64 mb-1" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-8 w-20" />
                  <Skeleton className="h-8 w-16" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Agents</h1>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Create Agent Form */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Create New Agent</CardTitle>
          <CardDescription>Configure a new AI agent for your workspace</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={createAgent} className="space-y-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                placeholder="My Assistant"
                required
              />
            </div>
            <div>
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={newAgentDescription}
                onChange={(e) => setNewAgentDescription(e.target.value)}
                placeholder="A helpful assistant for..."
                className="resize-none"
                rows={3}
              />
            </div>
            <Button type="submit" disabled={isCreating || !newAgentName.trim()}>
              {isCreating ? 'Creating...' : 'Create Agent'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Agents List */}
      {agents.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500">No agents yet</p>
          <p className="text-gray-400 text-sm mt-1">Create your first agent above</p>
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <Card key={agent.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-900 font-medium">{agent.name}</span>
                    {!agent.isActive && (
                      <Badge variant="default">Inactive</Badge>
                    )}
                  </div>
                  {agent.description && (
                    <p className="text-sm text-gray-500 mt-1">{agent.description}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">Model: {agent.model}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleAgent(agent.id, agent.isActive)}
                  >
                    {agent.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-400 hover:text-red-300"
                      >
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete agent?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete this agent? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteAgent(agent.id)}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
