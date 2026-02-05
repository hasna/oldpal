'use client';

import { useState, useEffect } from 'react';
import { Key, Plus, Trash2, Copy, Check, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface CreatedApiKey extends ApiKey {
  fullKey: string;
}

export function ApiKeysSection() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);

  const fetchKeys = async () => {
    try {
      const response = await fetchWithAuth('/api/v1/users/me/api-keys');
      const data = await response.json();
      if (data.success) {
        setKeys(data.data.keys);
      } else {
        setError(data.error?.message || 'Failed to load API keys');
      }
    } catch {
      setError('Failed to load API keys');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    setIsCreating(true);
    setError('');

    try {
      const response = await fetchWithAuth('/api/v1/users/me/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName }),
      });

      const data = await response.json();
      if (data.success) {
        setCreatedKey(data.data.key);
        setNewKeyName('');
        fetchKeys();
        toast({
          title: 'API key created',
          description: 'Copy your key now - it will not be shown again.',
        });
      } else {
        setError(data.error?.message || 'Failed to create API key');
      }
    } catch {
      setError('Failed to create API key');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    setRevokingKeyId(keyId);

    try {
      const response = await fetchWithAuth(`/api/v1/users/me/api-keys/${keyId}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      if (data.success) {
        setKeys((prev) => prev.filter((k) => k.id !== keyId));
        toast({
          title: 'API key revoked',
          description: 'The API key has been permanently revoked.',
        });
      } else {
        toast({
          title: 'Error',
          description: data.error?.message || 'Failed to revoke API key',
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to revoke API key',
        variant: 'destructive',
      });
    } finally {
      setRevokingKeyId(null);
    }
  };

  const copyToClipboard = async (text: string, keyId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKeyId(keyId);
      setTimeout(() => setCopiedKeyId(null), 2000);
      toast({
        title: 'Copied',
        description: 'API key copied to clipboard.',
      });
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const handleCloseCreateDialog = () => {
    setIsCreateDialogOpen(false);
    setCreatedKey(null);
    setNewKeyName('');
    setError('');
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            API Keys
          </CardTitle>
          <CardDescription>Manage your API keys for programmatic access</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              API Keys
            </CardTitle>
            <CardDescription>
              Manage API keys for programmatic access to your account
            </CardDescription>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Create Key
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {createdKey ? 'API Key Created' : 'Create API Key'}
                </DialogTitle>
                <DialogDescription>
                  {createdKey
                    ? 'Copy your API key now. It will not be shown again.'
                    : 'Give your API key a name to help you identify it later.'}
                </DialogDescription>
              </DialogHeader>

              {createdKey ? (
                <div className="space-y-4">
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Make sure to copy your API key now. You won&apos;t be able to see it again!
                    </AlertDescription>
                  </Alert>
                  <div className="space-y-2">
                    <Label>Your API Key</Label>
                    <div className="flex gap-2">
                      <Input
                        value={createdKey.fullKey}
                        readOnly
                        className="font-mono text-sm"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(createdKey.fullKey, 'new')}
                      >
                        {copiedKeyId === 'new' ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={handleCloseCreateDialog}>Done</Button>
                  </DialogFooter>
                </div>
              ) : (
                <form onSubmit={handleCreateKey}>
                  {error && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="keyName">Key Name</Label>
                      <Input
                        id="keyName"
                        placeholder="e.g., Production Server"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        disabled={isCreating}
                      />
                      <p className="text-xs text-muted-foreground">
                        Choose a descriptive name to identify this key.
                      </p>
                    </div>
                  </div>
                  <DialogFooter className="mt-6">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCloseCreateDialog}
                      disabled={isCreating}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={isCreating || !newKeyName.trim()}>
                      {isCreating ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        'Create Key'
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {keys.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Key className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="font-medium">No API keys yet</p>
            <p className="text-sm">Create an API key to access your account programmatically.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{key.name}</span>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                      {key.keyPrefix}...
                    </code>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Created {formatDate(key.createdAt)}</span>
                    <span>Last used {formatDate(key.lastUsedAt)}</span>
                    {key.expiresAt && (
                      <span>
                        Expires {formatDate(key.expiresAt)}
                      </span>
                    )}
                  </div>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      disabled={revokingKeyId === key.id}
                    >
                      {revokingKeyId === key.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently revoke the API key &quot;{key.name}&quot;. Any
                        applications using this key will no longer be able to authenticate.
                        This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleRevokeKey(key.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Revoke Key
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-4">
          API keys provide full access to your account. Keep them secure and never share them publicly.
        </p>
      </CardContent>
    </Card>
  );
}
