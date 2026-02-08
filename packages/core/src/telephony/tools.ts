/**
 * Telephony tools for assistant use
 * Tools that enable SMS, WhatsApp, voice calls, and phone management
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from '../tools/registry';
import type { TelephonyManager } from './manager';

// ============================================
// Tool Definitions
// ============================================

export const telephonySendSmsTool: Tool = {
  name: 'telephony_send_sms',
  description: 'Send an SMS text message to a phone number.',
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Recipient phone number in E.164 format (e.g., "+15551234567")',
      },
      body: {
        type: 'string',
        description: 'Message content to send',
      },
      from: {
        type: 'string',
        description: 'Sender phone number (optional, uses default if not set)',
      },
    },
    required: ['to', 'body'],
  },
};

export const telephonySendWhatsappTool: Tool = {
  name: 'telephony_send_whatsapp',
  description: 'Send a WhatsApp message to a phone number.',
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Recipient phone number in E.164 format (e.g., "+15551234567")',
      },
      body: {
        type: 'string',
        description: 'Message content to send',
      },
      from: {
        type: 'string',
        description: 'Sender phone number (optional, uses default if not set)',
      },
    },
    required: ['to', 'body'],
  },
};

export const telephonyCallTool: Tool = {
  name: 'telephony_call',
  description: 'Initiate an outbound voice call. The call will be connected to the AI voice agent.',
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Phone number to call in E.164 format (e.g., "+15551234567")',
      },
      from: {
        type: 'string',
        description: 'Caller phone number (optional, uses default if not set)',
      },
    },
    required: ['to'],
  },
};

export const telephonyCallHistoryTool: Tool = {
  name: 'telephony_call_history',
  description: 'Get recent call history. Returns call logs with status, duration, and timestamps.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of calls to return (default: 20)',
      },
    },
    required: [],
  },
};

export const telephonySmsHistoryTool: Tool = {
  name: 'telephony_sms_history',
  description: 'Get recent SMS and WhatsApp message history.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum messages to return (default: 20)',
      },
      type: {
        type: 'string',
        enum: ['sms', 'whatsapp'],
        description: 'Filter by message type (default: all)',
      },
    },
    required: [],
  },
};

export const telephonyPhoneNumbersTool: Tool = {
  name: 'telephony_phone_numbers',
  description: 'List available phone numbers with their capabilities (voice, SMS, WhatsApp).',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const telephonyRoutingRulesTool: Tool = {
  name: 'telephony_routing_rules',
  description: 'View and manage routing rules that direct incoming calls/messages to specific assistants.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'create', 'delete'],
        description: 'Action to perform (default: list)',
      },
      name: {
        type: 'string',
        description: 'Rule name (for create)',
      },
      priority: {
        type: 'number',
        description: 'Priority (lower = higher priority, for create)',
      },
      from_pattern: {
        type: 'string',
        description: 'From number pattern (e.g., "+1555*", for create)',
      },
      message_type: {
        type: 'string',
        enum: ['sms', 'whatsapp', 'voice', 'all'],
        description: 'Message type filter (for create)',
      },
      rule_id: {
        type: 'string',
        description: 'Rule ID (for delete)',
      },
    },
    required: [],
  },
};

export const telephonyStatusTool: Tool = {
  name: 'telephony_status',
  description: 'Get telephony system status including configured numbers, active calls, and connection health.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

// ============================================
// Tool Executors
// ============================================

export function createTelephonyToolExecutors(
  getTelephonyManager: () => TelephonyManager | null
): Record<string, ToolExecutor> {
  return {
    telephony_send_sms: async (input) => {
      const manager = getTelephonyManager();
      if (!manager) {
        return 'Error: Telephony is not enabled. Set telephony.enabled: true in config.';
      }

      const to = String(input.to || '').trim();
      const body = String(input.body || '').trim();
      if (!to) return 'Error: Recipient phone number (to) is required.';
      if (!body) return 'Error: Message body is required.';

      const from = input.from ? String(input.from).trim() : undefined;
      const result = await manager.sendSms(to, body, from);
      return result.success ? result.message : `Error: ${result.message}`;
    },

    telephony_send_whatsapp: async (input) => {
      const manager = getTelephonyManager();
      if (!manager) {
        return 'Error: Telephony is not enabled. Set telephony.enabled: true in config.';
      }

      const to = String(input.to || '').trim();
      const body = String(input.body || '').trim();
      if (!to) return 'Error: Recipient phone number (to) is required.';
      if (!body) return 'Error: Message body is required.';

      const from = input.from ? String(input.from).trim() : undefined;
      const result = await manager.sendWhatsApp(to, body, from);
      return result.success ? result.message : `Error: ${result.message}`;
    },

    telephony_call: async (input) => {
      const manager = getTelephonyManager();
      if (!manager) {
        return 'Error: Telephony is not enabled. Set telephony.enabled: true in config.';
      }

      const to = String(input.to || '').trim();
      if (!to) return 'Error: Phone number (to) is required.';

      const from = input.from ? String(input.from).trim() : undefined;
      const result = await manager.makeCall(to, from);
      return result.success ? result.message : `Error: ${result.message}`;
    },

    telephony_call_history: async (input) => {
      const manager = getTelephonyManager();
      if (!manager) {
        return 'Error: Telephony is not enabled.';
      }

      const limit = typeof input.limit === 'number' ? input.limit : 20;
      const calls = manager.getCallHistory({ limit });

      if (calls.length === 0) {
        return 'No call history found.';
      }

      const lines: string[] = [];
      lines.push(`## Call History (${calls.length})`);
      lines.push('');

      for (const call of calls) {
        const dir = call.direction === 'inbound' ? 'IN' : 'OUT';
        const duration = call.duration != null ? `${call.duration}s` : '-';
        const date = new Date(call.createdAt).toLocaleString();
        lines.push(`[${dir}] ${call.fromNumber} → ${call.toNumber} | ${call.status} | ${duration} | ${date}`);
      }

      return lines.join('\n');
    },

    telephony_sms_history: async (input) => {
      const manager = getTelephonyManager();
      if (!manager) {
        return 'Error: Telephony is not enabled.';
      }

      const limit = typeof input.limit === 'number' ? input.limit : 20;
      const messageType = input.type as 'sms' | 'whatsapp' | undefined;
      const messages = manager.getSmsHistory({ limit, messageType });

      if (messages.length === 0) {
        return 'No message history found.';
      }

      const lines: string[] = [];
      lines.push(`## Message History (${messages.length})`);
      lines.push('');

      for (const msg of messages) {
        const dir = msg.direction === 'inbound' ? 'IN' : 'OUT';
        const type = msg.messageType === 'whatsapp' ? 'WA' : 'SMS';
        const date = new Date(msg.createdAt).toLocaleString();
        lines.push(`[${dir}/${type}] ${msg.fromNumber} → ${msg.toNumber} | ${msg.status}`);
        lines.push(`  ${msg.bodyPreview}`);
        lines.push(`  ${date}`);
        lines.push('');
      }

      return lines.join('\n');
    },

    telephony_phone_numbers: async () => {
      const manager = getTelephonyManager();
      if (!manager) {
        return 'Error: Telephony is not enabled.';
      }

      const numbers = manager.listPhoneNumbers();

      if (numbers.length === 0) {
        return 'No phone numbers configured. Use /phone sync to import from Twilio.';
      }

      const lines: string[] = [];
      lines.push(`## Phone Numbers (${numbers.length})`);
      lines.push('');

      for (const num of numbers) {
        const caps: string[] = [];
        if (num.capabilities.voice) caps.push('voice');
        if (num.capabilities.sms) caps.push('sms');
        if (num.capabilities.whatsapp) caps.push('whatsapp');
        const name = num.friendlyName ? ` (${num.friendlyName})` : '';
        lines.push(`  ${num.number}${name} [${caps.join(', ')}]`);
      }

      return lines.join('\n');
    },

    telephony_routing_rules: async (input) => {
      const manager = getTelephonyManager();
      if (!manager) {
        return 'Error: Telephony is not enabled.';
      }

      const action = String(input.action || 'list');

      if (action === 'list') {
        const rules = manager.listRoutingRules();
        if (rules.length === 0) {
          return 'No routing rules configured.';
        }

        const lines: string[] = [];
        lines.push(`## Routing Rules (${rules.length})`);
        lines.push('');

        for (const rule of rules) {
          const enabled = rule.enabled ? '' : ' [DISABLED]';
          lines.push(`**${rule.name}** (priority: ${rule.priority})${enabled}`);
          lines.push(`  ID: ${rule.id}`);
          lines.push(`  Type: ${rule.messageType} | Target: ${rule.targetAssistantName}`);
          if (rule.fromPattern) lines.push(`  From: ${rule.fromPattern}`);
          if (rule.toPattern) lines.push(`  To: ${rule.toPattern}`);
          if (rule.keyword) lines.push(`  Keyword: ${rule.keyword}`);
          lines.push('');
        }

        return lines.join('\n');
      }

      if (action === 'create') {
        const name = String(input.name || '').trim();
        if (!name) return 'Error: Rule name is required.';

        const result = manager.createRoutingRule({
          name,
          priority: typeof input.priority === 'number' ? input.priority : undefined,
          fromPattern: input.from_pattern ? String(input.from_pattern) : undefined,
          messageType: input.message_type as 'sms' | 'whatsapp' | 'voice' | 'all' | undefined,
          targetAssistantId: manager.getAssistantId(),
          targetAssistantName: manager.getAssistantName(),
        });

        return result.success ? result.message : `Error: ${result.message}`;
      }

      if (action === 'delete') {
        const ruleId = String(input.rule_id || '').trim();
        if (!ruleId) return 'Error: Rule ID is required.';

        const result = manager.deleteRoutingRule(ruleId);
        return result.success ? result.message : `Error: ${result.message}`;
      }

      return `Unknown action: ${action}. Use 'list', 'create', or 'delete'.`;
    },

    telephony_status: async () => {
      const manager = getTelephonyManager();
      if (!manager) {
        return 'Telephony is not enabled. Set telephony.enabled: true in config.';
      }

      const status = manager.getStatus();

      const lines: string[] = [];
      lines.push('## Telephony Status');
      lines.push('');
      lines.push(`Enabled:           ${status.enabled ? 'Yes' : 'No'}`);
      lines.push(`Twilio configured: ${status.twilioConfigured ? 'Yes' : 'No (set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN)'}`);
      lines.push(`ElevenLabs AI:     ${status.elevenLabsConfigured ? 'Yes' : 'No (set ELEVENLABS_API_KEY + ELEVENLABS_AGENT_ID)'}`);
      lines.push(`Phone numbers:     ${status.phoneNumbers}`);
      lines.push(`Active calls:      ${status.activeCalls}`);
      lines.push(`Routing rules:     ${status.routingRules}`);
      lines.push(`Recent calls:      ${status.recentCalls}`);
      lines.push(`Recent messages:   ${status.recentMessages}`);

      return lines.join('\n');
    },
  };
}

// ============================================
// All tools array
// ============================================

export const telephonyTools: Tool[] = [
  telephonySendSmsTool,
  telephonySendWhatsappTool,
  telephonyCallTool,
  telephonyCallHistoryTool,
  telephonySmsHistoryTool,
  telephonyPhoneNumbersTool,
  telephonyRoutingRulesTool,
  telephonyStatusTool,
];

// ============================================
// Registration
// ============================================

export function registerTelephonyTools(
  registry: ToolRegistry,
  getTelephonyManager: () => TelephonyManager | null
): void {
  const executors = createTelephonyToolExecutors(getTelephonyManager);

  for (const tool of telephonyTools) {
    registry.register(tool, executors[tool.name]);
  }
}
