'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, ChevronUp, X, CircleDashed, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { ONBOARDING_STEPS, type OnboardingStepId } from '@/hooks/use-onboarding';

interface OnboardingChecklistProps {
  completedSteps: string[];
  progress: number;
  onDismiss: () => void;
  onCompleteStep: (stepId: OnboardingStepId) => void;
}

export function OnboardingChecklist({
  completedSteps,
  progress,
  onDismiss,
  onCompleteStep,
}: OnboardingChecklistProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) return null;

  const isComplete = progress >= 100;

  const handleDismiss = () => {
    setIsVisible(false);
    onDismiss();
  };

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 w-80 z-40',
        'bg-background border rounded-lg shadow-lg',
        'animate-in slide-in-from-bottom-5 fade-in duration-300'
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between p-3 cursor-pointer',
          'border-b',
          isExpanded ? '' : 'border-b-0'
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <div className="flex-shrink-0 p-1.5 rounded-full bg-primary/10">
            <Rocket className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="font-medium text-sm">Getting Started</h3>
            {!isExpanded && (
              <p className="text-xs text-muted-foreground">
                {completedSteps.length} of {ONBOARDING_STEPS.length} completed
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDismiss();
            }}
            className="p-1 rounded hover:bg-muted text-muted-foreground"
            aria-label="Dismiss checklist"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            className="p-1 rounded hover:bg-muted text-muted-foreground"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="p-3">
          {/* Progress bar */}
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Steps */}
          <div className="space-y-2">
            {ONBOARDING_STEPS.map((step) => {
              const isCompleted = completedSteps.includes(step.id);

              return (
                <Link
                  key={step.id}
                  href={step.link}
                  onClick={() => !isCompleted && onCompleteStep(step.id as OnboardingStepId)}
                  className={cn(
                    'flex items-start gap-3 p-2 rounded-md transition-colors',
                    isCompleted
                      ? 'bg-muted/50'
                      : 'hover:bg-muted/50'
                  )}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {isCompleted ? (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </div>
                    ) : (
                      <CircleDashed className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm font-medium',
                        isCompleted && 'line-through text-muted-foreground'
                      )}
                    >
                      {step.label}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {step.description}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Complete state */}
          {isComplete && (
            <div className="mt-4 pt-3 border-t text-center">
              <p className="text-sm font-medium text-primary">All done!</p>
              <p className="text-xs text-muted-foreground mt-1">
                You&apos;ve completed the getting started guide
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={handleDismiss}
              >
                Dismiss
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
