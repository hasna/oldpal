'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CreditCard,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PaymentMethods } from '@/components/billing';

interface Plan {
  id: string;
  name: string;
  displayName: string;
  priceMonthly: number;
  maxAssistants: number;
  maxMessagesPerDay: number;
  maxSessions: number;
  features: string[];
}

interface Subscription {
  id: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

interface Invoice {
  id: string;
  stripeInvoiceId: string;
  amountDue: number;
  amountPaid: number;
  status: string;
  invoiceUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface BillingData {
  subscription: Subscription | null;
  plan: Plan | null;
  isFreeTier: boolean;
}

interface UsageData {
  assistants: number;
  sessions: number;
  messagestoday: number;
}

export default function BillingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [billingData, setBillingData] = useState<BillingData | null>(null);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState('');

  // Handle success/cancel query params
  useEffect(() => {
    if (searchParams?.get('success') === 'true') {
      toast({
        title: 'Subscription successful!',
        description: 'Welcome to your new plan. Your subscription is now active.',
      });
      // Remove query params
      router.replace('/billing');
    } else if (searchParams?.get('canceled') === 'true') {
      toast({
        title: 'Checkout canceled',
        description: 'You can try again when you are ready.',
        variant: 'destructive',
      });
      router.replace('/billing');
    }
  }, [searchParams, toast, router]);

