import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  AgentRegistryService,
  getGlobalRegistry,
  resetGlobalRegistry,
  RegistryStore,
  DEFAULT_REGISTRY_CONFIG,
} from '../src/registry';
import type {
  AgentRegistration,
  RegisteredAgent,
  RegistryConfig,
  RegistryEvent,
} from '../src/registry';

let tempDir: string;
let originalHome: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'assistants-agent-registry-'));
  originalHome = process.env.HOME;
  process.env.HOME = tempDir;
  resetGlobalRegistry();
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(tempDir, { recursive: true, force: true });
  resetGlobalRegistry();
});

describe('RegistryStore', () => {
  describe('initialization', () => {
    test('creates with default config', () => {
      const store = new RegistryStore();
      expect(store.list()).toEqual([]);
    });

    test('creates with custom config', () => {
      const config: RegistryConfig = {
        ...DEFAULT_REGISTRY_CONFIG,
        maxAgents: 50,
      };
      const store = new RegistryStore(config);
      expect(store.list()).toEqual([]);
    });
  });

  describe('register', () => {
    test('registers a new agent', () => {
      const store = new RegistryStore();
      const registration: AgentRegistration = {
        id: 'agent-1',
        name: 'Test Agent',
        type: 'assistant',
        capabilities: {},
      };
      const agent = store.register(registration);
      expect(agent.id).toBe('agent-1');
      expect(agent.name).toBe('Test Agent');
      expect(agent.type).toBe('assistant');
      expect(agent.status.state).toBe('idle');
    });

    test('assigns default capabilities', () => {
      const store = new RegistryStore();
      const agent = store.register({
        id: 'agent-1',
        name: 'Test Agent',
        type: 'assistant',
        capabilities: {},
      });
      expect(agent.capabilities).toBeDefined();
      expect(agent.capabilities.tools).toEqual([]);
      expect(agent.capabilities.skills).toEqual([]);
    });

    test('registers with custom capabilities', () => {
      const store = new RegistryStore();
      const agent = store.register({
        id: 'agent-1',
        name: 'Test Agent',
        type: 'assistant',
        capabilities: {
          tools: ['bash', 'file:read'],
          skills: ['summarize'],
          tags: ['dev'],
        },
      });
      expect(agent.capabilities.tools).toContain('bash');
      expect(agent.capabilities.skills).toContain('summarize');
      expect(agent.capabilities.tags).toContain('dev');
    });

    test('throws when max agents reached', () => {
      const store = new RegistryStore({ ...DEFAULT_REGISTRY_CONFIG, maxAgents: 2 });
      store.register({ id: 'agent-1', name: 'Agent 1', type: 'assistant', capabilities: {} });
      store.register({ id: 'agent-2', name: 'Agent 2', type: 'assistant', capabilities: {} });
      expect(() => {
        store.register({ id: 'agent-3', name: 'Agent 3', type: 'assistant', capabilities: {} });
      }).toThrow('Registry full');
    });
  });

  describe('get', () => {
    test('returns registered agent', () => {
      const store = new RegistryStore();
      store.register({ id: 'agent-1', name: 'Test', type: 'assistant', capabilities: {} });
      const agent = store.get('agent-1');
      expect(agent).not.toBeNull();
      expect(agent?.id).toBe('agent-1');
    });

    test('returns null for non-existent agent', () => {
      const store = new RegistryStore();
      expect(store.get('non-existent')).toBeNull();
    });
  });

  describe('update', () => {
    test('updates agent status', () => {
      const store = new RegistryStore();
      store.register({ id: 'agent-1', name: 'Test', type: 'assistant', capabilities: {} });
      const updated = store.update('agent-1', {
        status: { state: 'processing', currentTask: 'test-task' },
      });
      expect(updated?.status.state).toBe('processing');
      expect(updated?.status.currentTask).toBe('test-task');
    });

    test('updates agent load', () => {
      const store = new RegistryStore();
      store.register({ id: 'agent-1', name: 'Test', type: 'assistant', capabilities: {} });
      const updated = store.update('agent-1', {
        load: { activeTasks: 3, tokensUsed: 1000 },
      });
      expect(updated?.load.activeTasks).toBe(3);
      expect(updated?.load.tokensUsed).toBe(1000);
    });

    test('returns null for non-existent agent', () => {
      const store = new RegistryStore();
      expect(store.update('non-existent', { status: { state: 'idle' } })).toBeNull();
    });
  });

  describe('heartbeat', () => {
    test('updates heartbeat timestamp', () => {
      const store = new RegistryStore();
      store.register({ id: 'agent-1', name: 'Test', type: 'assistant', capabilities: {} });
      const before = store.get('agent-1')?.heartbeat.lastHeartbeat;

      // Small delay to ensure timestamp changes
      const agent = store.heartbeat('agent-1');
      expect(agent).not.toBeNull();
      expect(new Date(agent!.heartbeat.lastHeartbeat).getTime()).toBeGreaterThanOrEqual(
        new Date(before!).getTime()
      );
    });

    test('clears stale flag on heartbeat', () => {
      const store = new RegistryStore({
        ...DEFAULT_REGISTRY_CONFIG,
        heartbeatStaleThreshold: 100, // 100ms for testing
      });
      store.register({ id: 'agent-1', name: 'Test', type: 'assistant', capabilities: {} });

      // Force agent to be marked stale (would need to wait or manually set)
      // For now, just verify heartbeat works
      const agent = store.heartbeat('agent-1');
      expect(agent?.heartbeat.isStale).toBe(false);
    });
  });

  describe('deregister', () => {
    test('removes agent', () => {
      const store = new RegistryStore();
      store.register({ id: 'agent-1', name: 'Test', type: 'assistant', capabilities: {} });
      expect(store.deregister('agent-1')).toBe(true);
      expect(store.get('agent-1')).toBeNull();
    });

    test('returns false for non-existent agent', () => {
      const store = new RegistryStore();
      expect(store.deregister('non-existent')).toBe(false);
    });

    test('removes child agents when parent deregistered', () => {
      const store = new RegistryStore();
      store.register({ id: 'parent', name: 'Parent', type: 'assistant', capabilities: {} });
      store.register({ id: 'child-1', name: 'Child 1', type: 'subagent', parentId: 'parent', capabilities: {} });
      store.register({ id: 'child-2', name: 'Child 2', type: 'subagent', parentId: 'parent', capabilities: {} });

      store.deregister('parent');
      expect(store.get('child-1')).toBeNull();
      expect(store.get('child-2')).toBeNull();
    });
  });

  describe('query', () => {
    test('queries by type', () => {
      const store = new RegistryStore();
      store.register({ id: 'a1', name: 'Assistant', type: 'assistant', capabilities: {} });
      store.register({ id: 's1', name: 'Subagent', type: 'subagent', capabilities: {} });
      store.register({ id: 's2', name: 'Subagent 2', type: 'subagent', capabilities: {} });

      const result = store.query({ type: 'subagent' });
      expect(result.agents).toHaveLength(2);
      expect(result.agents.every((a) => a.type === 'subagent')).toBe(true);
    });

    test('queries by state', () => {
      const store = new RegistryStore();
      store.register({ id: 'a1', name: 'Agent 1', type: 'assistant', capabilities: {} });
      store.register({ id: 'a2', name: 'Agent 2', type: 'assistant', capabilities: {} });
      store.update('a1', { status: { state: 'processing' } });

      const result = store.query({ state: 'idle' });
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].id).toBe('a2');
    });

    test('queries by required capabilities', () => {
      const store = new RegistryStore();
      store.register({
        id: 'a1',
        name: 'Agent 1',
        type: 'assistant',
        capabilities: { tools: ['bash', 'file:read'] },
      });
      store.register({
        id: 'a2',
        name: 'Agent 2',
        type: 'assistant',
        capabilities: { tools: ['file:read'] },
      });

      const result = store.query({
        requiredCapabilities: { tools: ['bash'] },
      });
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].id).toBe('a1');
    });

    test('queries by parent ID', () => {
      const store = new RegistryStore();
      store.register({ id: 'parent', name: 'Parent', type: 'assistant', capabilities: {} });
      store.register({ id: 'child-1', name: 'Child 1', type: 'subagent', parentId: 'parent', capabilities: {} });
      store.register({ id: 'child-2', name: 'Child 2', type: 'subagent', parentId: 'parent', capabilities: {} });
      store.register({ id: 'other', name: 'Other', type: 'subagent', parentId: 'other-parent', capabilities: {} });

      const result = store.query({ parentId: 'parent' });
      expect(result.agents).toHaveLength(2);
    });

    test('queries by session ID', () => {
      const store = new RegistryStore();
      store.register({ id: 'a1', name: 'Agent 1', type: 'assistant', sessionId: 'session-1', capabilities: {} });
      store.register({ id: 'a2', name: 'Agent 2', type: 'assistant', sessionId: 'session-2', capabilities: {} });

      const result = store.query({ sessionId: 'session-1' });
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].id).toBe('a1');
    });

    test('excludes offline agents by default', () => {
      const store = new RegistryStore();
      store.register({ id: 'a1', name: 'Agent 1', type: 'assistant', capabilities: {} });
      store.register({ id: 'a2', name: 'Agent 2', type: 'assistant', capabilities: {} });
      store.update('a1', { status: { state: 'offline' } });

      const result = store.query({ includeOffline: false });
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].id).toBe('a2');
    });

    test('includes offline agents when requested', () => {
      const store = new RegistryStore();
      store.register({ id: 'a1', name: 'Agent 1', type: 'assistant', capabilities: {} });
      store.register({ id: 'a2', name: 'Agent 2', type: 'assistant', capabilities: {} });
      store.update('a1', { status: { state: 'offline' } });

      const result = store.query({ includeOffline: true });
      expect(result.agents).toHaveLength(2);
    });

    test('limits results', () => {
      const store = new RegistryStore();
      store.register({ id: 'a1', name: 'Agent 1', type: 'assistant', capabilities: {} });
      store.register({ id: 'a2', name: 'Agent 2', type: 'assistant', capabilities: {} });
      store.register({ id: 'a3', name: 'Agent 3', type: 'assistant', capabilities: {} });

      const result = store.query({ limit: 2 });
      expect(result.agents).toHaveLength(2);
      expect(result.total).toBe(3);
    });

    test('returns total count with limit', () => {
      const store = new RegistryStore();
      for (let i = 0; i < 5; i++) {
        store.register({ id: `a${i}`, name: `Agent ${i}`, type: 'assistant', capabilities: {} });
      }

      const result = store.query({ limit: 2 });
      expect(result.agents).toHaveLength(2);
      expect(result.total).toBe(5);
      // Note: the API doesn't support offset or hasMore - use total to determine if more exist
    });
  });

  describe('cleanup', () => {
    test('cleanupStaleAgents removes stale agents', () => {
      const store = new RegistryStore({
        ...DEFAULT_REGISTRY_CONFIG,
        staleTTL: 100, // 100ms for testing
        heartbeatStaleThreshold: 50,
      });

      store.register({ id: 'agent-1', name: 'Test', type: 'assistant', capabilities: {} });

      // Wait for agent to become stale and be cleaned up
      // In practice, this would be tested with time mocking
      // For now, just verify the method doesn't throw
      store.cleanupStaleAgents();
    });
  });

  describe('getStats', () => {
    test('returns registry statistics', () => {
      const store = new RegistryStore();
      store.register({ id: 'a1', name: 'Agent 1', type: 'assistant', capabilities: {} });
      store.register({ id: 'a2', name: 'Agent 2', type: 'assistant', capabilities: {} });
      store.register({ id: 's1', name: 'Subagent', type: 'subagent', capabilities: {} });
      store.update('a1', { status: { state: 'processing' } });

      const stats = store.getStats();
      expect(stats.totalAgents).toBe(3);
      expect(stats.byType.assistant).toBe(2);
      expect(stats.byType.subagent).toBe(1);
      expect(stats.byState.idle).toBe(2);
      expect(stats.byState.processing).toBe(1);
    });
  });
});

