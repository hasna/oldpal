'use client';

import { useState, useEffect } from 'react';
import { Bell, Mail, Volume2, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/Label';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/Separator';

interface NotificationPreferences {
  id: string;
  userId: string;
  emailNotifications: boolean;
  pushNotifications: boolean;
  soundEnabled: boolean;
  messageReceived: boolean;
  scheduleCompleted: boolean;
  scheduleFailed: boolean;
  usageWarning: boolean;
  usageExceeded: boolean;
  subscriptionChanged: boolean;
  system: boolean;
  updatedAt: string;
}

const defaultPreferences: Omit<NotificationPreferences, 'id' | 'userId' | 'updatedAt'> = {
  emailNotifications: true,
  pushNotifications: true,
  soundEnabled: true,
  messageReceived: true,
  scheduleCompleted: true,
  scheduleFailed: true,
  usageWarning: true,
  usageExceeded: true,
  subscriptionChanged: true,
  system: true,
};

interface NotificationToggleProps {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

function NotificationToggle({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: NotificationToggleProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="font-normal cursor-pointer">
          {label}
        </Label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}

export function NotificationPreferencesSection() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [preferences, setPreferences] = useState<typeof defaultPreferences>(defaultPreferences);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingField, setUpdatingField] = useState<string | null>(null);

  const fetchPreferences = async () => {
    try {
      const response = await fetchWithAuth('/api/v1/notifications/preferences');
      const data = await response.json();
      if (data.success && data.data.preferences) {
        const prefs = data.data.preferences;
        setPreferences({
          emailNotifications: prefs.emailNotifications ?? true,
          pushNotifications: prefs.pushNotifications ?? true,
          soundEnabled: prefs.soundEnabled ?? true,
          messageReceived: prefs.messageReceived ?? true,
          scheduleCompleted: prefs.scheduleCompleted ?? true,
          scheduleFailed: prefs.scheduleFailed ?? true,
          usageWarning: prefs.usageWarning ?? true,
          usageExceeded: prefs.usageExceeded ?? true,
          subscriptionChanged: prefs.subscriptionChanged ?? true,
          system: prefs.system ?? true,
        });
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to load notification preferences',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPreferences();
  }, []);

  const updatePreference = async (field: keyof typeof defaultPreferences, value: boolean) => {
    setUpdatingField(field);

    // Optimistic update
    setPreferences((prev) => ({ ...prev, [field]: value }));

    try {
      const response = await fetchWithAuth('/api/v1/notifications/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });

      const data = await response.json();
      if (!data.success) {
        // Revert on error
        setPreferences((prev) => ({ ...prev, [field]: !value }));
        toast({
          title: 'Error',
          description: data.error?.message || 'Failed to update preference',
          variant: 'destructive',
        });
      }
    } catch {
      // Revert on error
      setPreferences((prev) => ({ ...prev, [field]: !value }));
      toast({
        title: 'Error',
        description: 'Failed to update preference',
        variant: 'destructive',
      });
    } finally {
      setUpdatingField(null);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notification Preferences
          </CardTitle>
          <CardDescription>Control how you receive notifications</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Notification Preferences
        </CardTitle>
        <CardDescription>
          Control how and when you receive notifications
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Global Settings */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium flex items-center gap-2">
            Delivery Methods
          </h4>
          <div className="space-y-1 pl-1">
            <NotificationToggle
              id="emailNotifications"
              label="Email notifications"
              description="Receive important updates via email"
              checked={preferences.emailNotifications}
              onCheckedChange={(v) => updatePreference('emailNotifications', v)}
              disabled={updatingField === 'emailNotifications'}
            />
            <NotificationToggle
              id="pushNotifications"
              label="Push notifications"
              description="Receive notifications in your browser"
              checked={preferences.pushNotifications}
              onCheckedChange={(v) => updatePreference('pushNotifications', v)}
              disabled={updatingField === 'pushNotifications'}
            />
            <NotificationToggle
              id="soundEnabled"
              label="Sound"
              description="Play a sound when notifications arrive"
              checked={preferences.soundEnabled}
              onCheckedChange={(v) => updatePreference('soundEnabled', v)}
              disabled={updatingField === 'soundEnabled'}
            />
          </div>
        </div>

        <Separator />

        {/* Message Notifications */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Messages</h4>
          <div className="space-y-1 pl-1">
            <NotificationToggle
              id="messageReceived"
              label="New messages"
              description="When you receive a new message from an agent"
              checked={preferences.messageReceived}
              onCheckedChange={(v) => updatePreference('messageReceived', v)}
              disabled={updatingField === 'messageReceived'}
            />
          </div>
        </div>

        <Separator />

        {/* Schedule Notifications */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Schedules</h4>
          <div className="space-y-1 pl-1">
            <NotificationToggle
              id="scheduleCompleted"
              label="Schedule completed"
              description="When a scheduled task completes successfully"
              checked={preferences.scheduleCompleted}
              onCheckedChange={(v) => updatePreference('scheduleCompleted', v)}
              disabled={updatingField === 'scheduleCompleted'}
            />
            <NotificationToggle
              id="scheduleFailed"
              label="Schedule failed"
              description="When a scheduled task fails"
              checked={preferences.scheduleFailed}
              onCheckedChange={(v) => updatePreference('scheduleFailed', v)}
              disabled={updatingField === 'scheduleFailed'}
            />
          </div>
        </div>

        <Separator />

        {/* Usage Notifications */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Usage & Billing</h4>
          <div className="space-y-1 pl-1">
            <NotificationToggle
              id="usageWarning"
              label="Usage warning"
              description="When approaching your usage limits"
              checked={preferences.usageWarning}
              onCheckedChange={(v) => updatePreference('usageWarning', v)}
              disabled={updatingField === 'usageWarning'}
            />
            <NotificationToggle
              id="usageExceeded"
              label="Usage exceeded"
              description="When you exceed your usage limits"
              checked={preferences.usageExceeded}
              onCheckedChange={(v) => updatePreference('usageExceeded', v)}
              disabled={updatingField === 'usageExceeded'}
            />
            <NotificationToggle
              id="subscriptionChanged"
              label="Subscription changes"
              description="When your subscription is updated or renewed"
              checked={preferences.subscriptionChanged}
              onCheckedChange={(v) => updatePreference('subscriptionChanged', v)}
              disabled={updatingField === 'subscriptionChanged'}
            />
          </div>
        </div>

        <Separator />

        {/* System Notifications */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">System</h4>
          <div className="space-y-1 pl-1">
            <NotificationToggle
              id="system"
              label="System announcements"
              description="Important updates about the platform"
              checked={preferences.system}
              onCheckedChange={(v) => updatePreference('system', v)}
              disabled={updatingField === 'system'}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
