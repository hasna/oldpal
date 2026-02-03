/**
 * Integration tests for agent-to-agent messaging system
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createMessagesManager, LocalMessagesStorage } from '../index';
import { generateId } from '@hasna/assistants-shared';
import { join } from 'path';
import { rm, mkdir, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';

// Test configuration
let testBasePath = '';
let testConfig: {
  enabled: boolean;
  injection: {
    enabled: boolean;
    maxPerTurn: number;
    minPriority: 'low';
  };
  storage: {
    basePath: string;
    maxMessages: number;
    maxAgeDays: number;
  };
};

// Clean up test data before and after tests
beforeAll(async () => {
  const tmpBase = await mkdtemp(join(tmpdir(), 'assistants-messages-'));
  testBasePath = join(tmpBase, '__test__');
  testConfig = {
    enabled: true,
    injection: {
      enabled: true,
      maxPerTurn: 5,
      minPriority: 'low' as const,
    },
    storage: {
      basePath: testBasePath,
      maxMessages: 100,
      maxAgeDays: 30,
    },
  };
  await rm(testBasePath, { recursive: true, force: true });
  await mkdir(testBasePath, { recursive: true });
});

afterAll(async () => {
  await rm(testBasePath, { recursive: true, force: true });
});

describe('MessagesManager', () => {
  test('creates manager and initializes successfully', async () => {
    const agentId = `test-${generateId().slice(0, 8)}`;
    const manager = createMessagesManager(agentId, 'TestAgent', testConfig);

    await manager.initialize();

    const stats = await manager.getStats();
    expect(stats.totalMessages).toBe(0);
    expect(stats.unreadCount).toBe(0);
    expect(stats.threadCount).toBe(0);
  });

  test('registers agent in registry on initialize', async () => {
    const storage = new LocalMessagesStorage({ basePath: testBasePath });
    const agentId = `test-${generateId().slice(0, 8)}`;
    const agentName = 'RegisterTestAgent';

    const manager = createMessagesManager(agentId, agentName, testConfig);
    await manager.initialize();

    const registry = await storage.loadRegistry();
    expect(registry.agents[agentId]).toBeDefined();
    expect(registry.agents[agentId].name).toBe(agentName);
  });

  test('sends message between agents successfully', async () => {
    // Create two agents
    const agent1Id = `sender-${generateId().slice(0, 8)}`;
    const agent2Id = `receiver-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(agent1Id, 'SenderAgent', testConfig);
    const receiver = createMessagesManager(agent2Id, 'ReceiverAgent', testConfig);

    await sender.initialize();
    await receiver.initialize();

    // Send message from sender to receiver
    const result = await sender.send({
      to: 'ReceiverAgent',
      body: 'Hello from sender!',
      subject: 'Test Subject',
      priority: 'normal',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();
    expect(result.threadId).toBeDefined();

    // Verify message is in receiver's inbox
    const messages = await receiver.list({ limit: 10 });
    expect(messages.length).toBe(1);
    expect(messages[0].fromAgentName).toBe('SenderAgent');
    expect(messages[0].subject).toBe('Test Subject');
    expect(messages[0].status).toBe('unread');
  });

  test('reads message and marks as read', async () => {
    const agent1Id = `sender2-${generateId().slice(0, 8)}`;
    const agent2Id = `receiver2-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(agent1Id, 'Sender2', testConfig);
    const receiver = createMessagesManager(agent2Id, 'Receiver2', testConfig);

    await sender.initialize();
    await receiver.initialize();

    // Send message
    const sendResult = await sender.send({
      to: 'Receiver2',
      body: 'Message to read',
      subject: 'Read Test',
    });

    // Read message
    const message = await receiver.read(sendResult.messageId!);

    expect(message).not.toBeNull();
    expect(message?.body).toBe('Message to read');
    expect(message?.status).toBe('read');

    // Verify status updated in list
    const messages = await receiver.list({ limit: 10 });
    expect(messages[0].status).toBe('read');
  });

  test('replies create proper thread', async () => {
    const agent1Id = `thread1-${generateId().slice(0, 8)}`;
    const agent2Id = `thread2-${generateId().slice(0, 8)}`;

    const agent1 = createMessagesManager(agent1Id, 'ThreadAgent1', testConfig);
    const agent2 = createMessagesManager(agent2Id, 'ThreadAgent2', testConfig);

    await agent1.initialize();
    await agent2.initialize();

    // Agent1 sends initial message
    const msg1 = await agent1.send({
      to: 'ThreadAgent2',
      body: 'Initial message',
      subject: 'Thread Test',
    });

    // Agent2 replies
    const reply1 = await agent2.send({
      to: 'ThreadAgent1',
      body: 'Reply from agent2',
      replyTo: msg1.messageId,
    });

    // Verify same thread
    expect(reply1.threadId).toBe(msg1.threadId);

    // Agent1 replies back
    const reply2 = await agent1.send({
      to: 'ThreadAgent2',
      body: 'Reply from agent1',
      replyTo: reply1.messageId,
    });

    expect(reply2.threadId).toBe(msg1.threadId);

    // Read thread from agent2's perspective
    const threadMessages = await agent2.readThread(msg1.threadId!);
    expect(threadMessages.length).toBeGreaterThanOrEqual(2);
  });

  test('deletes message successfully', async () => {
    const agent1Id = `del1-${generateId().slice(0, 8)}`;
    const agent2Id = `del2-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(agent1Id, 'DelSender', testConfig);
    const receiver = createMessagesManager(agent2Id, 'DelReceiver', testConfig);

    await sender.initialize();
    await receiver.initialize();

    // Send and then delete
    const result = await sender.send({
      to: 'DelReceiver',
      body: 'Message to delete',
    });

    // Verify message exists
    let messages = await receiver.list({ limit: 10 });
    const initialCount = messages.length;
    expect(initialCount).toBeGreaterThan(0);

    // Delete message
    const deleteResult = await receiver.delete(result.messageId!);
    expect(deleteResult.success).toBe(true);

    // Verify message gone
    messages = await receiver.list({ limit: 10 });
    expect(messages.length).toBe(initialCount - 1);
  });

  test('lists known agents correctly', async () => {
    const agent1Id = `list1-${generateId().slice(0, 8)}`;
    const agent2Id = `list2-${generateId().slice(0, 8)}`;

    const agent1 = createMessagesManager(agent1Id, 'ListAgent1', testConfig);
    const agent2 = createMessagesManager(agent2Id, 'ListAgent2', testConfig);

    await agent1.initialize();
    await agent2.initialize();

    // Exchange messages to ensure both are in registry
    await agent1.send({ to: 'ListAgent2', body: 'Hello' });

    // List agents from agent1's perspective (should see agent2)
    const agents = await agent1.listAgents();
    const agent2Entry = agents.find(a => a.name === 'ListAgent2');
    expect(agent2Entry).toBeDefined();
    expect(agent2Entry?.id).toBe(agent2Id);
  });

  test('lists threads correctly', async () => {
    const agent1Id = `thr1-${generateId().slice(0, 8)}`;
    const agent2Id = `thr2-${generateId().slice(0, 8)}`;

    const agent1 = createMessagesManager(agent1Id, 'ThrAgent1', testConfig);
    const agent2 = createMessagesManager(agent2Id, 'ThrAgent2', testConfig);

    await agent1.initialize();
    await agent2.initialize();

    // Create a conversation
    await agent1.send({ to: 'ThrAgent2', body: 'Thread starter', subject: 'Test Thread' });

    // List threads
    const threads = await agent2.listThreads();
    expect(threads.length).toBeGreaterThan(0);
    expect(threads[0].subject).toBe('Test Thread');
  });
});

describe('Message Injection', () => {
  test('gets unread messages for injection', async () => {
    const agent1Id = `inj1-${generateId().slice(0, 8)}`;
    const agent2Id = `inj2-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(agent1Id, 'InjSender', testConfig);
    const receiver = createMessagesManager(agent2Id, 'InjReceiver', testConfig);

    await sender.initialize();
    await receiver.initialize();

    // Send message
    await sender.send({
      to: 'InjReceiver',
      body: 'Message for injection',
      priority: 'high',
    });

    // Get unread for injection
    const unread = await receiver.getUnreadForInjection();
    expect(unread.length).toBe(1);
    expect(unread[0].priority).toBe('high');
  });

  test('builds injection context correctly', async () => {
    const agent1Id = `ctx1-${generateId().slice(0, 8)}`;
    const agent2Id = `ctx2-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(agent1Id, 'CtxSender', testConfig);
    const receiver = createMessagesManager(agent2Id, 'CtxReceiver', testConfig);

    await sender.initialize();
    await receiver.initialize();

    await sender.send({
      to: 'CtxReceiver',
      body: 'Test message content',
      subject: 'Context Test',
    });

    const unread = await receiver.getUnreadForInjection();
    const context = receiver.buildInjectionContext(unread);

    expect(context).toContain('## Pending Agent Messages');
    expect(context).toContain('CtxSender');
    expect(context).toContain('Context Test');
    expect(context).toContain('Test message content');
  });

  test('marks messages as injected', async () => {
    const agent1Id = `mark1-${generateId().slice(0, 8)}`;
    const agent2Id = `mark2-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(agent1Id, 'MarkSender', testConfig);
    const receiver = createMessagesManager(agent2Id, 'MarkReceiver', testConfig);

    await sender.initialize();
    await receiver.initialize();

    await sender.send({ to: 'MarkReceiver', body: 'Mark test' });

    const unread1 = await receiver.getUnreadForInjection();
    expect(unread1.length).toBe(1);

    // Mark as injected
    await receiver.markInjected(unread1.map(m => m.id));

    // Should not appear in unread for injection again
    const unread2 = await receiver.getUnreadForInjection();
    expect(unread2.length).toBe(0);
  });

  test('respects minPriority filter', async () => {
    const agent1Id = `pri1-${generateId().slice(0, 8)}`;
    const agent2Id = `pri2-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(agent1Id, 'PriSender', testConfig);

    // Receiver with minPriority: 'high'
    const receiverConfig = {
      ...testConfig,
      injection: {
        ...testConfig.injection,
        minPriority: 'high' as const,
      },
    };
    const receiver = createMessagesManager(agent2Id, 'PriReceiver', receiverConfig);

    await sender.initialize();
    await receiver.initialize();

    // Send low priority message
    await sender.send({ to: 'PriReceiver', body: 'Low priority', priority: 'low' });

    // Should not be returned for injection due to minPriority filter
    const unread = await receiver.getUnreadForInjection();
    expect(unread.length).toBe(0);

    // Send high priority message
    await sender.send({ to: 'PriReceiver', body: 'High priority', priority: 'high' });

    const unread2 = await receiver.getUnreadForInjection();
    expect(unread2.length).toBe(1);
  });
});

describe('Error Handling', () => {
  test('fails gracefully when sending to non-existent agent', async () => {
    const agentId = `err1-${generateId().slice(0, 8)}`;
    const manager = createMessagesManager(agentId, 'ErrAgent', testConfig);
    await manager.initialize();

    const result = await manager.send({
      to: 'NonExistentAgent12345',
      body: 'Test message',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  test('returns null when reading non-existent message', async () => {
    const agentId = `err2-${generateId().slice(0, 8)}`;
    const manager = createMessagesManager(agentId, 'ErrAgent2', testConfig);
    await manager.initialize();

    const message = await manager.read('msg_nonexistent');
    expect(message).toBeNull();
  });

  test('returns failure when deleting non-existent message', async () => {
    const agentId = `err3-${generateId().slice(0, 8)}`;
    const manager = createMessagesManager(agentId, 'ErrAgent3', testConfig);
    await manager.initialize();

    const result = await manager.delete('msg_nonexistent');
    expect(result.success).toBe(false);
  });
});

describe('LocalMessagesStorage', () => {
  test('creates storage directories', async () => {
    const storage = new LocalMessagesStorage({ basePath: testBasePath });
    const agentId = `store-${generateId().slice(0, 8)}`;

    await storage.ensureDirectories(agentId);

    // Check agent can load empty index
    const index = await storage.loadIndex(agentId);
    expect(index.messages).toEqual([]);
    expect(index.stats.totalMessages).toBe(0);
  });

  test('finds agent by name case-insensitively', async () => {
    const storage = new LocalMessagesStorage({ basePath: testBasePath });
    const agentId = `case-${generateId().slice(0, 8)}`;

    await storage.registerAgent(agentId, 'CaseSensitiveAgent');

    // Find with different case
    const found = await storage.findAgentByName('casesensitiveagent');
    expect(found).not.toBeNull();
    expect(found?.id).toBe(agentId);

    const found2 = await storage.findAgentByName('CASESENSITIVEAGENT');
    expect(found2).not.toBeNull();
    expect(found2?.id).toBe(agentId);
  });
});
