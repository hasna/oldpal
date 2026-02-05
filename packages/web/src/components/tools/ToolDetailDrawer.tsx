'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/Badge';
import { Separator } from '@/components/ui/Separator';
import { Terminal, FileText, Globe, Image, Clock, Calendar, MessageSquare, Brain, Bot, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useState } from 'react';
import type { Tool } from './ToolCard';

interface ToolDetailDrawerProps {
  tool: Tool | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Get icon for tool category
 */
function getCategoryIcon(category: string) {
  switch (category) {
    case 'system':
      return Terminal;
    case 'filesystem':
      return FileText;
    case 'web':
      return Globe;
    case 'media':
      return Image;
    case 'timing':
      return Clock;
    case 'scheduling':
      return Calendar;
    case 'interaction':
      return MessageSquare;
    case 'memory':
      return Brain;
    case 'agents':
      return Bot;
    default:
      return Terminal;
  }
}

/**
 * Format parameter type for display
 */
function formatType(type: string | string[]): string {
  if (Array.isArray(type)) {
    return type.join(' | ');
  }
  return type;
}

export function ToolDetailDrawer({ tool, isOpen, onClose }: ToolDetailDrawerProps) {
  const [copied, setCopied] = useState(false);

  if (!tool) return null;

  const Icon = getCategoryIcon(tool.category);
  const properties = tool.parameters?.properties || {};
  const required = tool.parameters?.required || [];

  const handleCopyExample = () => {
    // Generate example usage
    const params: Record<string, string> = {};
    for (const [key, prop] of Object.entries(properties)) {
      if (prop.enum) {
        params[key] = prop.enum[0];
      } else if (prop.default !== undefined) {
        params[key] = String(prop.default);
      } else if (prop.type === 'string') {
        params[key] = `"example_${key}"`;
      } else if (prop.type === 'number') {
        params[key] = '0';
      } else if (prop.type === 'boolean') {
        params[key] = 'true';
      } else {
        params[key] = '...';
      }
    }
    
    const example = JSON.stringify({ tool: tool.name, input: params }, null, 2);
    navigator.clipboard.writeText(example);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <Icon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <SheetTitle className="text-left">{tool.name}</SheetTitle>
              <Badge variant="outline" className="mt-1">
                {tool.category}
              </Badge>
            </div>
          </div>
          <SheetDescription className="text-left mt-2">
            {tool.description}
          </SheetDescription>
        </SheetHeader>

        <Separator className="my-4" />

        {/* Parameters Section */}
        {Object.keys(properties).length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Parameters</h4>
              <Button variant="ghost" size="sm" onClick={handleCopyExample}>
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-1" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-1" />
                    Copy Example
                  </>
                )}
              </Button>
            </div>
            
            <div className="space-y-3">
              {Object.entries(properties).map(([name, prop]) => {
                const isRequired = required.includes(name);
                return (
                  <div key={name} className="rounded-lg border bg-muted/30 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-medium text-foreground">{name}</code>
                        {isRequired && (
                          <Badge variant="error" className="text-[10px] px-1 py-0">
                            required
                          </Badge>
                        )}
                      </div>
                      <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {formatType(prop.type)}
                      </code>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {prop.description}
                    </p>
                    {prop.enum && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {prop.enum.map((val) => (
                          <code key={val} className="text-xs bg-muted px-1.5 py-0.5 rounded">
                            {val}
                          </code>
                        ))}
                      </div>
                    )}
                    {prop.default !== undefined && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Default: <code className="bg-muted px-1 rounded">{String(prop.default)}</code>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {Object.keys(properties).length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">This tool has no parameters.</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
