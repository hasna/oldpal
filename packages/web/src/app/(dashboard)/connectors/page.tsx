'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plug, RefreshCcw, ShieldCheck, ShieldX } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchBar } from '@/components/shared/ListFilters';

type AutoRefreshSchedule =
  | { kind: 'cron'; cron: string; timezone?: string }
  | { kind: 'interval'; interval: number; unit?: 'minutes' | 'hours' | 'seconds' };

type AutoRefreshEntry = {
  enabled: boolean;
  schedule: AutoRefreshSchedule;
  command?: string;
  nextRunAt?: number;
  lastRunAt?: number;
  lastResult?: { ok: boolean; summary?: string; error?: string };
};

type AuthStatus = {
  authenticated: boolean;
  user?: string;
  email?: string;
  error?: string;
};

type ConnectorItem = {
  name: string;
  description?: string;
  cli?: string;
  auth?: AuthStatus | null;
  autoRefresh?: AutoRefreshEntry | null;
};

function formatSchedule(entry?: AutoRefreshEntry | null): string {
  if (!entry) return 'not configured';
  const schedule = entry.schedule;
  if (schedule.kind === 'cron') {
    return schedule.timezone ? `cron ${schedule.cron} (${schedule.timezone})` : `cron ${schedule.cron}`;
  }
  const unit = schedule.unit || 'minutes';
  return `every ${schedule.interval} ${unit}`;
}

function formatTimestamp(value?: number): string {
  if (!value) return 'n/a';
  return new Date(value).toLocaleString();
}

