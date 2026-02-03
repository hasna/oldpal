'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';

export default function SettingsPage() {
  const router = useRouter();
  const { user, fetchWithAuth, logout, accessToken, setAuth } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState(user?.name || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Sync name field when user data changes (e.g., after rehydration)
  useEffect(() => {
    if (user?.name !== undefined) {
      setName(user.name || '');
    }
  }, [user?.name]);

  // Validation: name must not be empty and must be different from current
  const trimmedName = name.trim();
  const isNameEmpty = trimmedName.length === 0;
  const isNameUnchanged = trimmedName === (user?.name || '').trim();
  // Disable form if user is not loaded to prevent invalid PATCH calls
  const isUserLoaded = Boolean(user?.id);
  const canSave = isUserLoaded && !isNameEmpty && !isNameUnchanged && !isSaving;

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    // Clear top-level error when user edits the name field
    if (error) {
      setError('');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    // Guard: don't make PATCH call if user is not loaded
    if (!user?.id) {
      setError('User not loaded. Please refresh the page.');
      return;
    }

    // Client-side validation
    if (isNameEmpty) {
      setError('Name cannot be empty');
      return;
    }
    if (isNameUnchanged) {
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const response = await fetchWithAuth(`/api/v1/users/${user?.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      const data = await response.json();
      if (data.success) {
        // Update auth store so nav and other components show new name
        if (user && accessToken) {
          setAuth({ ...user, name: trimmedName }, accessToken);
        }
        toast({
          title: 'Settings saved',
          description: 'Your profile has been updated successfully.',
        });
      } else {
        setError(data.error?.message || 'Failed to save settings');
      }
    } catch {
      setError('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user?.id) {
      setError('User not loaded. Please refresh the page.');
      return;
    }

    setIsDeleting(true);
    setError('');

    try {
      const response = await fetchWithAuth(`/api/v1/users/${user.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      if (data.success) {
        // Close the dialog first
        setDeleteDialogOpen(false);
        // Show success message
        toast({
          title: 'Account deleted',
          description: 'Your account has been permanently deleted.',
        });
        // Logout and redirect to login page
        logout();
        router.push('/login');
      } else {
        setError(data.error?.message || 'Failed to delete account');
        setDeleteDialogOpen(false);
      }
    } catch {
      setError('Failed to delete account');
      setDeleteDialogOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  // Show loading state while user is not loaded
  if (!isUserLoaded) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">Settings</h1>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-4 w-48 mt-1" />
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Skeleton className="h-4 w-12 mb-2" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div>
                <Skeleton className="h-4 w-12 mb-2" />
                <Skeleton className="h-10 w-full" />
              </div>
              <Skeleton className="h-10 w-32" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Settings</h1>

      {error && (
        <Alert variant="destructive" className="mb-4" role="alert" aria-live="assertive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-6">
        {/* Profile Section */}
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Manage your profile information</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={user?.email || ''}
                  disabled
                  className="bg-gray-100"
                />
                <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
              </div>
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={handleNameChange}
                  placeholder="Your name"
                  disabled={!isUserLoaded}
                  aria-invalid={isNameEmpty && name !== ''}
                  aria-describedby={isNameEmpty && name !== '' ? 'name-error' : undefined}
                />
                {isNameEmpty && name !== '' && (
                  <p id="name-error" className="text-sm text-red-500 mt-1" role="alert">
                    Name cannot be empty
                  </p>
                )}
              </div>
              <Button type="submit" disabled={!canSave}>
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Account Section */}
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Manage your account settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-gray-500">Account Type</p>
              <p className="text-gray-900 capitalize">{user?.role || 'user'}</p>
            </div>
            <div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline">Sign Out</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Sign out?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to sign out of your account?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={logout}>Sign Out</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-600">Danger Zone</CardTitle>
            <CardDescription className="text-gray-600">
              Once you delete your account, there is no going back. Please be certain.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="border-red-500/30 text-red-600 hover:border-red-500 hover:bg-red-500/10"
                >
                  Delete Account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete your account
                    and remove all your data including:
                    <ul className="list-disc list-inside mt-2 space-y-1">
                      <li>All your chat sessions and messages</li>
                      <li>All your agents and their configurations</li>
                      <li>All your scheduled tasks</li>
                      <li>All agent-to-agent messages</li>
                    </ul>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteAccount}
                    disabled={isDeleting}
                    className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                  >
                    {isDeleting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      'Delete Account'
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
