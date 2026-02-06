'use client';

import { useRouter } from 'next/navigation';
import { ArrowUpCircle, Zap, MessageSquare, Users, Calendar, Bot } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/Button';

type LimitType = 'assistants' | 'messages' | 'sessions' | 'schedules';

interface UpgradePromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limitType: LimitType;
  currentUsage?: number;
  limit?: number;
  planName?: string;
}

const limitTypeConfig: Record<
  LimitType,
  { icon: typeof Bot; title: string; description: string }
> = {
  assistants: {
    icon: Bot,
    title: 'Assistant Limit Reached',
    description: 'You have reached the maximum number of assistants for your plan.',
  },
  messages: {
    icon: MessageSquare,
    title: 'Daily Message Limit Reached',
    description: 'You have used all your messages for today.',
  },
  sessions: {
    icon: Users,
    title: 'Session Limit Reached',
    description: 'You have reached the maximum number of sessions for your plan.',
  },
  schedules: {
    icon: Calendar,
    title: 'Schedule Limit Reached',
    description: 'You have reached the maximum number of scheduled tasks for your plan.',
  },
};

export function UpgradePromptDialog({
  open,
  onOpenChange,
  limitType,
  currentUsage,
  limit,
  planName,
}: UpgradePromptDialogProps) {
  const router = useRouter();
  const config = limitTypeConfig[limitType];
  const Icon = config.icon;

  const handleUpgrade = () => {
    onOpenChange(false);
    router.push('/billing');
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-full bg-primary/10">
              <Icon className="h-6 w-6 text-primary" />
            </div>
            <AlertDialogTitle>{config.title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="space-y-3">
            <p>{config.description}</p>

            {currentUsage !== undefined && limit !== undefined && (
              <div className="bg-muted rounded-lg p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Current Usage</span>
                  <span className="font-medium">{currentUsage} / {limit}</span>
                </div>
                <div className="w-full bg-background rounded-full h-2">
                  <div
                    className="bg-destructive h-2 rounded-full"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            )}

            {planName && (
              <p className="text-sm">
                Your current plan: <span className="font-medium">{planName}</span>
              </p>
            )}

            <div className="bg-primary/5 rounded-lg p-3 border border-primary/20">
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                Upgrade for more capacity
              </p>
              <ul className="mt-2 text-sm text-muted-foreground space-y-1">
                <li>• More assistants, sessions, and schedules</li>
                <li>• Higher daily message limits</li>
                <li>• Priority support</li>
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Maybe Later</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button onClick={handleUpgrade}>
              <ArrowUpCircle className="h-4 w-4 mr-2" />
              View Plans
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
