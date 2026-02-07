import React from 'react';
import { describe, expect, test } from 'bun:test';
import { render } from 'ink';
import { PassThrough } from 'stream';
import { getSecurityLogger } from '@hasna/assistants-core';
import { DEFAULT_MODEL } from '@hasna/assistants-shared';

const { LogsPanel } = await import('../src/components/LogsPanel');
const { SecretsPanel } = await import('../src/components/SecretsPanel');
const { WorkspacePanel } = await import('../src/components/WorkspacePanel');
const { SkillsPanel } = await import('../src/components/SkillsPanel');
const { IdentityPanel } = await import('../src/components/IdentityPanel');
const { BudgetPanel } = await import('../src/components/BudgetPanel');
const { ProjectsPanel } = await import('../src/components/ProjectsPanel');
const { ConnectorsPanel } = await import('../src/components/ConnectorsPanel');
const { TasksPanel } = await import('../src/components/TasksPanel');
const { SchedulesPanel } = await import('../src/components/SchedulesPanel');
const { HooksPanel } = await import('../src/components/HooksPanel');
const { InboxPanel } = await import('../src/components/InboxPanel');
const { WalletPanel } = await import('../src/components/WalletPanel');
const { PlansPanel } = await import('../src/components/PlansPanel');
const { ConfigPanel } = await import('../src/components/ConfigPanel');
const { GuardrailsPanel } = await import('../src/components/GuardrailsPanel');

const stripAnsi = (text: string) => text.replace(/\x1B\[[0-9;]*m/g, '');

const createInkTestEnv = () => {
  const stdout = new PassThrough();
  let output = '';
  stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  const stdin = new PassThrough() as any;
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};
  return { stdout, stdin, getOutput: () => stripAnsi(output) };
};

