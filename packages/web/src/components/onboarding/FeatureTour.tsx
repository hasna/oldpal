'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { X, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface TourStep {
  id: string;
  target: string; // CSS selector
  title: string;
  content: string;
  path?: string; // Navigate to this path before showing
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

const tourSteps: TourStep[] = [
  {
    id: 'chat',
    target: '[data-tour="chat-input"]',
    title: 'Start a conversation',
    content: 'Type your message here to chat with your AI assistant. Ask questions, get help with tasks, or just have a conversation.',
    path: '/chat',
    placement: 'top',
  },
  {
    id: 'agents',
    target: '[data-tour="agents-link"]',
    title: 'Custom Agents',
    content: 'Create specialized AI agents with different personalities and capabilities for various tasks.',
    path: '/chat',
    placement: 'right',
  },
  {
    id: 'schedules',
    target: '[data-tour="schedules-link"]',
    title: 'Automated Schedules',
    content: 'Set up recurring tasks that run automatically. Great for daily summaries, reminders, and more.',
    path: '/chat',
    placement: 'right',
  },
  {
    id: 'settings',
    target: '[data-tour="settings-link"]',
    title: 'Customize your experience',
    content: 'Configure theme, notifications, and other preferences to make the app work the way you want.',
    path: '/chat',
    placement: 'right',
  },
];

interface FeatureTourProps {
  active: boolean;
  onComplete: () => void;
  onDismiss: () => void;
}

interface TooltipPosition {
  top: number;
  left: number;
}

export function FeatureTour({ active, onComplete, onDismiss }: FeatureTourProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [currentStep, setCurrentStep] = useState(0);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const step = tourSteps[currentStep];
  const isLastStep = currentStep === tourSteps.length - 1;

  const positionTooltip = useCallback(() => {
    if (!step) return;

    const target = document.querySelector(step.target);
    if (!target) {
      // If target not found, skip to next step or complete
      if (currentStep < tourSteps.length - 1) {
        setCurrentStep((prev) => prev + 1);
      } else {
        onComplete();
      }
      return;
    }

    const rect = target.getBoundingClientRect();
    const placement = step.placement || 'bottom';
    const tooltipWidth = 320;
    const tooltipHeight = 150;
    const offset = 12;

    let top = 0;
    let left = 0;

    switch (placement) {
      case 'top':
        top = rect.top - tooltipHeight - offset;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        break;
      case 'bottom':
        top = rect.bottom + offset;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
        left = rect.left - tooltipWidth - offset;
        break;
      case 'right':
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
        left = rect.right + offset;
        break;
    }

    // Ensure tooltip stays in viewport
    top = Math.max(16, Math.min(top, window.innerHeight - tooltipHeight - 16));
    left = Math.max(16, Math.min(left, window.innerWidth - tooltipWidth - 16));

    setTooltipPosition({ top, left });
    setIsVisible(true);

    // Highlight target element
    target.classList.add('tour-highlight');
    return () => target.classList.remove('tour-highlight');
  }, [step, currentStep, onComplete]);

  // Navigate to step path if needed
  useEffect(() => {
    if (!active || !step) return;

    if (step.path && pathname !== step.path) {
      router.push(step.path);
    }
  }, [active, step, pathname, router]);

  // Position tooltip when step changes
  useEffect(() => {
    if (!active) return;

    setIsVisible(false);
    const cleanup = positionTooltip();

    // Reposition on resize
    const handleResize = () => positionTooltip();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (cleanup) cleanup();
    };
  }, [active, currentStep, positionTooltip]);

  // Clean up highlights on unmount
  useEffect(() => {
    return () => {
      document.querySelectorAll('.tour-highlight').forEach((el) => {
        el.classList.remove('tour-highlight');
      });
    };
  }, []);

  if (!active || !tooltipPosition) return null;

  const handleNext = () => {
    // Remove highlight from current target
    const currentTarget = document.querySelector(step.target);
    currentTarget?.classList.remove('tour-highlight');

    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      const currentTarget = document.querySelector(step.target);
      currentTarget?.classList.remove('tour-highlight');
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleSkip = () => {
    document.querySelectorAll('.tour-highlight').forEach((el) => {
      el.classList.remove('tour-highlight');
    });
    onDismiss();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={handleSkip}
        aria-hidden="true"
      />

      {/* Tooltip */}
      <div
        className={cn(
          'fixed z-50 w-80 bg-background border rounded-lg shadow-lg p-4',
          'transition-all duration-200',
          isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        )}
        style={{ top: tooltipPosition.top, left: tooltipPosition.left }}
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
      >
        <button
          onClick={handleSkip}
          className="absolute top-2 right-2 p-1 rounded hover:bg-muted text-muted-foreground"
          aria-label="Skip tour"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="pr-6">
          <h3 className="font-semibold text-sm">{step.title}</h3>
          <p className="text-sm text-muted-foreground mt-2">{step.content}</p>
        </div>

        <div className="flex items-center justify-between mt-4 pt-3 border-t">
          <div className="flex items-center gap-1">
            {tourSteps.map((_, index) => (
              <div
                key={index}
                className={cn(
                  'w-2 h-2 rounded-full transition-colors',
                  index === currentStep ? 'bg-primary' : 'bg-muted'
                )}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <Button size="sm" variant="ghost" onClick={handlePrev}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
            <Button size="sm" onClick={handleNext}>
              {isLastStep ? (
                <>
                  <Check className="h-4 w-4 mr-1" />
                  Done
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="h-4 w-4 ml-1" />
                </>
              )}
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-2 text-right">
          {currentStep + 1} of {tourSteps.length}
        </p>
      </div>

      {/* Global styles for tour highlights */}
      <style jsx global>{`
        .tour-highlight {
          position: relative;
          z-index: 45 !important;
          box-shadow: 0 0 0 4px rgba(var(--primary), 0.3), 0 0 0 8px rgba(var(--primary), 0.1);
          border-radius: 4px;
        }
      `}</style>
    </>
  );
}
