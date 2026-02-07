import { NextRequest, NextResponse } from 'next/server';
import { setRuntime, hasRuntime } from '@hasna/assistants-core';
import { nodeRuntime } from '@hasna/runtime-node';

if (!hasRuntime()) {
  setRuntime(nodeRuntime);
}

import {
  createWebhooksManager,
  type WebhooksConfig,
} from '@hasna/assistants-core';

/**
 * Public webhook receive endpoint - NO AUTH REQUIRED
 * Security is provided via HMAC-SHA256 signature verification.
 *
 * Headers:
 *   X-Webhook-Signature: HMAC-SHA256 hex digest of the JSON body
 *   X-Webhook-Timestamp: ISO 8601 timestamp
 *   X-Webhook-Event: Event type name (e.g., "message.received")
 */

const DEFAULT_CONFIG: WebhooksConfig = {
  enabled: true,
  injection: { enabled: true, maxPerTurn: 5 },
  storage: { maxEvents: 1000, maxAgeDays: 30 },
  security: { maxTimestampAgeMs: 300_000, rateLimitPerMinute: 60 },
};

// Max body size: 100KB
const MAX_BODY_SIZE = 100_000;

// POST /api/v1/webhooks/receive/[webhookId]
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ webhookId: string }> }
) {
  try {
    const { webhookId } = await params;

    if (!webhookId) {
      return NextResponse.json(
        { error: 'Missing webhook ID' },
        { status: 400 }
      );
    }

    // Read headers
    const signature = request.headers.get('x-webhook-signature');
    const timestamp = request.headers.get('x-webhook-timestamp');
    const eventType = request.headers.get('x-webhook-event') || 'unknown';

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing X-Webhook-Signature header' },
        { status: 400 }
      );
    }

    if (!timestamp) {
      return NextResponse.json(
        { error: 'Missing X-Webhook-Timestamp header' },
        { status: 400 }
      );
    }

    // Read body
    const bodyText = await request.text();
    if (bodyText.length > MAX_BODY_SIZE) {
      return NextResponse.json(
        { error: `Body too large. Maximum size is ${MAX_BODY_SIZE} bytes.` },
        { status: 413 }
      );
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    // Get remote IP if available
    const remoteIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      undefined;

    // Create a manager with default config.
    // The webhookId embeds the owner context - the storage path contains it.
    const manager = createWebhooksManager('default', DEFAULT_CONFIG);
    await manager.initialize();

    const result = await manager.receiveEvent({
      webhookId,
      payload,
      signature,
      timestamp,
      eventType,
      remoteIp,
    });

    if (result.success) {
      return NextResponse.json(
        {
          ok: true,
          deliveryId: result.deliveryId,
          eventId: result.eventId,
        },
        { status: 200 }
      );
    }

    // Determine HTTP status based on error
    let status = 400;
    if (result.message.includes('not found') || result.message.includes('not active')) {
      status = 404;
    } else if (result.message.includes('Invalid signature')) {
      status = 401;
    } else if (result.message.includes('Rate limit')) {
      status = 429;
    } else if (result.message.includes('Timestamp')) {
      status = 400;
    }

    return NextResponse.json(
      { error: result.message },
      { status }
    );
  } catch (error) {
    console.error('Webhook receive error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