describe('terminal panels', () => {
  test('LogsPanel renders empty state', async () => {
    getSecurityLogger().clear();
    const env = createInkTestEnv();
    const instance = render(<LogsPanel onCancel={() => {}} />, { stdout: env.stdout, stdin: env.stdin });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Security Logs');
    expect(frame).toContain('No security events recorded.');
    instance.unmount();
  });

  test('LogsPanel renders list entry when events exist', async () => {
    const logger = getSecurityLogger();
    logger.clear();
    logger.log({
      eventType: 'blocked_command',
      severity: 'high',
      sessionId: 's1',
      details: { reason: 'Blocked command pattern: rm -rf /', command: 'rm -rf /', tool: 'bash' },
    });
    const env = createInkTestEnv();
    const instance = render(<LogsPanel onCancel={() => {}} />, { stdout: env.stdout, stdin: env.stdin });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Security Logs');
    expect(frame).toContain('blocked_command');
    logger.clear();
    instance.unmount();
  });

  test('SecretsPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <SecretsPanel
        secrets={[]}
        onGet={async () => ''}
        onDelete={async () => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Secrets');
    expect(frame).toContain('No secrets stored.');
    instance.unmount();
  });

  test('WorkspacePanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <WorkspacePanel
        workspaces={[]}
        onArchive={async () => {}}
        onDelete={async () => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Workspaces');
    expect(frame).toContain('No workspaces found.');
    instance.unmount();
  });

  test('ProjectsPanel renders empty state and new project option', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <ProjectsPanel
        projects={[]}
        onSelect={() => {}}
        onCreate={async () => {}}
        onDelete={async () => {}}
        onViewPlans={() => {}}
        onCancel={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Projects');
    expect(frame).toContain('No projects yet. Press n to create one.');
    expect(frame).toContain('New project');
    instance.unmount();
  });

  test('ConnectorsPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <ConnectorsPanel
        connectors={[]}
        onCheckAuth={async () => ({ authenticated: false })}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Connectors');
    expect(frame).toContain('No connectors found.');
    instance.unmount();
  });

  test('TasksPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <TasksPanel
        tasks={[]}
        paused={false}
        onAdd={async () => {}}
        onDelete={async () => {}}
        onRun={async () => {}}
        onClearPending={async () => {}}
        onClearCompleted={async () => {}}
        onTogglePause={async () => {}}
        onChangePriority={async () => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Tasks');
    expect(frame).toContain('No tasks yet. Press n to add one.');
    instance.unmount();
  });

  test('SchedulesPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <SchedulesPanel
        schedules={[]}
        sessionId="s1"
        onPause={async () => {}}
        onResume={async () => {}}
        onDelete={async () => {}}
        onRun={async () => {}}
        onCreate={async () => {}}
        onRefresh={async () => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Schedules');
    expect(frame).toContain('No schedules. Press n to create one.');
    instance.unmount();
  });

  test('HooksPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <HooksPanel
        hooks={{} as any}
        nativeHooks={[]}
        onToggle={() => {}}
        onToggleNative={() => {}}
        onDelete={async () => {}}
        onAdd={async () => {}}
        onCancel={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Hooks');
    expect(frame).toContain('No hooks configured.');
    instance.unmount();
  });

  test('InboxPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <InboxPanel
        emails={[]}
        onRead={async () => ({}) as any}
        onDelete={async () => {}}
        onFetch={async () => 0}
        onMarkRead={async () => {}}
        onMarkUnread={async () => {}}
        onReply={() => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Inbox');
    expect(frame).toContain('No emails in inbox.');
    instance.unmount();
  });

  test('WalletPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <WalletPanel
        cards={[]}
        onGet={async () => ({ id: 'c1', name: 'Test', last4: '0000' })}
        onRemove={async () => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Wallet');
    expect(frame).toContain('No cards stored in wallet.');
    instance.unmount();
  });

  test('PlansPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <PlansPanel
        project={{ id: 'p1', name: 'Demo', plans: [], context: [], description: '', createdAt: 0, updatedAt: 0 } as any}
        onCreatePlan={async () => {}}
        onDeletePlan={async () => {}}
        onAddStep={async () => {}}
        onUpdateStep={async () => {}}
        onRemoveStep={async () => {}}
        onBack={() => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Plans for "Demo"');
    expect(frame).toContain('No plans yet. Press n to create one.');
    instance.unmount();
  });

  test('ConfigPanel renders overview', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <ConfigPanel
        config={{ llm: { model: DEFAULT_MODEL, maxTokens: 8192 } } as any}
        userConfig={null}
        projectConfig={null}
        localConfig={null}
        onSave={async () => {}}
        onCancel={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Configuration');
    expect(frame).toContain('Configuration Overview');
    instance.unmount();
  });

  test('GuardrailsPanel renders overview', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <GuardrailsPanel
        config={{ enabled: false, defaultAction: 'allow' } as any}
        policies={[]}
        onToggleEnabled={() => {}}
        onTogglePolicy={() => {}}
        onSetPreset={() => {}}
        onAddPolicy={() => {}}
        onRemovePolicy={() => {}}
        onUpdatePolicy={() => {}}
        onCancel={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Guardrails');
    expect(frame).toContain('Disabled');
    instance.unmount();
  });

  test('SkillsPanel renders empty list state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <SkillsPanel
        skills={[]}
        onExecute={() => {}}
        onCreate={async () => ({ success: true })}
        onDelete={async () => {}}
        onRefresh={async () => []}
        onEnsureContent={async () => null}
        onClose={() => {}}
        cwd="/tmp"
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Skills');
    expect(frame).toContain('No skills loaded. Press n to create one.');
    instance.unmount();
  });

  test('SkillsPanel renders grouped skills', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <SkillsPanel
        skills={[
          { name: 'alpha', description: 'Project skill', filePath: '/tmp/.assistants/skills/alpha.md' } as any,
          { name: 'beta', description: 'Global skill', filePath: '/Users/me/.assistants/shared/skills/beta.md' } as any,
        ]}
        onExecute={() => {}}
        onCreate={async () => ({ success: true })}
        onDelete={async () => {}}
        onRefresh={async () => []}
        onEnsureContent={async () => null}
        onClose={() => {}}
        cwd="/tmp"
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Project Skills');
    expect(frame).toContain('Global Skills');
    expect(frame).toContain('alpha');
    expect(frame).toContain('beta');
    instance.unmount();
  });

  test('IdentityPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <IdentityPanel
        identities={[]}
        templates={[]}
        onSwitch={async () => {}}
        onCreate={async () => {}}
        onCreateFromTemplate={async () => {}}
        onUpdate={async () => {}}
        onSetDefault={async () => {}}
        onDelete={async () => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Identities');
    expect(frame).toContain('No identities found.');
    instance.unmount();
  });

  test('IdentityPanel renders identity list', async () => {
    const env = createInkTestEnv();
    const identity = {
      id: 'id-1',
      name: 'primary',
      isDefault: true,
      profile: {
        displayName: 'Ada Lovelace',
        title: 'Engineer',
        company: 'Analytical Engines',
        timezone: 'UTC',
        locale: 'en-US',
      },
      contacts: {
        emails: [{ value: 'ada@example.com', isPrimary: true }],
        phones: [],
        addresses: [],
        virtualAddresses: [],
      },
      preferences: {
        language: 'en',
        dateFormat: 'YYYY-MM-DD',
        communicationStyle: 'professional',
        responseLength: 'balanced',
        custom: {},
      },
      context: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const instance = render(
      <IdentityPanel
        identities={[identity as any]}
        activeIdentityId="id-1"
        templates={[]}
        onSwitch={async () => {}}
        onCreate={async () => {}}
        onCreateFromTemplate={async () => {}}
        onUpdate={async () => {}}
        onSetDefault={async () => {}}
        onDelete={async () => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Identities');
    expect(frame).toContain('Ada Lovelace');
    instance.unmount();
  });

  test('BudgetPanel renders overview with usage', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <BudgetPanel
        config={{
          enabled: true,
          onExceeded: 'warn',
          session: {
            maxTotalTokens: 1000,
            maxLlmCalls: 10,
            maxToolCalls: 5,
            maxDurationMs: 60_000,
          },
        }}
        sessionStatus={{
          scope: 'session',
          limits: {
            maxTotalTokens: 1000,
            maxLlmCalls: 10,
            maxToolCalls: 5,
            maxDurationMs: 60_000,
          },
          usage: {
            inputTokens: 4,
            outputTokens: 6,
            totalTokens: 10,
            llmCalls: 1,
            toolCalls: 2,
            durationMs: 5_000,
          },
          checks: {},
          overallExceeded: false,
          warningsCount: 0,
        }}
        swarmStatus={{
          scope: 'swarm',
          limits: {},
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            llmCalls: 0,
            toolCalls: 0,
            durationMs: 0,
          },
          checks: {},
          overallExceeded: false,
          warningsCount: 0,
        }}
        onToggleEnabled={() => {}}
        onReset={() => {}}
        onSetLimits={() => {}}
        onSetOnExceeded={() => {}}
        onCancel={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Budget');
    expect(frame).toContain('Enforcing');
    expect(frame).toContain('Within limits');
    expect(frame).toContain('Session Usage');
    instance.unmount();
  });
});
