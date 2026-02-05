'use client';

import { useState, useEffect, useMemo } from 'react';
import { Search, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/Label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/use-auth';

interface Skill {
  name: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string[];
  userInvocable: boolean;
  category: string;
}

interface SkillSelectorProps {
  selectedSkills: string[];
  onChange: (skills: string[]) => void;
}

export function SkillSelector({ selectedSkills, onChange }: SkillSelectorProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedSkill, setCopiedSkill] = useState<string | null>(null);
  const { fetchWithAuth, isAuthenticated } = useAuth();

  useEffect(() => {
    const fetchSkills = async () => {
      if (!isAuthenticated) {
        setIsLoading(false);
        return;
      }
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetchWithAuth('/api/v1/skills?limit=100');
        if (!response.ok) {
          throw new Error('Failed to fetch skills');
        }
        const data = await response.json();
        const items = data.data.items || [];
        setSkills(items);
        // Derive categories from items if API doesn't return them
        const apiCategories = data.data.categories || [];
        const derivedCategories = apiCategories.length > 0
          ? apiCategories
          : [...new Set(items.map((s: Skill) => s.category))].sort();
        setCategories(derivedCategories);
        // Expand all categories by default
        setExpandedCategories(new Set(derivedCategories));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load skills');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSkills();
  }, [isAuthenticated, fetchWithAuth]);

  // Filter skills based on search query
  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const query = searchQuery.toLowerCase();
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query)
    );
  }, [skills, searchQuery]);

  // Group skills by category
  const skillsByCategory = useMemo(() => {
    const grouped: Record<string, Skill[]> = {};
    for (const skill of filteredSkills) {
      if (!grouped[skill.category]) {
        grouped[skill.category] = [];
      }
      grouped[skill.category].push(skill);
    }
    return grouped;
  }, [filteredSkills]);

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const toggleSkill = (skillName: string) => {
    const newSelected = selectedSkills.includes(skillName)
      ? selectedSkills.filter((s) => s !== skillName)
      : [...selectedSkills, skillName];
    onChange(newSelected);
  };

  const selectAll = () => {
    onChange(filteredSkills.map((s) => s.name));
  };

  const clearAll = () => {
    onChange([]);
  };

  const selectCategory = (category: string) => {
    const categorySkills = skillsByCategory[category] || [];
    const categorySkillNames = categorySkills.map((s) => s.name);
    const allSelected = categorySkillNames.every((name) => selectedSkills.includes(name));

    if (allSelected) {
      // Deselect all in category
      onChange(selectedSkills.filter((s) => !categorySkillNames.includes(s)));
    } else {
      // Select all in category
      const newSelected = new Set([...selectedSkills, ...categorySkillNames]);
      onChange(Array.from(newSelected));
    }
  };

  const copyInvocation = async (skillName: string, argumentHint?: string) => {
    const command = argumentHint ? `/${skillName} ${argumentHint}` : `/${skillName}`;
    await navigator.clipboard.writeText(command);
    setCopiedSkill(skillName);
    setTimeout(() => setCopiedSkill(null), 2000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        Loading skills...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center">
        <p className="text-muted-foreground">No skills available</p>
        <p className="text-xs text-muted-foreground mt-1">
          Skills can be added to ~/.assistants/shared/skills/
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search and bulk actions */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={selectAll}>
            Select All
          </Button>
          <Button variant="outline" size="sm" onClick={clearAll}>
            Clear All
          </Button>
        </div>
      </div>

      {/* Selection count */}
      <div className="text-sm text-muted-foreground">
        {selectedSkills.length} of {skills.length} skills selected
        {selectedSkills.length === 0 && (
          <span className="ml-1">(empty = all skills available)</span>
        )}
      </div>

      {/* Skills list grouped by category */}
      <ScrollArea className="h-[300px] rounded-md border">
        <div className="p-4 space-y-2">
          {categories
            .filter((category) => skillsByCategory[category]?.length > 0)
            .map((category) => {
              const categorySkills = skillsByCategory[category] || [];
              const selectedCount = categorySkills.filter((s) =>
                selectedSkills.includes(s.name)
              ).length;
              const allSelected = categorySkills.length > 0 && selectedCount === categorySkills.length;
              const someSelected = selectedCount > 0 && selectedCount < categorySkills.length;

              return (
                <Collapsible
                  key={category}
                  open={expandedCategories.has(category)}
                  onOpenChange={() => toggleCategory(category)}
                >
                  <div className="flex items-center gap-2 py-1">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                        {expandedCategories.has(category) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <Checkbox
                      id={`skill-category-${category}`}
                      checked={someSelected ? 'indeterminate' : allSelected}
                      onCheckedChange={() => selectCategory(category)}
                    />
                    <Label
                      htmlFor={`skill-category-${category}`}
                      className="flex-1 cursor-pointer font-medium capitalize"
                    >
                      {category}
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      {selectedCount}/{categorySkills.length}
                    </span>
                  </div>
                  <CollapsibleContent>
                    <div className="ml-8 space-y-1 pt-1">
                      {categorySkills.map((skill) => (
                        <TooltipProvider key={skill.name}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-2 py-1 rounded hover:bg-muted/50 px-2 -mx-2 group">
                                <Checkbox
                                  id={`skill-${skill.name}`}
                                  checked={selectedSkills.includes(skill.name)}
                                  onCheckedChange={() => toggleSkill(skill.name)}
                                />
                                <Label
                                  htmlFor={`skill-${skill.name}`}
                                  className="flex-1 cursor-pointer text-sm"
                                >
                                  <span className="font-mono text-xs">/{skill.name}</span>
                                  {skill.argumentHint && (
                                    <span className="ml-1 text-muted-foreground">
                                      {skill.argumentHint}
                                    </span>
                                  )}
                                </Label>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyInvocation(skill.name, skill.argumentHint);
                                  }}
                                >
                                  {copiedSkill === skill.name ? (
                                    <Check className="h-3 w-3 text-green-500" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </Button>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs">
                              <div className="space-y-1">
                                <p className="font-medium">{skill.description}</p>
                                {skill.allowedTools && skill.allowedTools.length > 0 && (
                                  <p className="text-xs text-muted-foreground">
                                    Allowed tools: {skill.allowedTools.join(', ')}
                                  </p>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          {filteredSkills.length === 0 && searchQuery && (
            <div className="py-8 text-center text-muted-foreground">
              No skills found matching &ldquo;{searchQuery}&rdquo;
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
