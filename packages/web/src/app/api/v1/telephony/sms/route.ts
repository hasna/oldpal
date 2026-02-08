/**
 * Twilio SMS/WhatsApp Webhook
 *
 * Handles incoming SMS and WhatsApp messages from Twilio.
 */

import { NextRequest, NextResponse } from 'next/server';
import { setRuntime, hasRuntime } from '@hasna/assistants-core';
import { nodeRuntime } from '@hasna/runtime-node';

if (!hasRuntime()) {
  setRuntime(nodeRuntime);
}

import {
  createTelephonyManager,
  validateTwilioSignature,
  type MessageType,
} from '@hasna/assistants-core';

const DEFAULT_CONFIG = {
  enabled: true,
  injection: { enabled: true, maxPerTurn: 5 },
  storage: { maxCallLogs: 5000, maxSmsLogs: 5000, maxAgeDays: 90 },
};

// POST /api/v1/telephony/sms - Twilio SMS/WhatsApp webhook
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const params: Record<string, string> = {};
    formData.forEach((value, key) => {
      params[key] = String(value);
    });

    const messageSid = params.MessageSid || '';
    const from = params.From || '';
    const to = params.To || '';
    const body = params.Body || '';

    // Validate Twilio signature
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (authToken) {
      const signature = request.headers.get('x-twilio-signature') || '';
      const url = request.url;
      if (!validateTwilioSignature(authToken, url, params, signature)) {
        return new NextResponse('Forbidden', { status: 403 });
      }
    }

    // Detect message type (WhatsApp uses whatsapp: prefix)
    const messageType: MessageType = from.startsWith('whatsapp:') ? 'whatsapp' : 'sms';

    // Log the incoming message via store
    const manager = createTelephonyManager('system', 'system', DEFAULT_CONFIG);
    const store = manager.getStore();

    // Resolve routing to find target assistant
    const routing = store.resolveRouting({
      fromNumber: from,
      toNumber: to,
      messageType,
      body,
    });

    store.createSmsLog({
      messageSid,
      fromNumber: from,
      toNumber: to,
      direction: 'inbound',
      messageType,
      body,
      status: 'received',
      assistantId: routing?.assistantId || undefined,
    });

    manager.close();

    // Return empty TwiML (no auto-reply)
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
    return new NextResponse(twiml, {
      headers: { 'Content-Type': 'application/xml' },
    });
  } catch (error) {
    console.error('SMS webhook error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
