import Link from 'next/link';

export default function SettingsPage() {
  return (
    <div className="min-h-screen px-8 py-10">
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/70 p-8 shadow-glow">
        <h2 className="font-display text-2xl">Settings</h2>
        <p className="mt-2 text-sm text-slate-400">
          Configure models, connectors, and voice settings here.
        </p>
        <div className="mt-6 space-y-3 text-sm text-slate-300">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
            Settings UI coming soon.
          </div>
        </div>
        <Link href="/" className="mt-6 inline-flex text-sm text-sky-300 hover:text-sky-200">
          Back to chat
        </Link>
      </div>
    </div>
  );
}
