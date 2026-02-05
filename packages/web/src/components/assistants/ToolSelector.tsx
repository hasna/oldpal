'use client';

import { useState, useEffect, useMemo } from 'react';
import { Search, Check, ChevronDown, ChevronRight } from 'lucide-react';
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

interface Tool {
  name: string;
  description: string;
  category: string;
}

interface ToolSelectorProps {
  selectedTools: string[];
  onChange: (tools: string[]) => void;
}

export function ToolSelector({ selectedTools, onChange }: ToolSelectorProps) {
  const [tools, setTools] = useState<Tool[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { fetchWithAuth, isAuthenticated } = useAuth();

  useEffect(() => {
    const fetchTools = async () => {
      if (!isAuthenticated) {
        setIsLoading(false);
        return;
      }
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetchWithAuth('/api/v1/tools?limit=100');
        if (!response.ok) {
          throw new Error('Failed to fetch tools');
        }
        const data = await response.json();
        const items = data.data.items || [];
        setTools(items);
        // Derive categories from items if API doesn't return them
        const apiCategories = data.data.categories || [];
        const derivedCategories = apiCategories.length > 0
          ? apiCategories
          : [...new Set(items.map((t: Tool) => t.category))].sort();
        setCategories(derivedCategories);
        // Expand all categories by default
        setExpandedCategories(new Set(derivedCategories));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tools');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTools();
  }, [isAuthenticated, fetchWithAuth]);

  // Filter tools based on search query
  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return tools;
    const query = searchQuery.toLowerCase();
    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(query) ||
        tool.description.toLowerCase().includes(query)
    );
  }, [tools, searchQuery]);

  // Group tools by category
  const toolsByCategory = useMemo(() => {
    const grouped: Record<string, Tool[]> = {};
    for (const tool of filteredTools) {
      if (!grouped[tool.category]) {
        grouped[tool.category] = [];
      }
      grouped[tool.category].push(tool);
    }
    return grouped;
  }, [filteredTools]);

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const toggleTool = (toolName: string) => {
    const newSelected = selectedTools.includes(toolName)
      ? selectedTools.filter((t) => t !== toolName)
      : [...selectedTools, toolName];
    onChange(newSelected);
  };

  const selectAll = () => {
    onChange(filteredTools.map((t) => t.name));
  };

  const clearAll = () => {
    onChange([]);
  };

  const selectCategory = (category: string) => {
    const categoryTools = toolsByCategory[category] || [];
    const categoryToolNames = categoryTools.map((t) => t.name);
    const allSelected = categoryToolNames.every((name) => selectedTools.includes(name));

    if (allSelected) {
      // Deselect all in category
      onChange(selectedTools.filter((t) => !categoryToolNames.includes(t)));
    } else {
      // Select all in category
      const newSelected = new Set([...selectedTools, ...categoryToolNames]);
      onChange(Array.from(newSelected));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        Loading tools...
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

  return (
    <div className="space-y-4">
      {/* Search and bulk actions */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tools..."
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
        {selectedTools.length} of {tools.length} tools selected
        {selectedTools.length === 0 && (
          <span className="ml-1">(empty = all tools available)</span>
        )}
      </div>

      {/* Tools list grouped by category */}
      <ScrollArea className="h-[300px] rounded-md border">
        <div className="p-4 space-y-2">
          {categories
            .filter((category) => toolsByCategory[category]?.length > 0)
            .map((category) => {
              const categoryTools = toolsByCategory[category] || [];
              const selectedCount = categoryTools.filter((t) =>
                selectedTools.includes(t.name)
              ).length;
              const allSelected = categoryTools.length > 0 && selectedCount === categoryTools.length;
              const someSelected = selectedCount > 0 && selectedCount < categoryTools.length;

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
                      id={`category-${category}`}
                      checked={someSelected ? 'indeterminate' : allSelected}
                      onCheckedChange={() => selectCategory(category)}
                    />
                    <Label
                      htmlFor={`category-${category}`}
                      className="flex-1 cursor-pointer font-medium capitalize"
                    >
                      {category}
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      {selectedCount}/{categoryTools.length}
                    </span>
                  </div>
                  <CollapsibleContent>
                    <div className="ml-8 space-y-1 pt-1">
                      {categoryTools.map((tool) => (
                        <TooltipProvider key={tool.name}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-2 py-1 rounded hover:bg-muted/50 px-2 -mx-2">
                                <Checkbox
                                  id={`tool-${tool.name}`}
                                  checked={selectedTools.includes(tool.name)}
                                  onCheckedChange={() => toggleTool(tool.name)}
                                />
                                <Label
                                  htmlFor={`tool-${tool.name}`}
                                  className="flex-1 cursor-pointer text-sm"
                                >
                                  {tool.name}
                                </Label>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs">
                              <p>{tool.description}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          {filteredTools.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              No tools found matching &ldquo;{searchQuery}&rdquo;
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
