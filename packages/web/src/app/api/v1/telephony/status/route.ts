/**
 * Twilio Status Callback
 *
 * Handles call status updates from Twilio (initiated, ringing, answered, completed).
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

// POST /api/v1/telephony/status - Twilio status callback
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const params: Record<string, string> = {};
    formData.forEach((value, key) => {
      params[key] = String(value);
    });

    const callSid = params.CallSid || '';
    const callStatus = params.CallStatus || '';
    const callDuration = params.CallDuration;

    // Validate Twilio signature
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (authToken) {
      const signature = request.headers.get('x-twilio-signature') || '';
      const url = request.url;
      if (!validateTwilioSignature(authToken, url, params, signature)) {
        return new NextResponse('Forbidden', { status: 403 });
      }
    }

    // Update call log
    const manager = createTelephonyManager('system', 'system', DEFAULT_CONFIG);
    const store = manager.getStore();
    const callLog = store.getCallLogBySid(callSid);

    if (callLog) {
      const updates: Record<string, unknown> = {};

      // Map Twilio status to our status
      const statusMap: Record<string, string> = {
        initiated: 'pending',
        ringing: 'ringing',
        'in-progress': 'in-progress',
        completed: 'completed',
        busy: 'busy',
        'no-answer': 'no-answer',
        canceled: 'canceled',
        failed: 'failed',
      };

      if (callStatus && statusMap[callStatus]) {
        (updates as any).status = statusMap[callStatus];
      }

      if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'canceled') {
        (updates as any).endedAt = new Date().toISOString();
        if (callDuration) {
          (updates as any).duration = parseInt(callDuration, 10);
        }
      }

      if (callStatus === 'in-progress') {
        (updates as any).startedAt = new Date().toISOString();
      }

      if (Object.keys(updates).length > 0) {
        store.updateCallLog(callLog.id, updates as any);
      }
    }

    return new NextResponse('OK', { status: 200 });
  } catch (error) {
    console.error('Status callback error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