export default function ConnectorsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [connectors, setConnectors] = useState<ConnectorItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogConnector, setDialogConnector] = useState<ConnectorItem | null>(null);
  const [scheduleKind, setScheduleKind] = useState<'interval' | 'cron'>('interval');
  const [intervalValue, setIntervalValue] = useState('45');
  const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'hours'>('minutes');
  const [cronExpr, setCronExpr] = useState('0 * * * *');
  const [cronTimezone, setCronTimezone] = useState('UTC');
  const [refreshCommand, setRefreshCommand] = useState('auth refresh');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const loadConnectors = useCallback(async (options?: { refresh?: boolean }) => {
    setError('');
    try {
      const query = new URLSearchParams();
      query.set('includeAuth', 'true');
      if (options?.refresh) {
        query.set('refresh', 'true');
      }
      const response = await fetchWithAuth(`/api/v1/connectors?${query.toString()}`);
      const data = await response.json();
      if (data.success) {
        setConnectors(data.data.items || []);
      } else {
        setError(data.error?.message || 'Failed to load connectors');
      }
    } catch {
      setError('Failed to load connectors');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    loadConnectors();
  }, [loadConnectors]);

  const openDialog = (connector: ConnectorItem) => {
    setDialogConnector(connector);
    const entry = connector.autoRefresh;
    if (entry?.schedule?.kind === 'cron') {
      setScheduleKind('cron');
      setCronExpr(entry.schedule.cron || '0 * * * *');
      setCronTimezone(entry.schedule.timezone || 'UTC');
    } else {
      setScheduleKind('interval');
      const interval = entry?.schedule?.kind === 'interval' ? entry.schedule.interval : 45;
      const unit = entry?.schedule?.kind === 'interval' && entry.schedule.unit === 'hours' ? 'hours' : 'minutes';
      setIntervalValue(String(interval || 45));
      setIntervalUnit(unit);
    }
    setRefreshCommand(entry?.command || 'auth refresh');
    setFormError('');
    setDialogOpen(true);
  };

  const disableAutoRefresh = async (connector: ConnectorItem) => {
    try {
      const response = await fetchWithAuth('/api/v1/connectors/autorefresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disable', connector: connector.name }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to disable auto-refresh');
      }
      toast({ title: 'Auto-refresh disabled', description: `${connector.name} auto-refresh disabled.` });
      await loadConnectors();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to disable auto-refresh';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const saveAutoRefresh = async () => {
    if (!dialogConnector) return;
    setFormError('');
    if (scheduleKind === 'cron' && !cronExpr.trim()) {
      setFormError('Cron expression is required.');
      return;
    }
    const intervalNum = Number(intervalValue);
    if (scheduleKind === 'interval' && (!Number.isFinite(intervalNum) || intervalNum <= 0)) {
      setFormError('Interval must be a positive number.');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        action: 'enable',
        connector: dialogConnector.name,
        command: refreshCommand.trim() || 'auth refresh',
      };
      if (scheduleKind === 'cron') {
        payload.cron = cronExpr.trim();
        if (cronTimezone.trim()) payload.timezone = cronTimezone.trim();
      } else {
        if (intervalUnit === 'hours') {
          payload.intervalHours = intervalNum;
        } else {
          payload.intervalMinutes = intervalNum;
        }
      }

      const response = await fetchWithAuth('/api/v1/connectors/autorefresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to update auto-refresh');
      }

      toast({
        title: 'Auto-refresh updated',
        description: `${dialogConnector.name} auto-refresh is now enabled.`,
      });
      setDialogOpen(false);
      await loadConnectors();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update auto-refresh';
      setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  const filtered = connectors.filter((connector) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return connector.name.toLowerCase().includes(query) || connector.description?.toLowerCase().includes(query);
  });

  if (isLoading) {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Plug className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Connectors</h1>
          </div>
          <Button variant="outline" size="sm" disabled>
            <RefreshCcw className="h-4 w-4 mr-2 animate-spin" />
            Refresh
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-5xl mx-auto space-y-4">
            <Skeleton className="h-10 w-full" />
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Connectors</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => loadConnectors({ refresh: true })}>
          <RefreshCcw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search connectors by name or description..."
          />

          {filtered.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No connectors found.
              </CardContent>
            </Card>
          ) : (
            filtered.map((connector) => {
              const auth = connector.auth;
              const autoRefresh = connector.autoRefresh;
              const authLabel = auth?.error
                ? 'Auth error'
                : auth?.authenticated
                  ? 'Authenticated'
                  : 'Not authenticated';
              const authVariant = auth?.error
                ? 'warning'
                : auth?.authenticated
                  ? 'success'
                  : 'error';

              return (
                <Card key={connector.name}>
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">{connector.name}</CardTitle>
                      <Badge variant={authVariant}>{authLabel}</Badge>
                      {autoRefresh?.enabled ? (
                        <Badge variant="success">auto-refresh on</Badge>
                      ) : (
                        <Badge variant="outline">auto-refresh off</Badge>
                      )}
                    </div>
                    <CardDescription>{connector.description || 'No description provided.'}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex flex-col gap-1">
                      {connector.cli && <span className="text-muted-foreground">CLI: {connector.cli}</span>}
                      {auth?.email && <span className="text-muted-foreground">Account: {auth.email}</span>}
                      {auth?.user && <span className="text-muted-foreground">User: {auth.user}</span>}
                      {auth?.error && <span className="text-amber-600">{auth.error}</span>}
                    </div>

                    <div className="rounded-md border border-border bg-muted/40 p-3 space-y-1">
                      <div className="text-xs uppercase text-muted-foreground">Auto-refresh</div>
                      <div>Schedule: {formatSchedule(autoRefresh)}</div>
                      <div>Next run: {autoRefresh?.nextRunAt ? formatTimestamp(autoRefresh.nextRunAt) : 'n/a'}</div>
                      <div>Last run: {autoRefresh?.lastRunAt ? formatTimestamp(autoRefresh.lastRunAt) : 'n/a'}</div>
                      {autoRefresh?.lastResult && (
                        <div className={autoRefresh.lastResult.ok ? 'text-emerald-700' : 'text-rose-700'}>
                          {autoRefresh.lastResult.ok ? (
                            <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> {autoRefresh.lastResult.summary || 'ok'}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1"><ShieldX className="h-3 w-3" /> {autoRefresh.lastResult.error || 'error'}</span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => openDialog(connector)}>
                        {autoRefresh?.enabled ? 'Edit auto-refresh' : 'Enable auto-refresh'}
                      </Button>
                      {autoRefresh?.enabled && (
                        <Button size="sm" variant="outline" onClick={() => disableAutoRefresh(connector)}>
                          Disable
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Auto-refresh schedule</DialogTitle>
            <DialogDescription>
              Configure a global background refresh for this connector.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label>Schedule type</Label>
              <Select value={scheduleKind} onValueChange={(value) => setScheduleKind(value as 'interval' | 'cron')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="interval">Interval</SelectItem>
                  <SelectItem value="cron">Cron</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {scheduleKind === 'interval' ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Every</Label>
                  <Input
                    value={intervalValue}
                    onChange={(event) => setIntervalValue(event.target.value)}
                    placeholder="45"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Select value={intervalUnit} onValueChange={(value) => setIntervalUnit(value as 'minutes' | 'hours')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minutes">Minutes</SelectItem>
                      <SelectItem value="hours">Hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Cron expression</Label>
                <Input
                  value={cronExpr}
                  onChange={(event) => setCronExpr(event.target.value)}
                  placeholder="0 * * * *"
                />
                <Label>Timezone (optional)</Label>
                <Input
                  value={cronTimezone}
                  onChange={(event) => setCronTimezone(event.target.value)}
                  placeholder="UTC"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Refresh command</Label>
              <Input
                value={refreshCommand}
                onChange={(event) => setRefreshCommand(event.target.value)}
                placeholder="auth refresh"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveAutoRefresh} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
