'use client';

import { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/Badge';
import { Separator } from '@/components/ui/Separator';
import { Sparkles, Globe, FolderCode, Copy, Check, Loader2, User } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/use-auth';
import type { Skill } from './SkillCard';

interface SkillDetailResponse extends Skill {
  model?: string;
  context?: string;
  assistant?: string;
  content: string;
}

interface SkillDetailDrawerProps {
  skill: Skill | null;
  isOpen: boolean;
  onClose: () => void;
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

export function SkillDetailDrawer({ skill, isOpen, onClose }: SkillDetailDrawerProps) {
  const { fetchWithAuth } = useAuth();
  const [skillDetail, setSkillDetail] = useState<SkillDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fetch skill detail when drawer opens
  useEffect(() => {
    if (isOpen && skill) {
      setIsLoading(true);
      fetchWithAuth(`/api/v1/skills/${encodeURIComponent(skill.name)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setSkillDetail(data.data);
          }
        })
        .catch(console.error)
        .finally(() => setIsLoading(false));
    } else {
      setSkillDetail(null);
    }
  }, [isOpen, skill, fetchWithAuth]);

  if (!skill) return null;

  const Icon = getCategoryIcon(skill.category);

  const handleCopyInvocation = () => {
    const command = `/${skill.name}${skill.argumentHint ? ' ' + skill.argumentHint : ''}`;
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <Icon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <SheetTitle className="text-left font-mono">/{skill.name}</SheetTitle>
              <div className="flex items-center gap-1 mt-1">
                <Badge variant="outline">
                  {skill.category}
                </Badge>
                {skill.userInvocable && (
                  <Badge variant="success" className="text-[10px]">
                    <User className="h-3 w-3 mr-0.5" />
                    user-invocable
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <SheetDescription className="text-left mt-2">
            {skill.description}
          </SheetDescription>
        </SheetHeader>

        <Separator className="my-4" />

        {/* Invocation Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Invocation</h4>
            <Button variant="ghost" size="sm" onClick={handleCopyInvocation}>
              {copied ? (
                <>
                  <Check className="h-4 w-4 mr-1" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-1" />
                  Copy
                </>
              )}
            </Button>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <code className="text-sm font-mono">
              /{skill.name}{skill.argumentHint && <span className="text-muted-foreground"> {skill.argumentHint}</span>}
            </code>
          </div>
        </div>

        {/* Allowed Tools */}
        {skill.allowedTools && skill.allowedTools.length > 0 && (
          <>
            <Separator className="my-4" />
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Allowed Tools</h4>
              <div className="flex flex-wrap gap-1">
                {skill.allowedTools.map((tool) => (
                  <Badge key={tool} variant="outline">
                    {tool}
                  </Badge>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Metadata from Detail API */}
        {skillDetail && (
          <>
            {(skillDetail.model || skillDetail.context || skillDetail.assistant) && (
              <>
                <Separator className="my-4" />
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">Configuration</h4>
                  <div className="space-y-2 text-sm">
                    {skillDetail.model && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Model</span>
                        <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{skillDetail.model}</code>
                      </div>
                    )}
                    {skillDetail.context && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Context</span>
                        <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{skillDetail.context}</code>
                      </div>
                    )}
                    {skillDetail.assistant && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Assistant</span>
                        <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{skillDetail.assistant}</code>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Skill Content */}
            <Separator className="my-4" />
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Content</h4>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="rounded-lg border bg-muted/30 p-3 max-h-96 overflow-y-auto">
                  <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground">
                    {skillDetail.content || 'No content available.'}
                  </pre>
                </div>
              )}
            </div>
          </>
        )}

        {isLoading && !skillDetail && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Source Info */}
        <Separator className="my-4" />
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Source:</span>{' '}
          <code className="break-all">
            {skill.sourceId || skill.category}
          </code>
        </div>
      </SheetContent>
    </Sheet>
  );
}
