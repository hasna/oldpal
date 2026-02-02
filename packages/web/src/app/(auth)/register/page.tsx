'use client';

import { RegisterForm } from '@/components/auth/register-form';
import { OAuthButtons } from '@/components/auth/oauth-buttons';
import { Separator } from '@/components/ui/Separator';

export default function RegisterPage() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-slate-100">Create an account</h2>
        <p className="mt-1 text-sm text-slate-400">Get started with Assistants</p>
      </div>

      <OAuthButtons />

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <Separator />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-slate-900/50 px-2 text-slate-500">Or continue with</span>
        </div>
      </div>

      <RegisterForm />
    </div>
  );
}
