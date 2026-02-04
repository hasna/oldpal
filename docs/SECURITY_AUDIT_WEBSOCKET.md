# Security Audit: WebSocket & Realtime Transport

**Audit Date:** 2024-01-15
**Scope:** WebSocket implementation in `packages/web/src/pages/api/v1/ws.ts`

## Executive Summary

The WebSocket implementation has solid security foundations with proper origin validation, payload limits, session ownership enforcement, and authentication support. A few minor improvements are recommended but no critical vulnerabilities were found.

## Findings

### Origin Validation (CSWSH Protection)

| Finding | Status | Details |
|---------|--------|---------|
| Origin Header Check | PASS | Validates Origin header on connection |
| Production Deny-by-Default | PASS | Rejects all origins when allowlist empty in production |
| Safe URL Parsing | PASS | Uses try/catch to prevent crash on malformed URLs |
| Configurable Allowlist | PASS | Supports `WS_ALLOWED_ORIGINS` env var |
| Development Convenience | PASS | Allows localhost ports only in development |

**Implementation:** `packages/web/src/pages/api/v1/ws.ts:36-106`

```typescript
// Production: Requires explicit origin allowlist
if (isProduction && allowedOrigins.length === 0) {
  return false; // Deny by default
}

// Validates against: WS_ALLOWED_ORIGINS, NEXT_PUBLIC_URL
return allowedOrigins.includes(origin);
```

### Payload Size Limits

| Finding | Status | Details |
|---------|--------|---------|
| Max Payload Size | PASS | 1MB limit enforced at WebSocket server level |
| Max Message Content | PASS | 100KB limit for chat message content |
| Defense in Depth | PASS | Both server-level and application-level checks |

**Implementation:** `packages/web/src/pages/api/v1/ws.ts:12-15, 362-366, 417-420`

```typescript
const MAX_MESSAGE_LENGTH = 100_000;  // 100KB for message content
const MAX_PAYLOAD_SIZE = 1_000_000;  // 1MB total payload

// Server-level limit
new WebSocketServer({ server, maxPayload: MAX_PAYLOAD_SIZE });

// Application-level check
if (rawData.length > MAX_PAYLOAD_SIZE) {
  sendMessage(ws, { type: 'error', message: 'Payload too large' });
  ws.close(1009, 'Message too big');
}
```

### Authentication

| Finding | Status | Details |
|---------|--------|---------|
| JWT Token Validation | PASS | Uses `verifyAccessToken()` from auth module |
| Token in URL (Legacy) | PARTIAL | Supported but less secure (logged in URLs) |
| Token in Auth Message | PASS | Recommended secure method |
| Invalid Token Handling | PASS | Closes connection with 1008 code |

**Implementation:** `packages/web/src/pages/api/v1/ws.ts:202-203, 378-386`

```typescript
// Secure auth via message (recommended)
if (message.type === 'auth' && 'token' in message) {
  const authResult = await verifyAccessToken(String(message.token));
  // ...
}

// Legacy URL parameter (still supported)
const token = url.searchParams.get('token');
```

### Session Ownership & Isolation

| Finding | Status | Details |
|---------|--------|---------|
| Session UUID Validation | PASS | Uses `isValidUUID()` to prevent injection |
| Database Ownership Check | PASS | Verifies userId matches session owner |
| Multi-Connection Tracking | PASS | Reference counting for same-user multiple connections |
| Cross-Session Protection | PASS | Can't access other users' sessions |

**Implementation:** `packages/web/src/pages/api/v1/ws.ts:108-130, 260-296`

```typescript
// Validate session ownership from database
if (session.userId !== authenticatedUserId) {
  sendMessage(ws, { type: 'error', message: 'Access denied for session' });
  return false;
}
```

### Message Validation

| Finding | Status | Details |
|---------|--------|---------|
| JSON Parse Error Handling | PASS | Closes with 1003 code on invalid JSON |
| Message Type Validation | PASS | Only handles known message types |
| Content Length Validation | PASS | Enforces MAX_MESSAGE_LENGTH |

**Implementation:** `packages/web/src/pages/api/v1/ws.ts:368-375`

```typescript
try {
  message = JSON.parse(rawData);
} catch {
  sendMessage(ws, { type: 'error', message: 'Invalid JSON' });
  ws.close(1003, 'Unsupported data');
  return;
}
```

### Connection Lifecycle

