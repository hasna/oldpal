'use client';

import Link from 'next/link';
import { Mail, Github, MessageSquare, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/50 to-background py-16 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Back link */}
        <Link
          href="/pricing"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Pricing
        </Link>

        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4">Contact Us</h1>
          <p className="text-lg text-muted-foreground">
            Have questions? We&apos;re here to help. Reach out through any of the channels below.
          </p>
        </div>

        {/* Contact Options */}
        <div className="grid gap-6">
          {/* Email */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                  <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                Email Support
              </CardTitle>
              <CardDescription>
                Best for detailed questions and business inquiries
              </CardDescription>
            </CardHeader>
            <CardContent>
              <a
                href="mailto:support@assistants.dev"
                className="text-blue-600 hover:underline text-lg font-medium"
              >
                support@assistants.dev
              </a>
              <p className="text-sm text-muted-foreground mt-2">
                We typically respond within 24-48 hours
              </p>
            </CardContent>
          </Card>

          {/* GitHub Issues */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-lg">
                  <Github className="h-5 w-5 text-foreground" />
                </div>
                GitHub Issues
              </CardTitle>
              <CardDescription>
                Report bugs, request features, or browse discussions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" asChild>
                <a
                  href="https://github.com/hasna/assistants/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2"
                >
                  <Github className="h-4 w-4" />
                  Open an Issue
                </a>
              </Button>
              <p className="text-sm text-muted-foreground mt-3">
                Great for technical issues and feature requests
              </p>
            </CardContent>
          </Card>

          {/* Enterprise */}
          <Card className="border-2 border-blue-100 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <div className="p-2 bg-blue-200 dark:bg-blue-800 rounded-lg">
                  <MessageSquare className="h-5 w-5 text-blue-700 dark:text-blue-300" />
                </div>
                Enterprise Inquiries
              </CardTitle>
              <CardDescription>
                Custom solutions for your organization
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                Need a custom plan, dedicated support, or special integrations? Let&apos;s talk about
                how we can help your team.
              </p>
              <Button asChild>
                <a href="mailto:enterprise@assistants.dev">
                  Contact Enterprise Sales
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* FAQ Link */}
        <div className="mt-12 text-center">
          <p className="text-muted-foreground">
            Looking for quick answers?{' '}
            <Link href="/pricing" className="text-blue-600 hover:underline">
              Check our pricing FAQ
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
