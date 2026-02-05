'use client';

import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Sparkles, Globe, FolderCode, User } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Skill data structure
 */
export interface Skill {
  name: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string[];
  userInvocable: boolean;
  /** @deprecated Use category instead - filePath may not be exposed for security */
  filePath?: string;
  category: string;
  /** Source identifier (e.g., skill file name without path) */
  sourceId?: string;
}

interface SkillCardProps {
  skill: Skill;
  onClick?: () => void;
  className?: string;
}

/**
 * Get icon for skill category
 */
function getCategoryIcon(category: string) {
  switch (category) {
    case 'shared':
      return Globe;
    case 'project':
      return FolderCode;
    default:
      return Sparkles;
  }
}

/**
 * Get badge variant for category
 */
function getCategoryVariant(category: string): 'default' | 'secondary' | 'success' | 'warning' | 'outline' {
  switch (category) {
    case 'shared':
      return 'success';
    case 'project':
      return 'secondary';
    default:
      return 'default';
  }
}

export function SkillCard({ skill, onClick, className }: SkillCardProps) {
  const Icon = getCategoryIcon(skill.category);

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
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-medium text-foreground">/{skill.name}</h3>
              <Badge variant={getCategoryVariant(skill.category)} className="text-[10px] px-1.5 py-0.5">
                {skill.category}
              </Badge>
              {skill.userInvocable && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
                  <User className="h-3 w-3 mr-0.5" />
                  invocable
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {skill.description}
            </p>
            {skill.argumentHint && (
              <p className="text-xs text-muted-foreground mt-2 font-mono">
                /{skill.name} {skill.argumentHint}
              </p>
            )}
            {skill.allowedTools && skill.allowedTools.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {skill.allowedTools.slice(0, 3).map((tool) => (
                  <Badge key={tool} variant="outline" className="text-[10px] px-1 py-0">
                    {tool}
                  </Badge>
                ))}
                {skill.allowedTools.length > 3 && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    +{skill.allowedTools.length - 3} more
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
