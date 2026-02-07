/**
 * Local JSON file storage for webhooks
 * Follows the same pattern as messages/storage/local-storage.ts
 */

import { join } from 'path';
import { homedir } from 'os';
import { mkdir, readdir, rm } from 'fs/promises';
import type {
  WebhookRegistration,
  WebhookEvent,
  WebhookDelivery,
  WebhookIndex,
  WebhookEventIndex,
  WebhookListItem,
  WebhookEventListItem,
} from '../types';
import { getRuntime } from '../../runtime';

export interface LocalStorageOptions {
  /** Base path for storage (default: ~/.assistants/webhooks) */
  basePath?: string;
}

/**
 * Get the default webhooks storage path
 */
export function getWebhooksBasePath(): string {
  const envOverride = process.env.ASSISTANTS_DIR;
  const home = envOverride && envOverride.trim() ? envOverride : homedir();
  return join(home, '.assistants', 'webhooks');
}

/**
 * Pattern for safe IDs - only alphanumeric, hyphens, and underscores allowed
 */
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Local storage for webhooks using JSON files
 *
 * Directory structure:
 *   ~/.assistants/webhooks/
 *     index.json                          - Global webhook registry index
 *     registrations/{webhookId}.json      - Webhook registration details
 *     events/{webhookId}/index.json       - Per-webhook event index
 *     events/{webhookId}/{eventId}.json   - Individual event files
 *     deliveries/{webhookId}/{dlvId}.json - Delivery records
 */
export class LocalWebhookStorage {
  private basePath: string;

  constructor(options: LocalStorageOptions = {}) {
    this.basePath = options.basePath || getWebhooksBasePath();
  }

  /**
   * Validate that an ID is safe to use in filesystem paths
   */
  private validateSafeId(id: string, idType: string): void {
    if (!id || typeof id !== 'string') {
      throw new Error(`Invalid ${idType}: must be a non-empty string`);
    }
    if (!SAFE_ID_PATTERN.test(id)) {
      throw new Error(
        `Invalid ${idType}: "${id}" contains invalid characters. Only alphanumeric characters, hyphens, and underscores are allowed.`
      );
    }
  }

  /**
   * Ensure the storage directories exist
   */
  async ensureDirectories(webhookId?: string): Promise<void> {
    const dirs = [
      mkdir(this.basePath, { recursive: true }),
      mkdir(join(this.basePath, 'registrations'), { recursive: true }),
      mkdir(join(this.basePath, 'events'), { recursive: true }),
      mkdir(join(this.basePath, 'deliveries'), { recursive: true }),
    ];

    if (webhookId) {
      this.validateSafeId(webhookId, 'webhookId');
      dirs.push(mkdir(join(this.basePath, 'events', webhookId), { recursive: true }));
      dirs.push(mkdir(join(this.basePath, 'deliveries', webhookId), { recursive: true }));
    }

    await Promise.all(dirs);
  }

  // ============================================
  // Path Helpers
  // ============================================

  private getIndexPath(): string {
    return join(this.basePath, 'index.json');
  }

  private getRegistrationPath(webhookId: string): string {
    this.validateSafeId(webhookId, 'webhookId');
    return join(this.basePath, 'registrations', `${webhookId}.json`);
  }

  private getEventIndexPath(webhookId: string): string {
    this.validateSafeId(webhookId, 'webhookId');
    return join(this.basePath, 'events', webhookId, 'index.json');
  }

  private getEventPath(webhookId: string, eventId: string): string {
    this.validateSafeId(webhookId, 'webhookId');
    this.validateSafeId(eventId, 'eventId');
    return join(this.basePath, 'events', webhookId, `${eventId}.json`);
  }

  private getDeliveryPath(webhookId: string, deliveryId: string): string {
    this.validateSafeId(webhookId, 'webhookId');
    this.validateSafeId(deliveryId, 'deliveryId');
    return join(this.basePath, 'deliveries', webhookId, `${deliveryId}.json`);
  }

  // ============================================
  // Webhook Index Operations
  // ============================================

  /**
   * Load the global webhook index
   */
  async loadIndex(): Promise<WebhookIndex> {
    try {
      const runtime = getRuntime();
      const file = runtime.file(this.getIndexPath());
      if (!(await file.exists())) {
        return { webhooks: [], lastUpdated: new Date().toISOString() };
      }
      return await file.json();
    } catch {
      return { webhooks: [], lastUpdated: new Date().toISOString() };
    }
  }

  /**
   * Save the global webhook index
   */
  async saveIndex(index: WebhookIndex): Promise<void> {
    const runtime = getRuntime();
    await mkdir(this.basePath, { recursive: true });
    index.lastUpdated = new Date().toISOString();
    await runtime.write(this.getIndexPath(), JSON.stringify(index, null, 2));
  }

  // ============================================
  // Registration Operations
  // ============================================