  const loadBillingData = useCallback(async () => {
    setError('');
    try {
      // Fetch billing data and usage data in parallel
      const [billingResponse, usageResponse] = await Promise.all([
        fetchWithAuth('/api/v1/billing/subscription'),
        fetchWithAuth('/api/v1/billing/usage'),
      ]);

      const billingResult = await billingResponse.json();
      const usageResult = await usageResponse.json();

      if (billingResult.success) {
        setBillingData(billingResult.data);
      } else {
        setError(billingResult.error?.message || 'Failed to load billing data');
      }

      if (usageResult.success) {
        setUsageData(usageResult.data);
      }
    } catch {
      setError('Failed to load billing data');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    loadBillingData();
  }, [loadBillingData]);

  const openCustomerPortal = async () => {
    setPortalLoading(true);
    try {
      const response = await fetchWithAuth('/api/v1/billing/customer-portal', {
        method: 'POST',
      });
      const data = await response.json();
      if (data.success && data.data.portalUrl) {
        window.location.href = data.data.portalUrl;
      } else {
        toast({
          title: 'Error',
          description: data.error?.message || 'Failed to open billing portal',
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to open billing portal',
        variant: 'destructive',
      });
    } finally {
      setPortalLoading(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  const formatLimit = (value: number) => {
    if (value === -1) return 'Unlimited';
    return value.toLocaleString();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800">Active</Badge>;
      case 'canceled':
        return <Badge className="bg-muted text-muted-foreground">Canceled</Badge>;
      case 'past_due':
        return <Badge className="bg-red-100 text-red-800">Past Due</Badge>;
      case 'trialing':
        return <Badge className="bg-blue-100 text-blue-800">Trial</Badge>;
      case 'paused':
        return <Badge className="bg-yellow-100 text-yellow-800">Paused</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  // Compute usage display data from real API data
  const usageDisplay = {
    assistants: {
      current: usageData?.assistants ?? 0,
      limit: billingData?.plan?.maxAssistants ?? 5,
    },
    messages: {
      current: usageData?.messagestoday ?? 0,
      limit: billingData?.plan?.maxMessagesPerDay ?? 100,
    },
    sessions: {
      current: usageData?.sessions ?? 0,
      limit: billingData?.plan?.maxSessions ?? 10,
    },
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        {/* Page Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h1 className="text-lg font-semibold">Billing</h1>
          <Button size="sm" variant="outline" disabled>
            <ExternalLink className="h-4 w-4 mr-2" />
            Manage Billing
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-40" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-40" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Page Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h1 className="text-lg font-semibold">Billing</h1>
        {billingData?.isFreeTier ? (
          <Button size="sm" onClick={() => router.push('/pricing')}>
            <ArrowRight className="h-4 w-4 mr-2" />
            Upgrade Plan
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={openCustomerPortal}
            disabled={portalLoading}
          >
            {portalLoading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <ExternalLink className="h-4 w-4 mr-2" />
            )}
            Manage Billing
          </Button>
        )}
      </div>

      {/* Page Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* Current Plan Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Current Plan
            </CardTitle>
            <CardDescription>
              Your subscription details and billing status
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold">
                  {billingData?.plan?.displayName || 'Free'}
                </span>
                {billingData?.subscription && getStatusBadge(billingData.subscription.status)}
                {billingData?.isFreeTier && (
                  <Badge className="bg-muted text-muted-foreground">Free Tier</Badge>
                )}
              </div>

              <div className="text-3xl font-bold text-foreground">
                {formatCurrency(billingData?.plan?.priceMonthly || 0)}
                <span className="text-base font-normal text-muted-foreground">/month</span>
              </div>

              {billingData?.subscription && (
                <>
                  <div className="text-sm text-muted-foreground">
                    Current period: {formatDate(billingData.subscription.currentPeriodStart)} -{' '}
                    {formatDate(billingData.subscription.currentPeriodEnd)}
                  </div>

                  {billingData.subscription.cancelAtPeriodEnd && (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        Your subscription will cancel at the end of the billing period.
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              )}

              <div className="flex gap-2 pt-4">
                {billingData?.isFreeTier ? (
                  <Button onClick={() => router.push('/pricing')}>
                    Upgrade Plan
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" onClick={() => router.push('/pricing')}>
                      Change Plan
                    </Button>
                    <Button
                      variant="outline"
                      onClick={openCustomerPortal}
                      disabled={portalLoading}
                    >
                      {portalLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <ExternalLink className="h-4 w-4 mr-2" />
                      )}
                      Manage Billing
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Usage Card */}
        <Card>
          <CardHeader>
            <CardTitle>Usage This Period</CardTitle>
            <CardDescription>
              Your resource usage against your plan limits
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Assistants</span>
                  <span className="font-medium">
                    {usageDisplay.assistants.current} / {formatLimit(usageDisplay.assistants.limit)}
                  </span>
                </div>
                <Progress
                  value={
                    usageDisplay.assistants.limit === -1
                      ? 0
                      : (usageDisplay.assistants.current / usageDisplay.assistants.limit) * 100
                  }
                  className="h-2"
                />
              </div>

              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Messages Today</span>
                  <span className="font-medium">
                    {usageDisplay.messages.current} / {formatLimit(usageDisplay.messages.limit)}
                  </span>
                </div>
                <Progress
                  value={
                    usageDisplay.messages.limit === -1
                      ? 0
                      : (usageDisplay.messages.current / usageDisplay.messages.limit) * 100
                  }
                  className="h-2"
                />
              </div>

              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Active Sessions</span>
                  <span className="font-medium">
                    {usageDisplay.sessions.current} / {formatLimit(usageDisplay.sessions.limit)}
                  </span>
                </div>
                <Progress
                  value={
                    usageDisplay.sessions.limit === -1
                      ? 0
                      : (usageDisplay.sessions.current / usageDisplay.sessions.limit) * 100
                  }
                  className="h-2"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Plan Features */}
      {billingData?.plan && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Plan Features</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid md:grid-cols-2 gap-3">
              {billingData.plan.features.map((feature, index) => (
                <li key={index} className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-muted-foreground">{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Payment Methods */}
      {!billingData?.isFreeTier && (
        <div className="mb-8">
          <PaymentMethods
            fetchWithAuth={fetchWithAuth}
            onAddPaymentMethod={openCustomerPortal}
            showAddButton={true}
          />
        </div>
      )}

      {/* Invoice History */}
      {!billingData?.isFreeTier && invoices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Invoice History</CardTitle>
            <CardDescription>Your past invoices and payments</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell>{formatDate(invoice.createdAt)}</TableCell>
                    <TableCell>{formatCurrency(invoice.amountDue)}</TableCell>
                    <TableCell>
                      {invoice.status === 'paid' ? (
                        <Badge className="bg-green-100 text-green-800">Paid</Badge>
                      ) : (
                        <Badge className="bg-yellow-100 text-yellow-800">
                          {invoice.status}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {invoice.invoiceUrl && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.open(invoice.invoiceUrl!, '_blank')}
                        >
                          <ExternalLink className="h-4 w-4 mr-1" />
                          View
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

          {/* Empty state for free tier */}
          {billingData?.isFreeTier && (
            <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 border-blue-100 dark:border-blue-900">
              <CardContent className="py-8 text-center">
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  Unlock more with a paid plan
                </h3>
                <p className="text-muted-foreground mb-4">
                  Get more assistants, messages, and premium features to supercharge your workflow.
                </p>
                <Button onClick={() => router.push('/pricing')}>
                  View Plans
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
