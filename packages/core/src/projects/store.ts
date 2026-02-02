import { join } from 'path';
import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { generateId } from '@hasna/assistants-shared';

export type ProjectContextType = 'file' | 'connector' | 'database' | 'note' | 'entity';

export interface ProjectContextEntry {
  id: string;
  type: ProjectContextType;
  value: string;
  label?: string;
  addedAt: number;
}

export type PlanStepStatus = 'todo' | 'doing' | 'done' | 'blocked';

export interface ProjectPlanStep {
  id: string;
  text: string;
  status: PlanStepStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectPlan {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  steps: ProjectPlanStep[];
}

export interface ProjectRecord {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  context: ProjectContextEntry[];
  plans: ProjectPlan[];
}

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function projectsDir(cwd: string): string {
  return join(cwd, '.assistants', 'projects');
}

function isSafeId(id: string): boolean {
  return SAFE_ID_PATTERN.test(id);
}

function projectPath(cwd: string, id: string): string | null {
  if (!isSafeId(id)) return null;
  return join(projectsDir(cwd), `${id}.json`);
}

async function ensureProjectsDir(cwd: string): Promise<void> {
  await mkdir(projectsDir(cwd), { recursive: true });
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export async function listProjects(cwd: string): Promise<ProjectRecord[]> {
  try {
    const dir = projectsDir(cwd);
    const files = await readdir(dir);
    const projects: ProjectRecord[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(dir, file), 'utf-8');
        const parsed = JSON.parse(raw) as ProjectRecord;
        if (parsed?.id && parsed?.name) {
          projects.push(parsed);
        }
      } catch {
        // Skip malformed files
      }
    }
    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function readProject(cwd: string, id: string): Promise<ProjectRecord | null> {
  try {
    const path = projectPath(cwd, id);
    if (!path) return null;
    const raw = await readFile(path, 'utf-8');
    const project = JSON.parse(raw) as ProjectRecord;
    if (!project?.id || !project?.name) return null;
    return project;
  } catch {
    return null;
  }
}

export async function findProjectByName(cwd: string, name: string): Promise<ProjectRecord | null> {
  const normalized = normalizeName(name);
  const projects = await listProjects(cwd);
  return projects.find((project) => normalizeName(project.name) === normalized) || null;
}

export async function saveProject(cwd: string, project: ProjectRecord): Promise<void> {
  await ensureProjectsDir(cwd);
  const path = projectPath(cwd, project.id);
  if (!path) {
    throw new Error(`Invalid project id: ${project.id}`);
  }
  await writeFile(path, JSON.stringify(project, null, 2), 'utf-8');
}

export async function deleteProject(cwd: string, id: string): Promise<boolean> {
  try {
    const path = projectPath(cwd, id);
    if (!path) return false;
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

export async function createProject(
  cwd: string,
  name: string,
  description?: string
): Promise<ProjectRecord> {
  const now = Date.now();
  const project: ProjectRecord = {
    id: generateId(),
    name: name.trim(),
    description: description?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
    context: [],
    plans: [],
  };
  await saveProject(cwd, project);
  return project;
}

export async function updateProject(
  cwd: string,
  id: string,
  updater: (project: ProjectRecord) => ProjectRecord
): Promise<ProjectRecord | null> {
  const project = await readProject(cwd, id);
  if (!project) return null;
  const updated = updater(project);
  await saveProject(cwd, updated);
  return updated;
}

export async function ensureDefaultProject(cwd: string): Promise<ProjectRecord> {
  const projects = await listProjects(cwd);
  if (projects.length > 0) return projects[0];
  return createProject(cwd, 'default', 'Default project for this folder');
}

export function hasProjectNameConflict(projects: ProjectRecord[], name: string): boolean {
  const normalized = normalizeName(name);
  return projects.some((project) => normalizeName(project.name) === normalized);
}
