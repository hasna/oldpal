'use client';

import { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';

interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
  variant?: 'default' | 'outline' | 'ghost';
}

interface EmptyStateProps {
  icon?: ReactNode;
  illustration?: 'sessions' | 'agents' | 'messages' | 'schedules' | 'search' | 'data';
  title: string;
  description?: string;
  tip?: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  className?: string;
}

// Simple, friendly SVG illustrations for each empty state type
function EmptyIllustration({ type }: { type: EmptyStateProps['illustration'] }) {
  const baseClasses = "w-32 h-32 mx-auto mb-4";

  switch (type) {
    case 'sessions':
      return (
        <svg className={baseClasses} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Chat bubbles illustration */}
          <rect x="20" y="30" width="60" height="40" rx="8" fill="#E0F2FE" stroke="#7DD3FC" strokeWidth="2"/>
          <rect x="48" y="58" width="60" height="40" rx="8" fill="#F0F9FF" stroke="#BAE6FD" strokeWidth="2"/>
          <circle cx="35" cy="50" r="3" fill="#38BDF8"/>
          <circle cx="50" cy="50" r="3" fill="#38BDF8"/>
          <circle cx="65" cy="50" r="3" fill="#38BDF8"/>
          <line x1="58" y1="72" x2="90" y2="72" stroke="#BAE6FD" strokeWidth="4" strokeLinecap="round"/>
          <line x1="58" y1="82" x2="80" y2="82" stroke="#BAE6FD" strokeWidth="4" strokeLinecap="round"/>
        </svg>
      );

    case 'agents':
      return (
        <svg className={baseClasses} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Robot/agent illustration */}
          <rect x="34" y="30" width="60" height="50" rx="12" fill="#E0F2FE" stroke="#7DD3FC" strokeWidth="2"/>
          <circle cx="50" cy="50" r="6" fill="#38BDF8"/>
          <circle cx="78" cy="50" r="6" fill="#38BDF8"/>
          <rect x="55" y="62" width="18" height="6" rx="3" fill="#7DD3FC"/>
          <rect x="54" y="80" width="8" height="18" rx="2" fill="#BAE6FD"/>
          <rect x="66" y="80" width="8" height="18" rx="2" fill="#BAE6FD"/>
          <rect x="40" y="20" width="8" height="10" rx="4" fill="#7DD3FC"/>
          <rect x="80" y="20" width="8" height="10" rx="4" fill="#7DD3FC"/>
        </svg>
      );

    case 'messages':
      return (
        <svg className={baseClasses} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Inbox/envelope illustration */}
          <rect x="24" y="40" width="80" height="54" rx="6" fill="#E0F2FE" stroke="#7DD3FC" strokeWidth="2"/>
          <path d="M24 46L64 74L104 46" stroke="#7DD3FC" strokeWidth="2" strokeLinecap="round"/>
          <circle cx="94" cy="34" r="10" fill="#38BDF8"/>
          <text x="94" y="38" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">0</text>
          <line x1="38" y1="78" x2="58" y2="78" stroke="#BAE6FD" strokeWidth="3" strokeLinecap="round"/>
          <line x1="38" y1="86" x2="50" y2="86" stroke="#BAE6FD" strokeWidth="3" strokeLinecap="round"/>
        </svg>
      );

    case 'schedules':
      return (
        <svg className={baseClasses} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Clock/calendar illustration */}
          <circle cx="64" cy="64" r="40" fill="#E0F2FE" stroke="#7DD3FC" strokeWidth="2"/>
          <circle cx="64" cy="64" r="4" fill="#38BDF8"/>
          <line x1="64" y1="64" x2="64" y2="40" stroke="#38BDF8" strokeWidth="3" strokeLinecap="round"/>
          <line x1="64" y1="64" x2="82" y2="72" stroke="#7DD3FC" strokeWidth="3" strokeLinecap="round"/>
          {/* Clock ticks */}
          <line x1="64" y1="28" x2="64" y2="32" stroke="#BAE6FD" strokeWidth="2" strokeLinecap="round"/>
          <line x1="64" y1="96" x2="64" y2="100" stroke="#BAE6FD" strokeWidth="2" strokeLinecap="round"/>
          <line x1="28" y1="64" x2="32" y2="64" stroke="#BAE6FD" strokeWidth="2" strokeLinecap="round"/>
          <line x1="96" y1="64" x2="100" y2="64" stroke="#BAE6FD" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      );

    case 'search':
      return (
        <svg className={baseClasses} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Magnifying glass with nothing found */}
          <circle cx="54" cy="54" r="28" fill="#E0F2FE" stroke="#7DD3FC" strokeWidth="2"/>
          <line x1="74" y1="74" x2="100" y2="100" stroke="#7DD3FC" strokeWidth="4" strokeLinecap="round"/>
          <line x1="42" y1="46" x2="66" y2="46" stroke="#BAE6FD" strokeWidth="3" strokeLinecap="round"/>
          <line x1="42" y1="56" x2="60" y2="56" stroke="#BAE6FD" strokeWidth="3" strokeLinecap="round"/>
          <line x1="42" y1="66" x2="54" y2="66" stroke="#BAE6FD" strokeWidth="3" strokeLinecap="round"/>
        </svg>
      );

    case 'data':
    default:
      return (
        <svg className={baseClasses} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Empty folder/document illustration */}
          <path d="M20 40C20 36.6863 22.6863 34 26 34H50L58 44H102C105.314 44 108 46.6863 108 50V94C108 97.3137 105.314 100 102 100H26C22.6863 100 20 97.3137 20 94V40Z" fill="#E0F2FE" stroke="#7DD3FC" strokeWidth="2"/>
          <line x1="36" y1="64" x2="92" y2="64" stroke="#BAE6FD" strokeWidth="3" strokeLinecap="round"/>
          <line x1="36" y1="76" x2="72" y2="76" stroke="#BAE6FD" strokeWidth="3" strokeLinecap="round"/>
          <line x1="36" y1="88" x2="56" y2="88" stroke="#BAE6FD" strokeWidth="3" strokeLinecap="round"/>
        </svg>
      );
  }
}

