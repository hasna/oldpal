import { join } from 'path';
import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { getConfigDir } from '../config';
import type { Job, JobStatus } from './types';

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Get the jobs directory path (~/.assistants/jobs/)
 */
function jobsDir(): string {
  return join(getConfigDir(), 'jobs');
}

/**
 * Validate that an ID is safe for filesystem operations
 */
function isSafeId(id: string): boolean {
  return SAFE_ID_PATTERN.test(id);
}

/**
 * Get the path to a job file
 */
function jobPath(id: string): string | null {
  if (!isSafeId(id)) return null;
  return join(jobsDir(), `${id}.json`);
}

/**
 * Ensure the jobs directory exists
 */
async function ensureDir(): Promise<void> {
  await mkdir(jobsDir(), { recursive: true });
}

/**
 * Save a job to disk
 */
export async function saveJob(job: Job): Promise<void> {
  await ensureDir();
  const path = jobPath(job.id);
  if (!path) {
    throw new Error(`Invalid job id: ${job.id}`);
  }
  await writeFile(path, JSON.stringify(job, null, 2), 'utf-8');
}

/**
 * Read a job from disk
 */
export async function readJob(id: string): Promise<Job | null> {
  try {
    const path = jobPath(id);
    if (!path) return null;
    const raw = await readFile(path, 'utf-8');
    const job = JSON.parse(raw) as Job;
    if (!job?.id) return null;
    return job;
  } catch {
    return null;
  }
}

/**
 * Delete a job from disk
 */
export async function deleteJob(id: string): Promise<boolean> {
  try {
    const path = jobPath(id);
    if (!path) return false;
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all jobs
 */
export async function listJobs(): Promise<Job[]> {
  try {
    const dir = jobsDir();
    const files = await readdir(dir);
    const jobs: Job[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(dir, file), 'utf-8');
        const job = JSON.parse(raw) as Job;
        if (job?.id) jobs.push(job);
      } catch {
        // Skip malformed job files
      }
    }
    return jobs;
  } catch {
    return [];
  }
}

/**
 * List jobs for a specific session
 */
export async function listJobsForSession(sessionId: string): Promise<Job[]> {
  const jobs = await listJobs();
  return jobs.filter((job) => job.sessionId === sessionId);
}

/**
 * List jobs with a specific status
 */
export async function listJobsByStatus(status: JobStatus): Promise<Job[]> {
  const jobs = await listJobs();
  return jobs.filter((job) => job.status === status);
}

/**
 * Update a job atomically
 */
export async function updateJob(
  id: string,
  updater: (job: Job) => Job
): Promise<Job | null> {
  const job = await readJob(id);
  if (!job) return null;
  const updated = updater(job);
  await saveJob(updated);
  return updated;
}

/**
 * Clean up old jobs beyond maxAge
 */
export async function cleanupOldJobs(maxAgeMs: number): Promise<number> {
  const jobs = await listJobs();
  const now = Date.now();
  let cleaned = 0;

  for (const job of jobs) {
    // Only clean up completed jobs that are old
    if (
      ['completed', 'failed', 'timeout', 'cancelled'].includes(job.status) &&
      now - job.createdAt > maxAgeMs
    ) {
      const deleted = await deleteJob(job.id);
      if (deleted) cleaned++;
    }
  }

  return cleaned;
}

/**
 * Clean up jobs for a specific session
 */
export async function cleanupSessionJobs(sessionId: string): Promise<number> {
  const jobs = await listJobsForSession(sessionId);
  let cleaned = 0;

  for (const job of jobs) {
    if (['completed', 'failed', 'timeout', 'cancelled'].includes(job.status)) {
      const deleted = await deleteJob(job.id);
      if (deleted) cleaned++;
    }
  }

  return cleaned;
}
