import { join } from 'path';
import { homedir } from 'os';
import { Glob } from 'bun';
import type { Skill, SkillFrontmatter } from '@oldpal/shared';
import { parseFrontmatter } from '@oldpal/shared';

/**
 * Skill loader - discovers and loads SKILL.md files
 */
export class SkillLoader {
  private skills: Map<string, Skill> = new Map();

  /**
   * Load all skills from user and project directories
   */
  async loadAll(projectDir: string = process.cwd()): Promise<void> {
    // Load user skills
    const userSkillsDir = join(homedir(), '.oldpal', 'skills');
    await this.loadFromDirectory(userSkillsDir);

    // Load project skills
    const projectSkillsDir = join(projectDir, '.oldpal', 'skills');
    await this.loadFromDirectory(projectSkillsDir);

    // Also check nested .oldpal/skills in monorepo
    const nestedGlob = new Glob('**/.oldpal/skills/*/SKILL.md');
    for await (const file of nestedGlob.scan({ cwd: projectDir })) {
      await this.loadSkillFile(join(projectDir, file));
    }
  }

  /**
   * Load skills from a directory
   */
  async loadFromDirectory(dir: string): Promise<void> {
    try {
      const glob = new Glob('*/SKILL.md');
      for await (const file of glob.scan({ cwd: dir })) {
        await this.loadSkillFile(join(dir, file));
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  /**
   * Load a single skill file
   */
  async loadSkillFile(filePath: string): Promise<Skill | null> {
    try {
      const content = await Bun.file(filePath).text();
      const { frontmatter, content: markdownContent } = parseFrontmatter<SkillFrontmatter>(content);

      // Get skill name from frontmatter or directory name
      const dirName = filePath.split('/').slice(-2)[0];
      const name = frontmatter.name || dirName;

      // Get description from frontmatter or first paragraph
      let description = frontmatter.description || '';
      if (!description && markdownContent) {
        const firstParagraph = markdownContent.split('\n\n')[0];
        description = firstParagraph.replace(/^#.*\n?/, '').trim();
      }

      const skill: Skill = {
        name,
        description,
        argumentHint: frontmatter['argument-hint'],
        allowedTools: frontmatter['allowed-tools']?.split(',').map((t) => t.trim()),
        disableModelInvocation: frontmatter['disable-model-invocation'],
        userInvocable: frontmatter['user-invocable'] !== false,
        model: frontmatter.model,
        context: frontmatter.context,
        agent: frontmatter.agent,
        hooks: frontmatter.hooks,
        content: markdownContent,
        filePath,
      };

      this.skills.set(name, skill);
      return skill;
    } catch (error) {
      console.error(`Failed to load skill from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Get a skill by name
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Get all loaded skills
   */
  getSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get user-invocable skills (for slash command menu)
   */
  getUserInvocableSkills(): Skill[] {
    return this.getSkills().filter((s) => s.userInvocable !== false);
  }

  /**
   * Get skill descriptions for context (helps LLM know what's available)
   */
  getSkillDescriptions(): string {
    const skills = this.getSkills();
    if (skills.length === 0) return '';

    const lines = ['Available skills (invoke with /skill-name):'];
    for (const skill of skills) {
      const hint = skill.argumentHint ? ` ${skill.argumentHint}` : '';
      lines.push(`- /${skill.name}${hint}: ${skill.description}`);
    }
    return lines.join('\n');
  }
}
