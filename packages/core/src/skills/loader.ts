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
    const envHome = process.env.HOME || process.env.USERPROFILE;
    const userHome = envHome && envHome.trim().length > 0 ? envHome : homedir();
    const userSkillsDir = join(userHome, '.oldpal', 'skills');
    await this.loadFromDirectory(userSkillsDir);

    // Load project skills
    const projectSkillsDir = join(projectDir, '.oldpal', 'skills');
    await this.loadFromDirectory(projectSkillsDir);

    // Also check nested .oldpal/skills in monorepo
    const nestedGlob = new Glob('**/.oldpal/skills/*/SKILL.md');
    for await (const file of nestedGlob.scan({ cwd: projectDir, dot: true })) {
      await this.loadSkillFile(join(projectDir, file));
    }
  }

  /**
   * Load skills from a directory
   * Supports both `skill-name/SKILL.md` and `name/SKILL.md` patterns
   */
  async loadFromDirectory(dir: string): Promise<void> {
    try {
      // Check if directory exists using native fs
      const { stat } = await import('fs/promises');
      try {
        const stats = await stat(dir);
        if (!stats.isDirectory()) return;
      } catch {
        return; // Directory doesn't exist
      }

      // Collect all skill files to load
      const filesToLoad: string[] = [];

      // Load skills from skill-* directories (preferred convention)
      const skillPrefixGlob = new Glob('skill-*/SKILL.md');
      for await (const file of skillPrefixGlob.scan({ cwd: dir })) {
        filesToLoad.push(join(dir, file));
      }

      // Also load from regular directories (for backwards compatibility)
      const regularGlob = new Glob('*/SKILL.md');
      for await (const file of regularGlob.scan({ cwd: dir })) {
        // Skip if already loaded via skill- prefix
        const dirName = file.split('/')[0];
        if (!dirName.startsWith('skill-')) {
          filesToLoad.push(join(dir, file));
        }
      }

      // Load all skill files in parallel
      await Promise.all(filesToLoad.map((file) => this.loadSkillFile(file)));
    } catch {
      // Directory doesn't exist or error reading, skip
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

      const allowedToolsRaw = frontmatter['allowed-tools'];
      const allowedTools = Array.isArray(allowedToolsRaw)
        ? allowedToolsRaw.map((t) => String(t).trim()).filter(Boolean)
        : typeof allowedToolsRaw === 'string'
          ? allowedToolsRaw.split(',').map((t) => t.trim()).filter(Boolean)
          : undefined;

      const argumentHintRaw = frontmatter['argument-hint'];
      const argumentHint = Array.isArray(argumentHintRaw)
        ? `[${argumentHintRaw.join(', ')}]`
        : typeof argumentHintRaw === 'string'
          ? argumentHintRaw
          : undefined;

      const skill: Skill = {
        name,
        description,
        argumentHint,
        allowedTools,
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
