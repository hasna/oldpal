'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/hooks/use-auth';

interface Plan {
  id: string;
  name: string;
  displayName: string;
  stripePriceId: string | null;
  priceMonthly: number;
  maxAssistants: number;
  maxMessagesPerDay: number;
  maxSessions: number;
  features: string[];
}

export default function PricingPage() {
  const router = useRouter();
  const { user, fetchWithAuth, isLoading: authLoading } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  useEffect(() => {
    async function loadPlans() {
      try {
        const response = await fetch('/api/v1/billing/plans');
        const data = await response.json();
        if (data.success) {
          setPlans(data.data);
        }
      } catch (error) {
        console.error('Failed to load plans:', error);
      } finally {
        setIsLoading(false);
      }
    }
    loadPlans();
  }, []);

  const handleSelectPlan = async (plan: Plan) => {
    if (!user) {
      // Redirect to login with return URL
      router.push('/login?returnUrl=/pricing');
      return;
    }

    if (!plan.stripePriceId) {
      // Free plan - redirect to dashboard
      router.push('/chat');
      return;
    }

    setCheckoutLoading(plan.id);
    try {
      const response = await fetchWithAuth('/api/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan.id }),
      });
      const data = await response.json();
      if (data.success && data.data.checkoutUrl) {
        window.location.href = data.data.checkoutUrl;
      }
    } catch (error) {
      console.error('Checkout failed:', error);
    } finally {
      setCheckoutLoading(null);
    }
  };

  const formatLimit = (value: number) => {
    if (value === -1) return 'Unlimited';
    return value.toLocaleString();
  };

  if (isLoading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/50 to-background py-16 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Simple, transparent pricing
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Choose the plan that best fits your needs. Start free and scale as you grow.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-8">
          {plans.map((plan) => {
            const isPopular = plan.name === 'pro';
            const isFree = !plan.stripePriceId;

            return (
              <Card
                key={plan.id}
                className={`relative flex flex-col ${
                  isPopular
                    ? 'border-2 border-blue-500 shadow-lg scale-105'
                    : 'border border-border'
                }`}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-blue-500 text-white px-3 py-1">
                      Most Popular
                    </Badge>
                  </div>
                )}

                <CardHeader className="text-center pb-2">
                  <CardTitle className="text-2xl">{plan.displayName}</CardTitle>
                  <CardDescription>
                    {plan.name === 'free' && 'Perfect for getting started'}
                    {plan.name === 'pro' && 'For professionals and small teams'}
                    {plan.name === 'enterprise' && 'For large organizations'}
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex-1">
                  {/* Price */}
                  <div className="text-center mb-6">
                    <span className="text-4xl font-bold text-foreground">
                      ${plan.priceMonthly / 100}
                    </span>
                    <span className="text-muted-foreground">/month</span>
                  </div>

                  {/* Limits */}
                  <div className="space-y-3 mb-6 pb-6 border-b border-border">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Assistants</span>
                      <span className="font-medium">{formatLimit(plan.maxAssistants)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Messages/day</span>
                      <span className="font-medium">{formatLimit(plan.maxMessagesPerDay)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Sessions</span>
                      <span className="font-medium">{formatLimit(plan.maxSessions)}</span>
                    </div>
                  </div>

                  {/* Features */}
                  <ul className="space-y-3">
                    {plan.features.map((feature, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <Check className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>

                <CardFooter>
                  <Button
                    className="w-full"
                    variant={isPopular ? 'default' : 'outline'}
                    onClick={() => handleSelectPlan(plan)}
                    disabled={checkoutLoading !== null}
                  >
                    {checkoutLoading === plan.id ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : isFree ? (
                      'Get Started Free'
                    ) : (
                      'Subscribe'
                    )}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>

        {/* FAQ or additional info */}
        <div className="mt-16 text-center">
          <p className="text-muted-foreground">
            All plans include a 14-day money-back guarantee.{' '}
            <a href="/contact" className="text-blue-500 hover:underline">
              Contact us
            </a>{' '}
            for custom enterprise solutions.
          </p>
        </div>
      </div>
    </div>
  );
}
