/**
 * Channel @mention parsing and resolution
 */

import type { ChannelMember } from './types';

/**
 * Extract @mention names from message content
 * Matches @name patterns (alphanumeric, hyphens, underscores)
 */
export function parseMentions(content: string): string[] {
  const regex = /@([a-zA-Z0-9_-]+)/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    if (!mentions.includes(name)) {
      mentions.push(name);
    }
  }
  return mentions;
}

/**
 * Resolve mention names to member IDs using channel members list
 */
export function resolveMentions(
  names: string[],
  members: ChannelMember[]
): Array<{ name: string; memberId: string; memberType: string }> {
  const resolved: Array<{ name: string; memberId: string; memberType: string }> = [];

  for (const name of names) {
    const lower = name.toLowerCase();
    const member = members.find(
      (m) => m.assistantName.toLowerCase() === lower
    );
    if (member) {
      resolved.push({
        name,
        memberId: member.assistantId,
        memberType: member.memberType,
      });
    }
  }

  return resolved;
}

/**
 * Get mentioned member IDs from a message content
 */
export function getMentionedMemberIds(
  content: string,
  members: ChannelMember[]
): string[] {
  const names = parseMentions(content);
  const resolved = resolveMentions(names, members);
  return resolved.map((r) => r.memberId);
}
