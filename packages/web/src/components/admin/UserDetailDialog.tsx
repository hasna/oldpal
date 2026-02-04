'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertCircle,
  Calendar,
  Mail,
  Shield,
  Activity,
  MessageSquare,
  Bot,
  CreditCard,
  Loader2,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface UserDetail {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  emailVerified: boolean;
  avatarUrl: string | null;
  isActive: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  stripeCustomerId: string | null;
  createdAt: string;
  updatedAt: string;
  _counts: {
    sessions: number;
    agents: number;
  };
}

interface BillingInfo {
  stripeCustomerId: string | null;
  subscription: {
    id: string;
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    plan: {
      id: string;
      name: string;
      displayName: string;
      priceMonthly: number;
    };
  } | null;
  invoices: Array<{
    id: string;
    amountDue: number;
    amountPaid: number;
    status: string;
    periodStart: string | null;
    periodEnd: string | null;
    paidAt: string | null;
    invoiceUrl: string | null;
    createdAt: string;
  }>;
  availablePlans: Array<{
    id: string;
    name: string;
    displayName: string;
    priceMonthly: number;
  }>;
}

interface UserDetailDialogProps {
  userId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
}

export function UserDetailDialog({
  userId,
  open,
  onOpenChange,
  fetchWithAuth,
}: UserDetailDialogProps) {
  const [user, setUser] = useState<UserDetail | null>(null);
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [isOverriding, setIsOverriding] = useState(false);

  useEffect(() => {
    if (open && userId) {
      loadUser();
      loadBilling();
    } else if (!open) {
      setUser(null);
      setBilling(null);
      setError('');
      setSelectedPlanId('');
    }
  }, [open, userId]);

  const loadUser = async () => {
    if (!userId) return;

    setIsLoading(true);
    setError('');

    try {
      const response = await fetchWithAuth(`/api/v1/admin/users/${userId}`);
      const data = await response.json();

      if (data.success) {
        setUser(data.data);
      } else {
        setError(data.error?.message || 'Failed to load user');
      }
    } catch {
      setError('Failed to load user details');
    } finally {
      setIsLoading(false);
    }
  };

  const loadBilling = async () => {
    if (!userId) return;

    try {
      const response = await fetchWithAuth(`/api/v1/admin/users/${userId}/billing`);
      const data = await response.json();

      if (data.success) {
        setBilling(data.data);
        if (data.data.subscription?.plan) {
          setSelectedPlanId(data.data.subscription.plan.id);
        }
      }
    } catch {
      // Billing info is optional, don't show error
    }
  };

  const handleOverridePlan = async () => {
    if (!userId || !selectedPlanId) return;

    setIsOverriding(true);
    try {
      const response = await fetchWithAuth(`/api/v1/admin/users/${userId}/billing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: selectedPlanId,
          reason: 'Admin override',
        }),
      });

      const data = await response.json();

      if (data.success) {
        await loadBilling();
      } else {
        setError(data.error?.message || 'Failed to override plan');
      }
    } catch {
      setError('Failed to override plan');
    } finally {
      setIsOverriding(false);
    }
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>User Details</DialogTitle>
          <DialogDescription>
            View detailed information about this user.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="space-y-4 py-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-32" />
            <div className="grid grid-cols-2 gap-4 pt-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          </div>
        ) : user ? (
          <div className="space-y-6 py-4">
            <div className="flex items-start gap-4">
              <div className="flex-1 space-y-1">
                <h3 className="text-lg font-medium">{user.name || 'No name'}</h3>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  {user.email}
                </div>
              </div>
              <div className="flex flex-col gap-2 items-end">
                <Badge variant={user.role === 'admin' ? 'secondary' : 'default'}>
                  <Shield className="h-3 w-3 mr-1" />
                  {user.role}
                </Badge>
                <Badge variant={user.isActive ? 'success' : 'error'}>
                  <Activity className="h-3 w-3 mr-1" />
                  {user.isActive ? 'Active' : 'Suspended'}
                </Badge>
              </div>
            </div>

            {!user.isActive && user.suspendedReason && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Suspension reason:</strong> {user.suspendedReason}
                  {user.suspendedAt && (
                    <span className="block text-xs mt-1">
                      Suspended on {new Date(user.suspendedAt).toLocaleDateString()}
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  Sessions
                </div>
                <p className="text-2xl font-bold mt-1">{user._counts.sessions}</p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Bot className="h-4 w-4 text-muted-foreground" />
                  Agents
                </div>
                <p className="text-2xl font-bold mt-1">{user._counts.agents}</p>
              </div>
            </div>

            {/* Billing Section */}
            <div className="space-y-4 pt-2 border-t">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                <h4 className="font-medium">Billing</h4>
              </div>

              {billing ? (
                <div className="space-y-4">
                  <div className="rounded-lg border p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Current Plan</p>
                        <p className="text-lg font-bold">
                          {billing.subscription?.plan.displayName || 'No plan'}
                        </p>
                        {billing.subscription && (
                          <p className="text-xs text-muted-foreground">
                            {formatCurrency(billing.subscription.plan.priceMonthly)}/month
                            {billing.subscription.cancelAtPeriodEnd && (
                              <span className="text-destructive ml-2">
                                (Cancels at period end)
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                      <Badge variant={billing.subscription?.status === 'active' ? 'success' : 'default'}>
                        {billing.subscription?.status || 'None'}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select plan to override" />
                      </SelectTrigger>
                      <SelectContent>
                        {billing.availablePlans.map((plan) => (
                          <SelectItem key={plan.id} value={plan.id}>
                            {plan.displayName} ({formatCurrency(plan.priceMonthly)}/mo)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={handleOverridePlan}
                      disabled={!selectedPlanId || isOverriding || selectedPlanId === billing.subscription?.plan.id}
                      size="sm"
                    >
                      {isOverriding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Override
                    </Button>
                  </div>

                  {billing.invoices.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-2">Recent Invoices</p>
                      <div className="space-y-2 max-h-32 overflow-y-auto">
                        {billing.invoices.slice(0, 3).map((invoice) => (
                          <div
                            key={invoice.id}
                            className="flex items-center justify-between text-sm p-2 rounded bg-muted/50"
                          >
                            <span>
                              {new Date(invoice.createdAt).toLocaleDateString()}
                            </span>
                            <span className="font-medium">
                              {formatCurrency(invoice.amountDue)}
                            </span>
                            <Badge
                              variant={invoice.status === 'paid' ? 'success' : 'default'}
                              className="text-xs"
                            >
                              {invoice.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Loading billing info...</p>
              )}
            </div>

            <div className="space-y-2 text-sm pt-2 border-t">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>Created: {new Date(user.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>Updated: {new Date(user.updatedAt).toLocaleDateString()}</span>
              </div>
              {user.stripeCustomerId && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="font-mono text-xs">
                    Stripe: {user.stripeCustomerId}
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
