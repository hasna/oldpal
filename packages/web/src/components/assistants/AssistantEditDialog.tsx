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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/Badge';
import { AvatarUpload } from '@/components/ui/avatar-upload';
import { ToolSelector } from './ToolSelector';
// SkillSelector is available but skill allowlist enforcement is not yet implemented in the runtime
// import { SkillSelector } from './SkillSelector';
import {
  ALL_MODELS,
  getModelById,
  getModelsGroupedByProvider,
  clampMaxTokens,
  DEFAULT_MODEL,
  DEFAULT_TEMPERATURE,
  MIN_TEMPERATURE,
  MAX_TEMPERATURE,
  TEMPERATURE_STEP,
  DEFAULT_MAX_TOKENS,
} from '@hasna/assistants-shared';

interface Assistant {
  id: string;
  name: string;
  description: string | null;
  avatar: string | null;
  model: string;
  systemPrompt?: string | null;
  settings?: {
    temperature?: number;
    maxTokens?: number;
    tools?: string[];
    skills?: string[];
  } | null;
  isActive: boolean;
}

interface AssistantEditDialogProps {
  assistant: Assistant | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (assistantId: string, data: Partial<Assistant>) => Promise<void>;
}

export function AssistantEditDialog({
  assistant,
  open,
  onOpenChange,
  onSave,
}: AssistantEditDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE);
  const [maxTokens, setMaxTokens] = useState(DEFAULT_MAX_TOKENS);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset form when assistant changes
  useEffect(() => {
    if (assistant) {
      setName(assistant.name);
      setDescription(assistant.description || '');
      setAvatar(assistant.avatar);
      setModel(assistant.model || DEFAULT_MODEL);
      setTemperature(assistant.settings?.temperature ?? DEFAULT_TEMPERATURE);
      setMaxTokens(assistant.settings?.maxTokens ?? DEFAULT_MAX_TOKENS);
      setSystemPrompt(assistant.systemPrompt || '');
      setSelectedTools(assistant.settings?.tools || []);
      setSelectedSkills(assistant.settings?.skills || []);
      setIsActive(assistant.isActive);
      setError('');
    }
  }, [assistant]);

  const handleSave = async () => {
    if (!assistant) return;
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const data: Partial<Assistant> = {
        name: name.trim(),
        description: description.trim() || null,
        avatar: avatar,
        model,
        systemPrompt: systemPrompt.trim() || null,
        settings: {
          temperature,
          maxTokens,
          // Send empty arrays to clear selections (undefined would be ignored by API)
          tools: selectedTools,
          skills: selectedSkills,
        },
        isActive,
      };

      await onSave(assistant.id, data);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save assistant');
    } finally {
      setIsSaving(false);
    }
  };

  const getTemperatureDescription = (temp: number): string => {
    if (temp < 0.5) return 'More deterministic - consistent, predictable outputs';
    if (temp > 1.5) return 'More creative - varied, exploratory outputs';
    return 'Balanced - good mix of consistency and creativity';
  };

  // Handle model change - clamp maxTokens to new model's limit
  const handleModelChange = (newModel: string) => {
    setModel(newModel);
    // Clamp maxTokens to the new model's maximum
    const clampedTokens = clampMaxTokens(newModel, maxTokens);
    if (clampedTokens !== maxTokens) {
      setMaxTokens(clampedTokens);
    }
  };

  // Get current model info
  const currentModel = getModelById(model);
  const modelsByProvider = getModelsGroupedByProvider();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Assistant</DialogTitle>
          <DialogDescription>
            Configure the assistant settings, tools, and skills below.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="model">Model</TabsTrigger>
            <TabsTrigger value="prompt">Prompt</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="skills" className="relative">
              Skills
              <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0">Soon</Badge>
            </TabsTrigger>
          </TabsList>

          {/* Basic Info Tab */}
          <TabsContent value="basic" className="space-y-4 mt-4">
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

            {/* Status */}
            <div className="flex items-center justify-between pt-4 border-t">
              <div className="space-y-0.5">
                <Label htmlFor="edit-active">Active</Label>
                <p className="text-xs text-muted-foreground">
                  {isActive ? 'Assistant is active and available for use' : 'Assistant is inactive'}
                </p>
              </div>
              <Switch
                id="edit-active"
                checked={isActive}
                onCheckedChange={setIsActive}
              />
            </div>
          </TabsContent>

          {/* Model Configuration Tab */}
          <TabsContent value="model" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Model</Label>
              <Select value={model} onValueChange={handleModelChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Anthropic</SelectLabel>
                    {modelsByProvider.anthropic.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>OpenAI</SelectLabel>
                    {modelsByProvider.openai.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {currentModel && (
                <div className="rounded-md bg-muted p-3 text-sm space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{currentModel.name}</p>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {currentModel.provider}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">{currentModel.description}</p>
                  {(currentModel.contextWindow || currentModel.maxOutputTokens) && (
                    <div className="flex gap-4 text-xs text-muted-foreground mt-2">
                      {currentModel.contextWindow && (
                        <span>Context: {(currentModel.contextWindow / 1000).toFixed(0)}K tokens</span>
                      )}
                      {currentModel.maxOutputTokens && (
                        <span>Max output: {(currentModel.maxOutputTokens / 1000).toFixed(0)}K tokens</span>
                      )}
                    </div>
                  )}
                </div>
              )}
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
                max={currentModel?.maxOutputTokens || 32000}
                step={256}
                value={maxTokens}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  // Clamp to model's max output tokens
                  setMaxTokens(clampMaxTokens(model, value));
                }}
              />
              <p className="text-xs text-muted-foreground">
                Maximum number of tokens the model can generate in a response
                {currentModel?.maxOutputTokens && ` (up to ${(currentModel.maxOutputTokens / 1000).toFixed(0)}K)`}
              </p>
            </div>
          </TabsContent>

          {/* System Prompt Tab */}
          <TabsContent value="prompt" className="space-y-4 mt-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-system-prompt">System Prompt</Label>
                <span className="text-xs text-muted-foreground">
                  {systemPrompt.length} characters
                </span>
              </div>
              <Textarea
                id="edit-system-prompt"
                placeholder="You are a helpful assistant that specializes in..."
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={12}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Add custom instructions that will be included in every conversation with this assistant.
                This is appended to the default system prompt.
              </p>
            </div>
          </TabsContent>

          {/* Tools Tab */}
          <TabsContent value="tools" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Available Tools</Label>
              <p className="text-xs text-muted-foreground">
                Select which tools this assistant can use. Leave empty to allow all tools.
              </p>
            </div>
            <ToolSelector
              selectedTools={selectedTools}
              onChange={setSelectedTools}
            />
          </TabsContent>

          {/* Skills Tab - Coming Soon */}
          <TabsContent value="skills" className="space-y-4 mt-4">
            <div className="rounded-md border border-dashed p-8 text-center">
              <div className="space-y-3">
                <Badge variant="outline" className="text-sm">Coming Soon</Badge>
                <h3 className="font-medium">Skill Allowlists</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Per-assistant skill allowlists will allow you to restrict which skills
                  each assistant can access. This feature is under development.
                </p>
                <p className="text-xs text-muted-foreground">
                  For now, all assistants have access to all available skills.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-6">
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
