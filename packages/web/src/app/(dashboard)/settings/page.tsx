'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2, Eye, EyeOff, Check, X, Download, FileJson, FileText, FileSpreadsheet } from 'lucide-react';
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
import { AvatarUpload } from '@/components/ui/avatar-upload';
import { LoginHistory, ActiveSessions, LanguageSelector } from '@/components/settings';

// Password strength checker
function checkPasswordStrength(password: string): {
  score: number;
  checks: { label: string; passed: boolean }[];
} {
  const checks = [
    { label: 'At least 8 characters', passed: password.length >= 8 },
    { label: 'Contains lowercase letter', passed: /[a-z]/.test(password) },
    { label: 'Contains uppercase letter', passed: /[A-Z]/.test(password) },
    { label: 'Contains number', passed: /[0-9]/.test(password) },
    { label: 'Contains special character', passed: /[!@#$%^&*(),.?":{}|<>]/.test(password) },
  ];
  const score = checks.filter((c) => c.passed).length;
  return { score, checks };
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, fetchWithAuth, logout, accessToken, setAuth } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState(user?.name || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // Data export state
  const [isExporting, setIsExporting] = useState(false);

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

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user?.id) {
      setPasswordError('User not loaded. Please refresh the page.');
      return;
    }

    // Client-side validation
    if (!currentPassword) {
      setPasswordError('Current password is required');
      return;
    }
    if (!newPassword) {
      setPasswordError('New password is required');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError('New password must be different from current password');
      return;
    }

    const strength = checkPasswordStrength(newPassword);
    if (strength.score < 4) {
      setPasswordError('Password does not meet requirements');
      return;
    }

    setIsChangingPassword(true);
    setPasswordError('');

    try {
      const response = await fetchWithAuth(`/api/v1/users/${user.id}/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });

      const data = await response.json();
      if (data.success) {
        toast({
          title: 'Password changed',
          description: 'Your password has been updated successfully.',
        });
        // Clear form
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setPasswordError(data.error?.message || 'Failed to change password');
      }
    } catch {
      setPasswordError('Failed to change password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const passwordStrength = checkPasswordStrength(newPassword);
  const canChangePassword = currentPassword && newPassword && confirmPassword &&
    newPassword === confirmPassword && passwordStrength.score >= 4 && !isChangingPassword;

  const handleExport = async (format: 'json' | 'csv' | 'markdown', type: 'all' | 'sessions' | 'agents' = 'all') => {
    setIsExporting(true);
    try {
      const response = await fetchWithAuth(`/api/v1/export?format=${format}&type=${type}`);
      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const filename = response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1]
        || `export.${format}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Export complete',
        description: `Your data has been exported as ${format.toUpperCase()}.`,
      });
    } catch {
      toast({
        title: 'Export failed',
        description: 'Failed to export your data. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Show loading state while user is not loaded
  if (!isUserLoaded) {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        {/* Page Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h1 className="text-lg font-semibold">Settings</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto space-y-6">
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
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Page Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>

      {/* Page Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
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
            <div className="flex flex-col sm:flex-row gap-6">
              {/* Avatar Upload */}
              <div className="flex-shrink-0">
                <Label className="block mb-2">Profile Picture</Label>
                <AvatarUpload
                  currentAvatarUrl={user?.avatarUrl}
                  fallback={user?.name?.charAt(0)?.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || '?'}
                  onUpload={async (url) => {
                    if (!user?.id) return;
                    const response = await fetchWithAuth(`/api/v1/users/${user.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ avatarUrl: url }),
                    });
                    const data = await response.json();
                    if (data.success && accessToken) {
                      setAuth({ ...user, avatarUrl: url }, accessToken);
                      toast({ title: 'Avatar updated', description: 'Your profile picture has been updated.' });
                    } else {
                      throw new Error(data.error?.message || 'Failed to update avatar');
                    }
                  }}
                  onRemove={async () => {
                    if (!user?.id) return;
                    const response = await fetchWithAuth(`/api/v1/users/${user.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ avatarUrl: null }),
                    });
                    const data = await response.json();
                    if (data.success && accessToken) {
                      setAuth({ ...user, avatarUrl: null }, accessToken);
                      toast({ title: 'Avatar removed', description: 'Your profile picture has been removed.' });
                    } else {
                      throw new Error(data.error?.message || 'Failed to remove avatar');
                    }
                  }}
                  disabled={!isUserLoaded}
                  size="lg"
                />
              </div>

              {/* Profile Form */}
              <form onSubmit={handleSave} className="flex-1 space-y-4">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={user?.email || ''}
                    disabled
                    className="bg-muted"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Email cannot be changed</p>
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
            </div>
          </CardContent>
        </Card>

        {/* Password Section - Only for non-OAuth users */}
        {user?.hasPassword && (
          <Card>
            <CardHeader>
              <CardTitle>Change Password</CardTitle>
              <CardDescription>Update your account password</CardDescription>
            </CardHeader>
            <CardContent>
              {passwordError && (
                <Alert variant="destructive" className="mb-4" role="alert">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{passwordError}</AlertDescription>
                </Alert>
              )}
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div>
                  <Label htmlFor="currentPassword">Current Password</Label>
                  <div className="relative">
                    <Input
                      id="currentPassword"
                      type={showCurrentPassword ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={(e) => {
                        setCurrentPassword(e.target.value);
                        if (passwordError) setPasswordError('');
                      }}
                      placeholder="Enter your current password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    >
                      {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <Label htmlFor="newPassword">New Password</Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        if (passwordError) setPasswordError('');
                      }}
                      placeholder="Enter your new password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                    >
                      {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {/* Password strength indicator */}
                  {newPassword && (
                    <div className="mt-2 space-y-2">
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((level) => (
                          <div
                            key={level}
                            className={`h-1 flex-1 rounded ${
                              passwordStrength.score >= level
                                ? passwordStrength.score >= 4
                                  ? 'bg-green-500'
                                  : passwordStrength.score >= 3
                                    ? 'bg-yellow-500'
                                    : 'bg-red-500'
                                : 'bg-muted'
                            }`}
                          />
                        ))}
                      </div>
                      <div className="text-xs space-y-1">
                        {passwordStrength.checks.slice(0, 4).map((check) => (
                          <div key={check.label} className="flex items-center gap-1">
                            {check.passed ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <X className="h-3 w-3 text-muted-foreground/50" />
                            )}
                            <span className={check.passed ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground'}>
                              {check.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        if (passwordError) setPasswordError('');
                      }}
                      placeholder="Confirm your new password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {confirmPassword && newPassword !== confirmPassword && (
                    <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                  )}
                </div>
                <Button type="submit" disabled={!canChangePassword}>
                  {isChangingPassword ? 'Changing...' : 'Change Password'}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* OAuth Notice - Only for OAuth-only users */}
        {user && !user.hasPassword && (
          <Card>
            <CardHeader>
              <CardTitle>Password</CardTitle>
              <CardDescription>Password management is not available</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                You signed up using Google OAuth. To change your password, please manage your credentials through your Google account.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Language Selector */}
        <LanguageSelector />

        {/* Account Section */}
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Manage your account settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Account Type</p>
              <p className="text-foreground capitalize">{user?.role || 'user'}</p>
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

        {/* Active Sessions Section */}
        <ActiveSessions fetchWithAuth={fetchWithAuth} />

        {/* Login History Section */}
        <LoginHistory fetchWithAuth={fetchWithAuth} />

        {/* Data Export Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Export Your Data
            </CardTitle>
            <CardDescription>
              Download a copy of all your data. Useful for backups or GDPR requests.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Button
                variant="outline"
                onClick={() => handleExport('json')}
                disabled={isExporting}
                className="flex items-center gap-2"
              >
                <FileJson className="h-4 w-4" />
                Export as JSON
              </Button>
              <Button
                variant="outline"
                onClick={() => handleExport('csv')}
                disabled={isExporting}
                className="flex items-center gap-2"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Export as CSV
              </Button>
              <Button
                variant="outline"
                onClick={() => handleExport('markdown')}
                disabled={isExporting}
                className="flex items-center gap-2"
              >
                <FileText className="h-4 w-4" />
                Export as Markdown
              </Button>
            </div>
            {isExporting && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Preparing your export...
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Exports include your sessions, messages, agents, and schedules.
            </p>
          </CardContent>
        </Card>

          {/* Danger Zone */}
          <Card className="border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50">
            <CardHeader>
              <CardTitle className="text-red-600 dark:text-red-400">Danger Zone</CardTitle>
              <CardDescription className="text-muted-foreground">
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
      </div>
    </div>
  );
}
