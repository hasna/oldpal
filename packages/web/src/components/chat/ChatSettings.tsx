'use client';

import { useState, useEffect, useCallback } from 'react';
import { Settings2, X, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface ChatSettingsValues {
  model: string;
  temperature: number;
  maxTokens: number;
}

const DEFAULT_SETTINGS: ChatSettingsValues = {
  model: 'claude-sonnet-4-20250514',
  temperature: 0.7,
  maxTokens: 4096,
};

const AVAILABLE_MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Latest, fast & capable' },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', description: 'Most intelligent' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fastest, cost-effective' },
];

const STORAGE_KEY = 'chat-settings';

// Hook for chat settings
export function useChatSettings() {
  const [settings, setSettings] = useState<ChatSettingsValues>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      } catch {
        // Use defaults on parse error
      }
    }
    setLoaded(true);
  }, []);

  // Save to localStorage when settings change
  const updateSettings = useCallback((newSettings: Partial<ChatSettingsValues>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
  }, []);

  return { settings, updateSettings, resetSettings, loaded };
}

interface ChatSettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ChatSettingsValues;
  onSettingsChange: (settings: Partial<ChatSettingsValues>) => void;
  onReset: () => void;
}

export function ChatSettingsDrawer({
  isOpen,
  onClose,
  settings,
  onSettingsChange,
  onReset,
}: ChatSettingsDrawerProps) {
  if (!isOpen) return null;

  return (
    <TooltipProvider>
      <div className="fixed inset-y-0 right-0 z-50 w-80 bg-card border-l border-border shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-medium text-foreground">Chat Settings</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6 overflow-y-auto h-[calc(100%-8rem)]">
          {/* Model Selection */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="model">Model</Label>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-[200px]">
                  <p className="text-xs">Choose which Claude model to use for responses</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Select
              value={settings.model}
              onValueChange={(value) => onSettingsChange({ model: value })}
            >
              <SelectTrigger id="model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_MODELS.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    <div className="flex flex-col">
                      <span>{model.name}</span>
                      <span className="text-xs text-muted-foreground">{model.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Temperature */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label htmlFor="temperature">Temperature</Label>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3.5 w-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-[200px]">
                    <p className="text-xs">
                      Controls randomness. Lower = more focused, higher = more creative
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <span className="text-sm text-muted-foreground">{settings.temperature.toFixed(1)}</span>
            </div>
            <Slider
              id="temperature"
              value={[settings.temperature]}
              onValueChange={([value]) => onSettingsChange({ temperature: value })}
              min={0}
              max={1}
              step={0.1}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Focused</span>
              <span>Creative</span>
            </div>
          </div>

          {/* Max Tokens */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label htmlFor="maxTokens">Max Tokens</Label>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3.5 w-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-[200px]">
                    <p className="text-xs">
                      Maximum length of the AI response. Higher = longer possible responses
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <span className="text-sm text-muted-foreground">{settings.maxTokens.toLocaleString()}</span>
            </div>
            <Slider
              id="maxTokens"
              value={[settings.maxTokens]}
              onValueChange={([value]) => onSettingsChange({ maxTokens: value })}
              min={256}
              max={16384}
              step={256}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>256</span>
              <span>16,384</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border bg-card">
          <Button variant="outline" size="sm" onClick={onReset} className="w-full">
            Reset to Defaults
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}

interface ChatSettingsButtonProps {
  onClick: () => void;
}

export function ChatSettingsButton({ onClick }: ChatSettingsButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-8 w-8 p-0"
      aria-label="Open chat settings"
    >
      <Settings2 className="h-4 w-4" />
    </Button>
  );
}