  /**
   * Save a webhook registration
   */
  async saveRegistration(registration: WebhookRegistration): Promise<void> {
    const runtime = getRuntime();
    await this.ensureDirectories(registration.id);

    // Save registration file
    await runtime.write(
      this.getRegistrationPath(registration.id),
      JSON.stringify(registration, null, 2)
    );

    // Update index
    const index = await this.loadIndex();
    const existing = index.webhooks.findIndex((w) => w.id === registration.id);
    const listItem: WebhookListItem = {
      id: registration.id,
      name: registration.name,
      source: registration.source,
      status: registration.status,
      deliveryCount: registration.deliveryCount,
      createdAt: registration.createdAt,
      lastDeliveryAt: registration.lastDeliveryAt,
    };

    if (existing >= 0) {
      index.webhooks[existing] = listItem;
    } else {
      index.webhooks.unshift(listItem);
    }

    await this.saveIndex(index);
  }

  /**
   * Load a webhook registration
   */
  async loadRegistration(webhookId: string): Promise<WebhookRegistration | null> {
    try {
      const runtime = getRuntime();
      const file = runtime.file(this.getRegistrationPath(webhookId));
      if (!(await file.exists())) {
        return null;
      }
      return await file.json();
    } catch {
      return null;
    }
  }

  /**
   * Delete a webhook registration
   */
  async deleteRegistration(webhookId: string): Promise<boolean> {
    try {
      const regPath = this.getRegistrationPath(webhookId);
      const runtime = getRuntime();
      const file = runtime.file(regPath);
      if (!(await file.exists())) {
        return false;
      }

      await rm(regPath);

      // Remove from index
      const index = await this.loadIndex();
      const idx = index.webhooks.findIndex((w) => w.id === webhookId);
      if (idx >= 0) {
        index.webhooks.splice(idx, 1);
        await this.saveIndex(index);
      }

      // Clean up event and delivery directories
      try {
        await rm(join(this.basePath, 'events', webhookId), { recursive: true, force: true });
        await rm(join(this.basePath, 'deliveries', webhookId), { recursive: true, force: true });
      } catch {
        // Non-critical cleanup
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all webhook registrations
   */
  async listRegistrations(): Promise<WebhookListItem[]> {
    const index = await this.loadIndex();
    return index.webhooks;
  }

  // ============================================
  // Event Operations
  // ============================================

  /**
   * Load the event index for a webhook
   */
  async loadEventIndex(webhookId: string): Promise<WebhookEventIndex> {
    try {
      const runtime = getRuntime();
      const file = runtime.file(this.getEventIndexPath(webhookId));
      if (!(await file.exists())) {
        return {
          events: [],
          lastUpdated: new Date().toISOString(),
          totalEvents: 0,
          pendingCount: 0,
        };
      }
      return await file.json();
    } catch {
      return {
        events: [],
        lastUpdated: new Date().toISOString(),
        totalEvents: 0,
        pendingCount: 0,
      };
    }
  }

  /**
   * Save the event index for a webhook
   */
  async saveEventIndex(webhookId: string, index: WebhookEventIndex): Promise<void> {
    const runtime = getRuntime();
    this.validateSafeId(webhookId, 'webhookId');
    await mkdir(join(this.basePath, 'events', webhookId), { recursive: true });
    index.lastUpdated = new Date().toISOString();
    await runtime.write(this.getEventIndexPath(webhookId), JSON.stringify(index, null, 2));
  }

  /**
   * Save a webhook event
   */
  async saveEvent(event: WebhookEvent): Promise<void> {
    const runtime = getRuntime();
    await this.ensureDirectories(event.webhookId);

    // Save event file
    await runtime.write(
      this.getEventPath(event.webhookId, event.id),
      JSON.stringify(event, null, 2)
    );

    // Update event index
    const eventIndex = await this.loadEventIndex(event.webhookId);
    const payloadStr = JSON.stringify(event.payload);
    const listItem: WebhookEventListItem = {
      id: event.id,
      source: event.source,
      eventType: event.eventType,
      preview: payloadStr.slice(0, 100) + (payloadStr.length > 100 ? '...' : ''),
      timestamp: event.timestamp,
      status: event.status,
    };

    eventIndex.events.unshift(listItem);
    eventIndex.totalEvents++;
    if (event.status === 'pending') {
      eventIndex.pendingCount++;
    }

    await this.saveEventIndex(event.webhookId, eventIndex);
  }

  /**
   * Load a specific event
   */
  async loadEvent(webhookId: string, eventId: string): Promise<WebhookEvent | null> {
    try {
      const runtime = getRuntime();
      const file = runtime.file(this.getEventPath(webhookId, eventId));
      if (!(await file.exists())) {
        return null;
      }
      return await file.json();
    } catch {
      return null;
    }
  }

  /**
   * Update event status
   */
  async updateEventStatus(
    webhookId: string,
    eventId: string,
    status: WebhookEvent['status'],
    timestamp?: string
  ): Promise<void> {
    const runtime = getRuntime();
    const event = await this.loadEvent(webhookId, eventId);
    if (!event) return;

    const oldStatus = event.status;
    event.status = status;
    if (status === 'injected' && timestamp) {
      event.injectedAt = timestamp;
    }

    await runtime.write(
      this.getEventPath(webhookId, eventId),
      JSON.stringify(event, null, 2)
    );

    // Update event index
    const eventIndex = await this.loadEventIndex(webhookId);
    const indexItem = eventIndex.events.find((e) => e.id === eventId);
    if (indexItem) {
      indexItem.status = status;
    }
    // Update pending count
    if (oldStatus === 'pending' && status !== 'pending') {
      eventIndex.pendingCount = Math.max(0, eventIndex.pendingCount - 1);
    }
    await this.saveEventIndex(webhookId, eventIndex);
  }

  /**
   * List events for a webhook
   */
  async listEvents(
    webhookId: string,
    options?: {
      limit?: number;
      pendingOnly?: boolean;
    }
  ): Promise<WebhookEventListItem[]> {
    const eventIndex = await this.loadEventIndex(webhookId);
    let events = [...eventIndex.events];

    if (options?.pendingOnly) {
      events = events.filter((e) => e.status === 'pending');
    }

    if (options?.limit && options.limit > 0) {
      events = events.slice(0, options.limit);
    }

    return events;
  }

  // ============================================
  // Delivery Operations
  // ============================================

  /**
   * Save a delivery record
   */
  async saveDelivery(delivery: WebhookDelivery): Promise<void> {
    const runtime = getRuntime();
    this.validateSafeId(delivery.webhookId, 'webhookId');
    await mkdir(join(this.basePath, 'deliveries', delivery.webhookId), { recursive: true });

    await runtime.write(
      this.getDeliveryPath(delivery.webhookId, delivery.id),
      JSON.stringify(delivery, null, 2)
    );
  }

  /**
   * List deliveries for a webhook
   */
  async listDeliveries(
    webhookId: string,
    options?: { limit?: number }
  ): Promise<WebhookDelivery[]> {
    this.validateSafeId(webhookId, 'webhookId');
    const deliveriesDir = join(this.basePath, 'deliveries', webhookId);

    try {
      const files = await readdir(deliveriesDir);
      const runtime = getRuntime();
      const deliveries: WebhookDelivery[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const deliveryFile = runtime.file(join(deliveriesDir, file));
          const delivery = await deliveryFile.json<WebhookDelivery>();
          deliveries.push(delivery);
        } catch {
          // Skip invalid files
        }
      }

      // Sort by most recent first
      deliveries.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

      if (options?.limit && options.limit > 0) {
        return deliveries.slice(0, options.limit);
      }

      return deliveries;
    } catch {
      return [];
    }
  }

  // ============================================
  // Cleanup Operations
  // ============================================

  /**
   * Clean up old events for a webhook
   */
  async cleanupEvents(webhookId: string, maxAgeDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    const cutoffTime = cutoffDate.getTime();

    const eventIndex = await this.loadEventIndex(webhookId);
    const toDelete: string[] = [];

    for (const evt of eventIndex.events) {
      const evtTime = new Date(evt.timestamp).getTime();
      if (evtTime < cutoffTime) {
        toDelete.push(evt.id);
      }
    }

    for (const id of toDelete) {
      try {
        await rm(this.getEventPath(webhookId, id));
      } catch {
        // Non-critical
      }
    }

    // Rebuild index
    eventIndex.events = eventIndex.events.filter((e) => !toDelete.includes(e.id));
    eventIndex.pendingCount = eventIndex.events.filter((e) => e.status === 'pending').length;
    await this.saveEventIndex(webhookId, eventIndex);

    return toDelete.length;
  }

  /**
   * Enforce max events limit for a webhook
   */
  async enforceMaxEvents(webhookId: string, maxEvents: number): Promise<number> {
    const eventIndex = await this.loadEventIndex(webhookId);
    if (eventIndex.events.length <= maxEvents) {
      return 0;
    }

    // Sort by date (oldest first)
    const sorted = [...eventIndex.events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const toDelete = sorted.slice(0, eventIndex.events.length - maxEvents);

    for (const evt of toDelete) {
      try {
        await rm(this.getEventPath(webhookId, evt.id));
      } catch {
        // Non-critical
      }
    }

    // Rebuild index
    const deleteIds = new Set(toDelete.map((e) => e.id));
    eventIndex.events = eventIndex.events.filter((e) => !deleteIds.has(e.id));
    eventIndex.pendingCount = eventIndex.events.filter((e) => e.status === 'pending').length;
    await this.saveEventIndex(webhookId, eventIndex);

    return toDelete.length;
  }
}
