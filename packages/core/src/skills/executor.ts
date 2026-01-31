import type { Skill } from '@oldpal/shared';
import { substituteVariables } from '@oldpal/shared';

/**
 * Skill executor - prepares and executes skills
 */
export class SkillExecutor {
  /**
   * Prepare skill content with argument substitution
   */
  prepare(skill: Skill, args: string[]): string {
    let content = skill.content;

    // Substitute variables
    content = substituteVariables(content, args);

    // If $ARGUMENTS wasn't in the content, append it
    if (!skill.content.includes('$ARGUMENTS') && args.length > 0) {
      content += `\n\nARGUMENTS: ${args.join(' ')}`;
    }

    // Execute dynamic context injection (backtick commands)
    content = this.executeDynamicContext(content);

    return content;
  }

  /**
   * Execute backtick commands for dynamic context injection
   * Syntax: `!command`
   */
  private executeDynamicContext(content: string): string {
    const backtickPattern = /`!([^`]+)`/g;
    let result = content;

    // Note: In a real implementation, this would need to be async
    // and handle command execution. For now, we'll mark it for the agent to handle.
    result = result.replace(backtickPattern, (match, command) => {
      return `[Dynamic context: ${command}]`;
    });

    return result;
  }

  /**
   * Check if a skill should be auto-invoked based on user message
   */
  shouldAutoInvoke(skill: Skill, userMessage: string): boolean {
    if (skill.disableModelInvocation) {
      return false;
    }

    // Simple keyword matching - could be enhanced with embeddings
    const keywords = skill.description.toLowerCase().split(/\s+/);
    const messageWords = userMessage.toLowerCase().split(/\s+/);

    let matchCount = 0;
    for (const keyword of keywords) {
      if (keyword.length > 3 && messageWords.includes(keyword)) {
        matchCount++;
      }
    }

    // Require at least 2 keyword matches
    return matchCount >= 2;
  }
}
