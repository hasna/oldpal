'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AvatarUpload } from '@/components/ui/avatar-upload';
import {
  ANTHROPIC_MODELS,
  DEFAULT_MODEL,
  DEFAULT_TEMPERATURE,
  MIN_TEMPERATURE,
  MAX_TEMPERATURE,
  TEMPERATURE_STEP,
  DEFAULT_MAX_TOKENS,
} from '@hasna/assistants-shared';

interface Agent {
  id: string;
  name: string;
  description: string | null;
  avatar: string | null;
  model: string;
  systemPrompt?: string | null;
  settings?: {
    temperature?: number;
    maxTokens?: number;
  } | null;
  isActive: boolean;
}

interface AgentEditDialogProps {
  agent: Agent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (agentId: string, data: Partial<Agent>) => Promise<void>;
}

export function AgentEditDialog({
  agent,
  open,
  onOpenChange,
  onSave,
}: AgentEditDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE);
  const [maxTokens, setMaxTokens] = useState(DEFAULT_MAX_TOKENS);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset form when agent changes
  useEffect(() => {
    if (agent) {
      setName(agent.name);
      setDescription(agent.description || '');
      setAvatar(agent.avatar);
      setModel(agent.model || DEFAULT_MODEL);
      setTemperature(agent.settings?.temperature ?? DEFAULT_TEMPERATURE);
      setMaxTokens(agent.settings?.maxTokens ?? DEFAULT_MAX_TOKENS);
      setSystemPrompt(agent.systemPrompt || '');
      setIsActive(agent.isActive);
      setError('');
    }
  }, [agent]);

  const handleSave = async () => {
    if (!agent) return;
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const data: Partial<Agent> = {
        name: name.trim(),
        description: description.trim() || null,
        avatar: avatar,
        model,
        systemPrompt: systemPrompt.trim() || null,
        settings: {
          temperature,
          maxTokens,
        },
        isActive,
      };

      await onSave(agent.id, data);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent');
    } finally {
      setIsSaving(false);
    }
  };

  const getTemperatureDescription = (temp: number): string => {
    if (temp < 0.5) return 'More deterministic - consistent, predictable outputs';
    if (temp > 1.5) return 'More creative - varied, exploratory outputs';
    return 'Balanced - good mix of consistency and creativity';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Agent</DialogTitle>
          <DialogDescription>
            Configure the agent settings below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Basic Info Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Basic Info</h3>

            <div className="flex flex-col sm:flex-row gap-6">
              {/* Avatar Upload */}
              <div className="flex-shrink-0">
                <Label className="block mb-2">Avatar</Label>
                <AvatarUpload
                  currentAvatarUrl={avatar}
                  fallback={name?.charAt(0)?.toUpperCase() || '?'}
                  onUpload={async (url) => setAvatar(url)}
                  onRemove={async () => setAvatar(null)}
                  size="md"
                />
              </div>

              {/* Name and Description */}
              <div className="flex-1 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Name</Label>
                  <Input
                    id="edit-name"
                    placeholder="My Assistant"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-description">Description (optional)</Label>
                  <Textarea
                    id="edit-description"
                    placeholder="A helpful assistant for..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Model Configuration Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Model Configuration</h3>

            <div className="space-y-2">
              <Label>Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANTHROPIC_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} - {m.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Temperature</Label>
                <span className="text-sm text-muted-foreground">{temperature.toFixed(1)}</span>
              </div>
              <Slider
                value={[temperature]}
                min={MIN_TEMPERATURE}
                max={MAX_TEMPERATURE}
                step={TEMPERATURE_STEP}
                onValueChange={([value]) => setTemperature(value)}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                {getTemperatureDescription(temperature)}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-max-tokens">Max Output Tokens</Label>
              <Input
                id="edit-max-tokens"
                type="number"
                min={256}
                max={32000}
                step={256}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Maximum number of tokens the model can generate in a response
              </p>
            </div>
          </div>

          {/* System Prompt Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">System Prompt</h3>

            <div className="space-y-2">
              <Label htmlFor="edit-system-prompt">Additional Instructions (optional)</Label>
              <Textarea
                id="edit-system-prompt"
                placeholder="You are a helpful assistant that specializes in..."
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Add custom instructions that will be included in every conversation with this agent
              </p>
            </div>
          </div>

          {/* Status Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Status</h3>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="edit-active">Active</Label>
                <p className="text-xs text-muted-foreground">
                  {isActive ? 'Agent is active and available for use' : 'Agent is inactive'}
                </p>
              </div>
              <Switch
                id="edit-active"
                checked={isActive}
                onCheckedChange={setIsActive}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