| Finding | Status | Details |
|---------|--------|---------|
| Cleanup on Close | PASS | Unsubscribes and releases session ownership |
| Agent Stop on Disconnect | PASS | Calls `stopSession()` to halt processing |
| Concurrent Send Protection | PASS | Guards against message ID clobbering |

**Implementation:** `packages/web/src/pages/api/v1/ws.ts:479-488`

```typescript
ws.on('close', async () => {
  if (sessionId) await stopSession(sessionId);
  if (unsubscribe) unsubscribe();
  if (sessionId && ownerKey) releaseSessionOwner(sessionId, ownerKey);
});
```

### Rate Limiting

| Finding | Status | Details |
|---------|--------|---------|
| Connection Rate Limit | PASS | 10 connections per IP per minute |
| Message Rate Limit | PASS | 60 messages per session per minute |

**Implementation:** `packages/web/src/pages/api/v1/ws.ts:17-73`

```typescript
const CONNECTION_RATE_LIMIT = 10; // Max connections per IP per window
const MESSAGE_RATE_LIMIT = 60;    // Max messages per session per window

// Rate limited on connection
if (isConnectionRateLimited(clientIp)) {
  ws.close(1008, 'Too many connections');
}

// Rate limited on message send
if (isMessageRateLimited(sessionId)) {
  sendMessage(ws, { type: 'error', message: 'Rate limit exceeded' });
}
```

### User Status Verification

| Finding | Status | Details |
|---------|--------|---------|
| Suspended User Check | PASS | Verified on authentication |
| User Existence Check | PASS | Returns error if user not found |

**Implementation:** `packages/web/src/pages/api/v1/ws.ts:86-96, 341-356`

```typescript
// Check user status from database
const userStatus = await getUserStatus(auth.userId);
if (!userStatus) {
  sendMessage(ws, { type: 'error', message: 'User account not found' });
  ws.close(1008);
}
if (!userStatus.isActive) {
  sendMessage(ws, { type: 'error', message: 'Account suspended' });
  ws.close(1008);
}
```

## Implemented Mitigations

### Rate Limiting (Implemented)

Connection and message rate limiters have been added:

- **Connection Rate Limit:** 10 connections per IP per minute
- **Message Rate Limit:** 60 messages per session per minute
- **Automatic Cleanup:** Expired rate limit entries are cleaned up every 5 minutes

### Suspended User Check (Implemented)

User status is verified on authentication:

- Checks if user exists in database
- Checks if user account is active (not suspended)
- Closes connection with appropriate error message if checks fail

## Remaining Recommendations

### Priority 1: Add Connection Logging

Log WebSocket connections for security monitoring:

```typescript
// On connection success
console.log(`[WS] Connection: ip=${clientIp} userId=${userId} origin=${origin}`);

// On suspicious activity
console.warn(`[WS] Rate limited: ip=${clientIp}`);
```

## Test Coverage

Current test coverage:
- `api-ws.test.ts` - Basic message handling and cancel functionality
- `ws.test.ts` - Client-side WebSocket class

Recommended additional tests:
- Origin validation edge cases
- Payload size limit enforcement
- Invalid JSON handling
- Session ownership verification
- Token authentication flows

## Architecture Strengths

1. **Defense in Depth** - Both server-level and application-level payload limits
2. **Secure Token Option** - Auth message method avoids URL logging
3. **Proper RFC 6455 Codes** - Uses correct close codes (1003, 1008, 1009)
4. **Session Isolation** - Multi-user isolation with ownership tracking
5. **Graceful Degradation** - Ignores persistence errors to maintain connection

## Files Reviewed

```
packages/web/src/pages/api/v1/ws.ts - WebSocket server handler
packages/web/src/lib/ws.ts - Client-side WebSocket class
packages/web/src/lib/protocol.ts - Message type definitions
packages/web/tests/api-ws.test.ts - Server tests
packages/web/tests/ws.test.ts - Client tests
```

## Conclusion

The WebSocket implementation has a comprehensive security posture with:

1. **Origin validation** - CSWSH protection with configurable allowlist
2. **Payload limits** - 1MB total, 100KB message content
3. **Session ownership** - Database-verified user/session association
4. **Rate limiting** - Connection (10/min per IP) and message (60/min per session) limits
5. **User status verification** - Suspended user check on authentication

No critical vulnerabilities found. The implementation effectively prevents cross-site WebSocket hijacking, DoS attacks, payload-based attacks, and unauthorized session access.
