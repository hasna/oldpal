'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

export default function SettingsPage() {
  const { user, fetchWithAuth, logout } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage('');
    setError('');

    try {
      const response = await fetchWithAuth(`/api/v1/users/${user?.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      const data = await response.json();
      if (data.success) {
        setMessage('Settings saved successfully');
      } else {
        setError(data.error?.message || 'Failed to save settings');
      }
    } catch {
      setError('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-100 mb-6">Settings</h1>

      {message && (
        <div className="mb-4 rounded-md bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-400">
          {message}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* Profile Section */}
        <section className="p-4 rounded-lg border border-slate-800 bg-slate-900/50">
          <h2 className="text-lg font-medium text-slate-200 mb-4">Profile</h2>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={user?.email || ''}
                disabled
                className="bg-slate-800/50"
              />
              <p className="text-xs text-slate-500 mt-1">Email cannot be changed</p>
            </div>
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </form>
        </section>

        {/* Account Section */}
        <section className="p-4 rounded-lg border border-slate-800 bg-slate-900/50">
          <h2 className="text-lg font-medium text-slate-200 mb-4">Account</h2>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-slate-400">Account Type</p>
              <p className="text-slate-100 capitalize">{user?.role || 'user'}</p>
            </div>
            <div>
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm('Are you sure you want to sign out?')) {
                    logout();
                  }
                }}
              >
                Sign Out
              </Button>
            </div>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="p-4 rounded-lg border border-red-500/20 bg-red-500/5">
          <h2 className="text-lg font-medium text-red-400 mb-4">Danger Zone</h2>
          <p className="text-sm text-slate-400 mb-4">
            Once you delete your account, there is no going back. Please be certain.
          </p>
          <Button
            variant="outline"
            className="border-red-500/30 text-red-400 hover:border-red-500 hover:bg-red-500/10"
            onClick={() => alert('Account deletion is not implemented in this demo')}
          >
            Delete Account
          </Button>
        </section>
      </div>
    </div>
  );
}
