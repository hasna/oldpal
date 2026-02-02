'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

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
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentDescription, setNewAgentDescription] = useState('');

  useEffect(() => {
    loadAgents();
  }, []);

  const loadAgents = async () => {
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
  };

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
    if (!confirm('Are you sure you want to delete this agent?')) return;

    try {
      const response = await fetchWithAuth(`/api/v1/agents/${id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setAgents((prev) => prev.filter((a) => a.id !== id));
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
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-400"></div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-100 mb-6">Agents</h1>

      {error && (
        <div className="mb-4 rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Create Agent Form */}
      <form onSubmit={createAgent} className="mb-8 p-4 rounded-lg border border-slate-800 bg-slate-900/50">
        <h2 className="text-lg font-medium text-slate-200 mb-4">Create New Agent</h2>
        <div className="space-y-4">
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
            <Input
              id="description"
              value={newAgentDescription}
              onChange={(e) => setNewAgentDescription(e.target.value)}
              placeholder="A helpful assistant for..."
            />
          </div>
          <Button type="submit" disabled={isCreating || !newAgentName.trim()}>
            {isCreating ? 'Creating...' : 'Create Agent'}
          </Button>
        </div>
      </form>

      {/* Agents List */}
      {agents.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-400">No agents yet</p>
          <p className="text-slate-500 text-sm mt-1">Create your first agent above</p>
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="flex items-center justify-between p-4 rounded-lg border border-slate-800 bg-slate-900/50"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-slate-100 font-medium">{agent.name}</span>
                  {!agent.isActive && (
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-400">
                      Inactive
                    </span>
                  )}
                </div>
                {agent.description && (
                  <p className="text-sm text-slate-400 mt-1">{agent.description}</p>
                )}
                <p className="text-xs text-slate-500 mt-1">Model: {agent.model}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleAgent(agent.id, agent.isActive)}
                >
                  {agent.isActive ? 'Deactivate' : 'Activate'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteAgent(agent.id)}
                  className="text-red-400 hover:text-red-300"
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
