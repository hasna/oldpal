/**
 * Twilio Voice Webhook
 *
 * Handles incoming voice calls from Twilio.
 * Returns TwiML to connect the caller to a Media Stream WebSocket.
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
} from '@hasna/assistants-core';

const DEFAULT_CONFIG = {
  enabled: true,
  injection: { enabled: true, maxPerTurn: 5 },
  storage: { maxCallLogs: 5000, maxSmsLogs: 5000, maxAgeDays: 90 },
};

// POST /api/v1/telephony/voice - Twilio voice webhook
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const params: Record<string, string> = {};
    formData.forEach((value, key) => {
      params[key] = String(value);
    });

    const callSid = params.CallSid || '';
    const from = params.From || '';
    const to = params.To || '';

    // Validate Twilio signature if auth token is set
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (authToken) {
      const signature = request.headers.get('x-twilio-signature') || '';
      const url = request.url;
      if (!validateTwilioSignature(authToken, url, params, signature)) {
        return new NextResponse('Forbidden', { status: 403 });
      }
    }

    // Log the incoming call via store
    const manager = createTelephonyManager('system', 'system', DEFAULT_CONFIG);
    const store = manager.getStore();

    // Resolve routing to find target assistant
    const routing = store.resolveRouting({ fromNumber: from, toNumber: to, messageType: 'voice' });

    store.createCallLog({
      callSid,
      fromNumber: from,
      toNumber: to,
      direction: 'inbound',
      status: 'ringing',
      assistantId: routing?.assistantId || undefined,
    });

    // Get the WebSocket URL for media streaming
    const wsUrl = process.env.TELEPHONY_WS_URL || `wss://${request.headers.get('host')}/api/v1/telephony/stream`;

    // Return TwiML to connect to media stream
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hello. You are now connected to the assistant.</Say>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="callSid" value="${callSid}" />
    </Stream>
  </Connect>
</Response>`;

    manager.close();

    return new NextResponse(twiml, {
      headers: { 'Content-Type': 'application/xml' },
    });
  } catch (error) {
    console.error('Voice webhook error:', error);
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>Sorry, an error occurred. Please try again later.</Say></Response>`;
    return new NextResponse(errorTwiml, {
      headers: { 'Content-Type': 'application/xml' },
    });
  }
}