function ActionButton({ action, variant = 'default' }: { action: EmptyStateAction; variant?: 'default' | 'outline' | 'ghost' }) {
  if (action.href) {
    return (
      <Button variant={action.variant || variant} asChild>
        <a href={action.href}>{action.label}</a>
      </Button>
    );
  }

  return (
    <Button variant={action.variant || variant} onClick={action.onClick}>
      {action.label}
    </Button>
  );
}

export function EmptyState({
  icon,
  illustration,
  title,
  description,
  tip,
  action,
  secondaryAction,
  className = '',
}: EmptyStateProps) {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col items-center justify-center py-12 px-6 text-center">
        {/* Custom icon or illustration */}
        {icon ? (
          <div className="mb-4 text-muted-foreground/50">{icon}</div>
        ) : illustration ? (
          <EmptyIllustration type={illustration} />
        ) : null}

        {/* Title */}
        <h3 className="text-lg font-medium text-foreground mb-2">{title}</h3>

        {/* Description */}
        {description && (
          <p className="text-sm text-muted-foreground max-w-sm mb-4">{description}</p>
        )}

        {/* Tip */}
        {tip && (
          <div className="bg-sky-50 border border-sky-100 rounded-lg px-4 py-2 mb-4 max-w-sm">
            <p className="text-xs text-sky-700">
              <span className="font-medium">Tip:</span> {tip}
            </p>
          </div>
        )}

        {/* Actions */}
        {(action || secondaryAction) && (
          <div className="flex items-center gap-3 mt-2">
            {action && <ActionButton action={action} variant="default" />}
            {secondaryAction && <ActionButton action={secondaryAction} variant="outline" />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Export pre-configured empty states for common use cases
export function EmptySessionsState({ onNewSession }: { onNewSession?: () => void }) {
  return (
    <EmptyState
      illustration="sessions"
      title="No conversations yet"
      description="Start a chat with your AI assistant to begin. Your conversations will appear here."
      tip="Use Cmd+N to quickly start a new chat session from anywhere."
      action={{
        label: 'Start a conversation',
        href: '/chat',
      }}
    />
  );
}

export function EmptyAgentsState({ onCreate }: { onCreate?: () => void }) {
  return (
    <EmptyState
      illustration="agents"
      title="No agents configured"
      description="Create your first AI agent to customize how your assistant responds and behaves."
      tip="Each agent can have its own personality, skills, and system prompt."
      action={{
        label: 'Create your first agent',
        onClick: onCreate,
      }}
    />
  );
}

export function EmptyMessagesState({ filter }: { filter?: 'all' | 'unread' | 'archived' }) {
  const isFiltered = filter && filter !== 'all';

  return (
    <EmptyState
      illustration="messages"
      title={isFiltered ? 'No messages match your filter' : 'Your inbox is empty'}
      description={
        isFiltered
          ? `No ${filter} messages found. Try a different filter or check back later.`
          : 'Messages from your agents and scheduled tasks will appear here.'
      }
      tip={isFiltered ? undefined : "Agents can send you messages with updates, reminders, and notifications."}
    />
  );
}

export function EmptySchedulesState({ onNewSchedule }: { onNewSchedule?: () => void }) {
  return (
    <EmptyState
      illustration="schedules"
      title="No schedules set up"
      description="Automate recurring tasks by creating schedules. Your agents can run commands on a timer."
      tip="Schedules can run at fixed intervals, random times, or using cron expressions."
      action={{
        label: 'Create a schedule',
        onClick: onNewSchedule,
      }}
    />
  );
}

export function EmptySearchResultsState({ query, onClear }: { query?: string; onClear?: () => void }) {
  return (
    <EmptyState
      illustration="search"
      title="No results found"
      description={query ? `We couldn't find anything matching "${query}". Try a different search term.` : 'No items match your search criteria.'}
      action={onClear ? {
        label: 'Clear search',
        onClick: onClear,
        variant: 'outline',
      } : undefined}
    />
  );
}

export function EmptyDataState({ title, description }: { title?: string; description?: string }) {
  return (
    <EmptyState
      illustration="data"
      title={title || 'No data available'}
      description={description || 'There is no data to display at the moment.'}
    />
  );
}

export function EmptyAuditLogsState({ hasFilters, onClearFilters }: { hasFilters?: boolean; onClearFilters?: () => void }) {
  return (
    <EmptyState
      illustration="data"
      title={hasFilters ? 'No audit logs match your filters' : 'No audit activity yet'}
      description={hasFilters
        ? 'Try adjusting your filters or date range to see more results.'
        : 'Admin actions will be logged here for security and compliance tracking.'}
      action={hasFilters && onClearFilters ? {
        label: 'Clear filters',
        onClick: onClearFilters,
        variant: 'outline',
      } : undefined}
    />
  );
}
