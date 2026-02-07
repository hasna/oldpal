type SchemaMockOverrides = Record<string, unknown>;

const baseSchemaMock = {
  users: 'users',
  refreshTokens: 'refreshTokens',
  assistants: 'assistants',
  assistantsRelations: 'assistantsRelations',
  sessions: 'sessions',
  sessionsRelations: 'sessionsRelations',
  messages: 'messages',
  messageRoleEnum: { enumValues: ['user', 'assistant', 'system'] },
  assistantMessages: 'assistantMessages',
  assistantMessagesRelations: 'assistantMessagesRelations',
  messagePriorityEnum: { enumValues: ['low', 'normal', 'high', 'urgent'] },
  messageStatusEnum: { enumValues: ['unread', 'read', 'archived', 'injected'] },
  schedules: 'schedules',
  scheduleExecutions: 'scheduleExecutions',
  subscriptionPlans: 'subscriptionPlans',
  subscriptions: 'subscriptions',
  invoices: 'invoices',
  usageMetrics: 'usageMetrics',
  adminAuditLogs: 'adminAuditLogs',
  loginHistory: 'loginHistory',
  notifications: 'notifications',
  identities: 'identities',
  apiKeys: 'apiKeys',
  userRoleEnum: { enumValues: ['user', 'admin'] },
  // Legacy aliases for older tests
  agents: 'assistants',
  agentsRelations: 'assistantsRelations',
  agentMessages: 'assistantMessages',
  agentMessagesRelations: 'assistantMessagesRelations',
};

export function createSchemaMock(overrides: SchemaMockOverrides = {}) {
  return { ...baseSchemaMock, ...overrides };
}
