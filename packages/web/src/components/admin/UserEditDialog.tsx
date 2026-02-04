'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export interface UserForEdit {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  isActive: boolean;
  suspendedReason: string | null;
}

interface UserEditDialogProps {
  user: UserForEdit | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (userId: string, data: Partial<UserForEdit>) => Promise<void>;
  currentUserId: string;
}

export function UserEditDialog({
  user,
  open,
  onOpenChange,
  onSave,
  currentUserId,
}: UserEditDialogProps) {
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [role, setRole] = useState<'user' | 'admin'>(user?.role || 'user');
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [suspendedReason, setSuspendedReason] = useState(user?.suspendedReason || '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Reset form when user changes
  const handleOpenChange = (open: boolean) => {
    if (open && user) {
      setName(user.name || '');
      setEmail(user.email || '');
      setRole(user.role);
      setIsActive(user.isActive);
      setSuspendedReason(user.suspendedReason || '');
      setError('');
    }
    onOpenChange(open);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsLoading(true);
    setError('');

    try {
      const updates: Partial<UserForEdit> = {};

      if (name !== user.name) updates.name = name || null;
      if (email !== user.email) updates.email = email;
      if (role !== user.role) updates.role = role;
      if (isActive !== user.isActive) {
        updates.isActive = isActive;
        if (!isActive && suspendedReason) {
          updates.suspendedReason = suspendedReason;
        }
      }

      await onSave(user.id, updates);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setIsLoading(false);
    }
  };

  const isSelf = user?.id === currentUserId;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user details and permissions.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="User name"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="role">Role</Label>
              <Select
                value={role}
                onValueChange={(value: 'user' | 'admin') => setRole(value)}
                disabled={isSelf}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              {isSelf && (
                <p className="text-xs text-muted-foreground">
                  You cannot change your own role
                </p>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="active">Account Active</Label>
                <p className="text-xs text-muted-foreground">
                  Inactive accounts cannot log in
                </p>
              </div>
              <Switch
                id="active"
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={isSelf}
              />
            </div>

            {!isActive && (
              <div className="grid gap-2">
                <Label htmlFor="reason">Suspension Reason</Label>
                <Textarea
                  id="reason"
                  value={suspendedReason}
                  onChange={(e) => setSuspendedReason(e.target.value)}
                  placeholder="Reason for suspension (optional)"
                  rows={2}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
