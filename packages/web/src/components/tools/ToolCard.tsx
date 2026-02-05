'use client';

import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Terminal, FileText, Globe, Image, Clock, Calendar, MessageSquare, Brain, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Tool parameter property schema
 */
interface ToolPropertySchema {
  type: string | string[];
  description: string;
  enum?: string[];
  default?: unknown;
}

/**
 * Tool parameter schema
 */
interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, ToolPropertySchema>;
  required?: string[];
}

/**
 * Tool data structure
 */
export interface Tool {
  name: string;
  description: string;
  category: string;
  parameters?: ToolParameterSchema;
}

interface ToolCardProps {
  tool: Tool;
  onClick?: () => void;
  className?: string;
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
 * Get badge variant for category
 */
function getCategoryVariant(category: string): 'default' | 'secondary' | 'success' | 'warning' | 'outline' {
  switch (category) {
    case 'system':
      return 'default';
    case 'filesystem':
      return 'secondary';
    case 'web':
      return 'success';
    case 'media':
      return 'warning';
    case 'timing':
    case 'scheduling':
      return 'outline';
    case 'interaction':
      return 'secondary';
    case 'memory':
      return 'success';
    case 'agents':
      return 'warning';
    default:
      return 'default';
  }
}

export function ToolCard({ tool, onClick, className }: ToolCardProps) {
  const Icon = getCategoryIcon(tool.category);
  const paramCount = tool.parameters?.properties 
    ? Object.keys(tool.parameters.properties).length 
    : 0;
  const requiredCount = tool.parameters?.required?.length || 0;

  return (
    <Card 
      className={cn(
        'cursor-pointer transition-all hover:border-primary/50 hover:shadow-md',
        className
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 p-2 rounded-lg bg-muted">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium text-foreground truncate">{tool.name}</h3>
              <Badge variant={getCategoryVariant(tool.category)} className="text-[10px] px-1.5 py-0.5">
                {tool.category}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {tool.description}
            </p>
            {paramCount > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                {paramCount} parameter{paramCount !== 1 ? 's' : ''} 
                {requiredCount > 0 && ` (${requiredCount} required)`}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
