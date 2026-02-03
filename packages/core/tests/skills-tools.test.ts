import { describe, expect, mock, test } from 'bun:test';
import { ToolExecutionError } from '../src/errors';
import { withTempDir } from './fixtures/helpers';

const { SkillTool, createSkillListTool, createSkillReadTool } = await import('../src/tools/skills');

describe('Skill tools', () => {
  test('SkillTool.executor validates input and returns summary', async () => {
    await expect(SkillTool.executor({})).rejects.toBeInstanceOf(ToolExecutionError);
    await expect(SkillTool.executor({ name: 'test' })).rejects.toBeInstanceOf(ToolExecutionError);
    await withTempDir(async (dir) => {
      const output = await SkillTool.executor({
        name: 'test',
        scope: 'project',
        description: 'desc',
        content: 'body',
        allowed_tools: 'read,write',
        argument_hint: 'arg',
        overwrite: true,
        cwd: dir,
      });

      expect(output).toContain('Created skill');
      expect(output).toContain(dir);
    });
  });

  test('createSkillListTool handles loader and empty results', async () => {
    const loader = {
      loadAll: mock(async () => {}),
      getSkillDescriptions: mock(() => ''),
    };
    const { executor } = createSkillListTool(() => loader as any);
    const output = await executor({ cwd: '/tmp' });
    expect(output).toBe('No skills loaded.');

    const { executor: missingExecutor } = createSkillListTool(() => null);
    await expect(missingExecutor({})).rejects.toBeInstanceOf(ToolExecutionError);
  });

  test('createSkillReadTool handles missing loader and skill', async () => {
    const { executor: missing } = createSkillReadTool(() => null);
    await expect(missing({ name: 'skill' })).rejects.toBeInstanceOf(ToolExecutionError);

    const loader = {
      ensureSkillContent: mock(async () => null),
    };
    const { executor } = createSkillReadTool(() => loader as any);
    await expect(executor({ name: 'missing' })).rejects.toBeInstanceOf(ToolExecutionError);

    loader.ensureSkillContent = mock(async () => ({ name: 'my-skill', content: 'hello' }));
    const content = await executor({ name: 'my-skill' });
    expect(content).toBe('hello');
  });
});
