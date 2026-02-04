'use client';

import { useState, useEffect, useCallback } from 'react';
import { CreditCard, Plus, Trash2, Star, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
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
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';

interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

interface PaymentMethodsProps {
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  onAddPaymentMethod?: () => void;
  showAddButton?: boolean;
}

const brandIcons: Record<string, string> = {
  visa: '💳 Visa',
  mastercard: '💳 Mastercard',
  amex: '💳 Amex',
  discover: '💳 Discover',
  jcb: '💳 JCB',
  diners: '💳 Diners',
  unionpay: '💳 UnionPay',
};

export function PaymentMethods({
  fetchWithAuth,
  onAddPaymentMethod,
  showAddButton = true,
}: PaymentMethodsProps) {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PaymentMethod | null>(null);

  const loadPaymentMethods = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/api/v1/billing/payment-methods');
      const data = await response.json();

      if (data.success) {
        setPaymentMethods(data.data.paymentMethods);
      } else {
        setError(data.error?.message || 'Failed to load payment methods');
      }
    } catch {
      setError('Failed to load payment methods');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    loadPaymentMethods();
  }, [loadPaymentMethods]);

  const handleSetDefault = async (paymentMethodId: string) => {
    setSettingDefaultId(paymentMethodId);
    try {
      const response = await fetchWithAuth(`/api/v1/billing/payment-methods/${paymentMethodId}`, {
        method: 'PATCH',
      });
      const data = await response.json();

      if (data.success) {
        setPaymentMethods((prev) =>
          prev.map((pm) => ({
            ...pm,
            isDefault: pm.id === paymentMethodId,
          }))
        );
      } else {
        setError(data.error?.message || 'Failed to set default payment method');
      }
    } catch {
      setError('Failed to set default payment method');
    } finally {
      setSettingDefaultId(null);
    }
  };

  const handleDelete = async (paymentMethod: PaymentMethod) => {
    setDeletingId(paymentMethod.id);
    try {
      const response = await fetchWithAuth(`/api/v1/billing/payment-methods/${paymentMethod.id}`, {
        method: 'DELETE',
      });
      const data = await response.json();

      if (data.success) {
        setPaymentMethods((prev) => prev.filter((pm) => pm.id !== paymentMethod.id));
      } else {
        setError(data.error?.message || 'Failed to remove payment method');
      }
    } catch {
      setError('Failed to remove payment method');
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  };

  const getBrandDisplay = (brand: string) => {
    return brandIcons[brand.toLowerCase()] || `💳 ${brand}`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-60" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Payment Methods
        </CardTitle>
        <CardDescription>
          Manage your payment methods for subscriptions
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {paymentMethods.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No payment methods on file.</p>
            {showAddButton && onAddPaymentMethod && (
              <Button onClick={onAddPaymentMethod} className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Add Payment Method
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {paymentMethods.map((pm) => (
              <div
                key={pm.id}
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="text-2xl">
                    {getBrandDisplay(pm.brand).split(' ')[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1)} •••• {pm.last4}
                      </span>
                      {pm.isDefault && (
                        <Badge variant="secondary" className="text-xs">
                          <Star className="h-3 w-3 mr-1" />
                          Default
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Expires {pm.expMonth.toString().padStart(2, '0')}/{pm.expYear}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!pm.isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSetDefault(pm.id)}
                      disabled={settingDefaultId === pm.id}
                    >
                      {settingDefaultId === pm.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Set Default'
                      )}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(pm)}
                    disabled={deletingId === pm.id}
                    className="text-destructive hover:text-destructive/80"
                  >
                    {deletingId === pm.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}

            {showAddButton && onAddPaymentMethod && (
              <Button variant="outline" onClick={onAddPaymentMethod} className="w-full mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Add Payment Method
              </Button>
            )}
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove payment method?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove the card ending in {confirmDelete?.last4}?
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => confirmDelete && handleDelete(confirmDelete)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
