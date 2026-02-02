'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface User {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  emailVerified: boolean;
  avatarUrl: string | null;
  createdAt: string;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { user, fetchWithAuth } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    if (user && user.role !== 'admin') {
      router.push('/chat');
    }
  }, [user, router]);

  useEffect(() => {
    loadUsers();
  }, [page]);

  const loadUsers = async () => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search) params.set('search', search);

      const response = await fetchWithAuth(`/api/v1/admin/users?${params}`);
      const data = await response.json();
      if (data.success) {
        setUsers(data.data.items);
        setTotalPages(data.data.totalPages);
      } else {
        setError(data.error?.message || 'Failed to load users');
      }
    } catch {
      setError('Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadUsers();
  };

  if (user?.role !== 'admin') {
    return null;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-400"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-slate-100">Users</h1>
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users..."
              className="w-64"
            />
            <Button type="submit">Search</Button>
          </form>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Email</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Name</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Role</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Verified</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-slate-800/50 hover:bg-slate-900/30">
                  <td className="py-3 px-4 text-sm text-slate-100">{user.email}</td>
                  <td className="py-3 px-4 text-sm text-slate-300">{user.name || '-'}</td>
                  <td className="py-3 px-4 text-sm">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        user.role === 'admin'
                          ? 'bg-purple-500/20 text-purple-400'
                          : 'bg-slate-700 text-slate-400'
                      }`}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm">
                    {user.emailVerified ? (
                      <span className="text-green-400">Yes</span>
                    ) : (
                      <span className="text-slate-500">No</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-400">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-slate-400">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
