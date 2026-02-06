'use client';

import { useState } from 'react';
import { Sparkles, Bot, Calendar, Settings, ArrowRight, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface WelcomeModalProps {
  open: boolean;
  onClose: () => void;
  onStartTour: () => void;
  userName?: string | null;
}

const features = [
  {
    icon: Bot,
    title: 'AI Chat',
    description: 'Have natural conversations with your personal AI assistant',
  },
  {
    icon: Sparkles,
    title: 'Custom Assistants',
    description: 'Create specialized assistants for different tasks',
  },
  {
    icon: Calendar,
    title: 'Schedules',
    description: 'Automate repetitive tasks with scheduled runs',
  },
  {
    icon: Settings,
    title: 'Customization',
    description: 'Configure everything to match your workflow',
  },
];

export function WelcomeModal({ open, onClose, onStartTour, userName }: WelcomeModalProps) {
  const [step, setStep] = useState(0);

  const handleNext = () => {
    if (step === 0) {
      setStep(1);
    } else {
      onStartTour();
    }
  };

  const handleSkip = () => {
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleSkip()}>
      <DialogContent className="sm:max-w-lg">
        {step === 0 ? (
          <>
            <DialogHeader className="text-center pb-4">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
              <DialogTitle className="text-2xl">
                Welcome{userName ? `, ${userName.split(' ')[0]}` : ''}!
              </DialogTitle>
              <DialogDescription className="text-base">
                Get started with your personal AI assistant platform
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-4">
              {features.map((feature, index) => (
                <div
                  key={index}
                  className={cn(
                    'flex flex-col items-center text-center p-4 rounded-lg',
                    'bg-muted/50 border border-transparent',
                    'hover:border-primary/20 transition-colors'
                  )}
                >
                  <feature.icon className="h-8 w-8 text-primary mb-2" />
                  <h3 className="font-medium text-sm">{feature.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{feature.description}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between pt-4 border-t">
              <Button variant="ghost" onClick={handleSkip}>
                Skip for now
              </Button>
              <Button onClick={handleNext}>
                Get started
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="text-center pb-4">
              <DialogTitle className="text-xl">Ready for a quick tour?</DialogTitle>
              <DialogDescription>
                We&apos;ll show you around the key features in less than a minute
              </DialogDescription>
            </DialogHeader>
            <div className="py-6 space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <div className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">
                  1
                </div>
                <div>
                  <p className="text-sm font-medium">Chat with your assistant</p>
                  <p className="text-xs text-muted-foreground">Start conversations naturally</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <div className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">
                  2
                </div>
                <div>
                  <p className="text-sm font-medium">Create custom assistants</p>
                  <p className="text-xs text-muted-foreground">Build AI helpers for specific tasks</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <div className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">
                  3
                </div>
                <div>
                  <p className="text-sm font-medium">Automate with schedules</p>
                  <p className="text-xs text-muted-foreground">Set up recurring tasks</p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between pt-4 border-t">
              <Button variant="ghost" onClick={handleSkip}>
                Maybe later
              </Button>
              <Button onClick={handleNext}>
                Start tour
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </>
        )}
        <button
          onClick={handleSkip}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </DialogContent>
    </Dialog>
  );
}