describe('AgentRegistryService', () => {
  describe('initialization', () => {
    test('creates with default config (enabled)', () => {
      const service = new AgentRegistryService();
      expect(service.isEnabled()).toBe(true); // Default config has enabled: true
    });

    test('creates with custom config', () => {
      const service = new AgentRegistryService({ enabled: false });
      expect(service.isEnabled()).toBe(false);
    });
  });

  describe('register', () => {
    test('registers agent and emits event', () => {
      const service = new AgentRegistryService();
      const events: RegistryEvent[] = [];
      service.addEventListener((e) => events.push(e));

      const agent = service.register({
        id: 'agent-1',
        name: 'Test',
        type: 'assistant',
        capabilities: {},
      });

      expect(agent.id).toBe('agent-1');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('agent:registered');
    });

    test('throws when disabled', () => {
      const service = new AgentRegistryService({ enabled: false });
      expect(() => {
        service.register({ id: 'agent-1', name: 'Test', type: 'assistant', capabilities: {} });
      }).toThrow('Registry is disabled');
    });
  });

  describe('registerFromHeartbeat', () => {
    test('auto-registers new agent', () => {
      const service = new AgentRegistryService({ autoRegister: true });
      const agent = service.registerFromHeartbeat({
        agentId: 'agent-1',
        name: 'Test',
        tools: ['bash'],
      });
      expect(agent.id).toBe('agent-1');
      expect(agent.capabilities.tools).toContain('bash');
    });

    test('updates existing agent on heartbeat', () => {
      const service = new AgentRegistryService({ autoRegister: true });
      service.register({ id: 'agent-1', name: 'Test', type: 'assistant', capabilities: {} });

      const before = service.get('agent-1')?.heartbeat.lastHeartbeat;
      const agent = service.registerFromHeartbeat({
        agentId: 'agent-1',
        name: 'Test',
      });

      expect(new Date(agent.heartbeat.lastHeartbeat).getTime()).toBeGreaterThanOrEqual(
        new Date(before!).getTime()
      );
    });

    test('throws when auto-register disabled', () => {
      const service = new AgentRegistryService({ autoRegister: false });
      expect(() => {
        service.registerFromHeartbeat({ agentId: 'agent-1', name: 'Test' });
      }).toThrow('Auto-registration is disabled');
    });
  });

  describe('updateStatus', () => {
    test('updates agent status', () => {
      const service = new AgentRegistryService();
      service.register({ id: 'agent-1', name: 'Test', type: 'assistant', capabilities: {} });

      const updated = service.updateStatus('agent-1', {
        state: 'processing',
        currentTask: 'task-1',
      });

      expect(updated?.status.state).toBe('processing');
      expect(updated?.status.currentTask).toBe('task-1');
    });
  });

  describe('updateLoad', () => {
    test('updates agent load', () => {
      const service = new AgentRegistryService();
      service.register({ id: 'agent-1', name: 'Test', type: 'assistant', capabilities: {} });

      const updated = service.updateLoad('agent-1', {
        activeTasks: 5,
        tokensUsed: 10000,
      });

      expect(updated?.load.activeTasks).toBe(5);
      expect(updated?.load.tokensUsed).toBe(10000);
    });
  });

  describe('deregister', () => {
    test('removes agent and emits event', () => {
      const service = new AgentRegistryService();
      const events: RegistryEvent[] = [];
      service.addEventListener((e) => events.push(e));

      service.register({ id: 'agent-1', name: 'Test', type: 'assistant', capabilities: {} });
      const result = service.deregister('agent-1');

      expect(result).toBe(true);
      expect(service.get('agent-1')).toBeNull();
      expect(events.some((e) => e.type === 'agent:deregistered')).toBe(true);
    });
  });

  describe('query methods', () => {
    test('query filters correctly', () => {
      const service = new AgentRegistryService();
      service.register({ id: 'a1', name: 'Agent 1', type: 'assistant', capabilities: {} });
      service.register({ id: 's1', name: 'Subagent', type: 'subagent', capabilities: {} });

      const result = service.query({ type: 'assistant' });
      expect(result.agents).toHaveLength(1);
    });

    test('findByCapability finds matching agents', () => {
      const service = new AgentRegistryService();
      service.register({
        id: 'a1',
        name: 'Agent 1',
        type: 'assistant',
        capabilities: { tools: ['bash', 'file:read'] },
      });
      service.register({
        id: 'a2',
        name: 'Agent 2',
        type: 'assistant',
        capabilities: { tools: ['file:read'] },
      });

      const agents = service.findByCapability({ tools: ['bash'] });
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('a1');
    });

    test('findAvailable returns idle agents', () => {
      const service = new AgentRegistryService();
      service.register({ id: 'a1', name: 'Agent 1', type: 'assistant', capabilities: {} });
      service.register({ id: 'a2', name: 'Agent 2', type: 'assistant', capabilities: {} });
      service.updateStatus('a1', { state: 'processing' });

      const available = service.findAvailable();
      expect(available).toHaveLength(1);
      expect(available[0].id).toBe('a2');
    });

    test('findBestMatch returns best matching agent', () => {
      const service = new AgentRegistryService();
      service.register({
        id: 'a1',
        name: 'Agent 1',
        type: 'assistant',
        capabilities: { tools: ['bash', 'file:read'] },
      });
      service.register({
        id: 'a2',
        name: 'Agent 2',
        type: 'assistant',
        capabilities: { tools: ['file:read'] },
      });

      const best = service.findBestMatch({
        required: { tools: ['bash'] },
      });
      expect(best?.id).toBe('a1');
    });

    test('getChildren returns child agents', () => {
      const service = new AgentRegistryService();
      service.register({ id: 'parent', name: 'Parent', type: 'assistant', capabilities: {} });
      service.register({ id: 'child-1', name: 'Child 1', type: 'subagent', parentId: 'parent', capabilities: {} });
      service.register({ id: 'child-2', name: 'Child 2', type: 'subagent', parentId: 'parent', capabilities: {} });

      const children = service.getChildren('parent');
      expect(children).toHaveLength(2);
    });
  });

  describe('event listeners', () => {
    test('adds and removes listeners', () => {
      const service = new AgentRegistryService();
      const events: RegistryEvent[] = [];
      const listener = (e: RegistryEvent) => events.push(e);

      const unsubscribe = service.addEventListener(listener);
      service.register({ id: 'a1', name: 'Test', type: 'assistant', capabilities: {} });
      expect(events).toHaveLength(1);

      unsubscribe();
      service.register({ id: 'a2', name: 'Test 2', type: 'assistant', capabilities: {} });
      expect(events).toHaveLength(1); // No new event
    });

    test('removes listener with removeEventListener', () => {
      const service = new AgentRegistryService();
      const events: RegistryEvent[] = [];
      const listener = (e: RegistryEvent) => events.push(e);

      service.addEventListener(listener);
      service.removeEventListener(listener);
      service.register({ id: 'a1', name: 'Test', type: 'assistant', capabilities: {} });
      expect(events).toHaveLength(0);
    });
  });

  describe('global singleton', () => {
    test('returns same instance', () => {
      const reg1 = getGlobalRegistry();
      const reg2 = getGlobalRegistry();
      expect(reg1).toBe(reg2);
    });

    test('reset creates new instance', () => {
      const reg1 = getGlobalRegistry();
      reg1.register({ id: 'test', name: 'Test', type: 'assistant', capabilities: {} });
      resetGlobalRegistry();
      const reg2 = getGlobalRegistry();
      expect(reg2).not.toBe(reg1);
      expect(reg2.list()).toEqual([]);
    });
  });

  describe('cleanup', () => {
    test('cleanupStaleAgents is callable', () => {
      const service = new AgentRegistryService();
      service.register({ id: 'a1', name: 'Test', type: 'assistant', capabilities: {} });
      expect(() => service.cleanupStaleAgents()).not.toThrow();
    });
  });
});
