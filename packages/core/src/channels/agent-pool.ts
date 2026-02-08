/**
 * ChannelAgentPool - manages per-assistant EmbeddedClient instances
 * for multi-agent channel responses.
 *
 * When a person posts in a channel, the pool triggers each assistant
 * member independently using their own identity, model, and system prompt.
 */

import { EmbeddedClient } from '../client';
import { parseMentions, resolveNameToKnown } from './mentions';
import type { ChannelMember } from './types';

export class ChannelAgentPool {
  private agents: Map<string, EmbeddedClient> = new Map();
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /**
   * Trigger all (or mentioned) assistant members of a channel to respond to a message.
   * Each assistant gets its own EmbeddedClient with correct identity, model, and tools.
   * Responses fire in the background (not awaited) so the caller returns immediately.
   */
  async triggerResponses(
    channelName: string,
    personName: string,
    message: string,
    channelMembers: ChannelMember[],
    excludeAssistantId?: string,
  ): Promise<void> {
    // Filter to assistant-type members only
    const assistantMembers = channelMembers.filter(
      (m) => m.memberType === 'assistant'
    );

    if (assistantMembers.length === 0) return;

    // Determine which assistants to trigger based on @mentions
    let targetMembers = assistantMembers;
    const mentions = parseMentions(message);
    if (mentions.length > 0) {
      const knownNames = assistantMembers.map((m) => ({
        id: m.assistantId,
        name: m.assistantName,
      }));
      const resolved = mentions
        .map((m) => resolveNameToKnown(m, knownNames))
        .filter(Boolean) as Array<{ id: string; name: string }>;

      if (resolved.length > 0) {
        const resolvedIds = new Set(resolved.map((r) => r.id));
        targetMembers = assistantMembers.filter((m) =>
          resolvedIds.has(m.assistantId)
        );
      }
    }

    // Exclude the active session's assistant (it already processes via the main loop)
    if (excludeAssistantId) {
      targetMembers = targetMembers.filter(
        (m) => m.assistantId !== excludeAssistantId
      );
    }

    if (targetMembers.length === 0) return;

    // Build prompt for each assistant
    const prompt = `[Channel Message] ${personName} posted in #${channelName}: "${message}"\n\nRespond in #${channelName} using channel_send. Be helpful and conversational.`;

    // Fire all responses concurrently (don't await — they arrive async via channel_send)
    const sends = targetMembers.map(async (member) => {
      try {
        const client = await this.getOrCreateClient(member.assistantId);
        await client.send(prompt);
      } catch (error) {
        console.error(
          `ChannelAgentPool: Failed to trigger response for ${member.assistantName}:`,
          error
        );
      }
    });

    // Use Promise.allSettled so one failure doesn't block others
    await Promise.allSettled(sends);
  }

  /**
   * Get or create a cached EmbeddedClient for an assistant.
   * Each client initializes with the assistant's own identity, model, and tools.
   */
  private async getOrCreateClient(
    assistantId: string
  ): Promise<EmbeddedClient> {
    const existing = this.agents.get(assistantId);
    if (existing) return existing;

    const client = new EmbeddedClient(this.cwd, {
      assistantId,
    });

    await client.initialize();
    this.agents.set(assistantId, client);
    return client;
  }

  /**
   * Shut down all cached agent clients and release resources.
   */
  shutdown(): void {
    for (const [, client] of this.agents) {
      try {
        client.disconnect();
      } catch {
        // Ignore errors during shutdown
      }
    }
    this.agents.clear();
  }
}
