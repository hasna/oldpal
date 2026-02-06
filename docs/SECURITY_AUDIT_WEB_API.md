# Security Audit: Web API Authentication & Rate Limiting

**Audit Date:** 2024-01-15
**Scope:** Web API endpoints in `packages/web/src/app/api/v1/`

## Executive Summary

The web API has a solid security foundation with proper JWT authentication, suspended user enforcement, and role-based access control. Rate limiting is implemented for auth endpoints but needs extension to other sensitive endpoints.

## Findings

### Authentication & Authorization

| Finding | Status | Details |
|---------|--------|---------|
| JWT Secret Validation | PASS | Production requires proper secrets, rejects defaults |
| Token Expiration | PASS | Access: 15min, Refresh: 7 days |
| Suspended User Enforcement | PASS | Checked on every authenticated request via DB lookup |
| Role Verification from DB | PASS | Role changes reflected immediately (not stale JWT) |
| Admin Role Enforcement | PASS | `withAdminAuth` middleware properly wraps `withAuth` |
| Self-Modification Protection | PASS | Admins cannot demote/suspend themselves |
| Last Admin Protection | PASS | Cannot remove last admin user |

### Rate Limiting

| Endpoint Group | Has Rate Limiting | Status |
|----------------|-------------------|--------|
| Auth (login/register/refresh) | YES | Protected |
| Chat | YES | Protected |
| Admin Users | YES | Protected (60/min) |
| Admin Audit | YES | Protected (60/min) |
| Admin System | YES | Protected (120/min relaxed) |
| Admin User Billing | YES | Protected (60/min) |
| Sessions | NO | Add API preset rate limiting |
| Messages | NO | Add API preset rate limiting |
| Assistants | NO | Add API preset rate limiting |

### Input Validation

| Finding | Status | Details |
|---------|--------|---------|
| UUID Validation | PASS | `validateUUID()` function used for ID params |
| Zod Schema Validation | PASS | Request bodies validated with Zod schemas |
| SQL Injection Protection | PASS | Drizzle ORM parameterized queries |
| XSS Protection | PASS | React auto-escapes, no raw HTML injection |

### Security Headers

| Header | Implemented | Notes |
|--------|-------------|-------|
| Rate Limit Headers | YES | X-RateLimit-* headers on 429 responses |
| Content-Type | YES | JSON responses properly typed |
| CORS | PARTIAL | Needs review for production config |

## Recommendations

### Priority 1: Add Rate Limiting to Remaining Endpoints

**COMPLETED for admin endpoints.** Rate limiting was added to:
- `/api/v1/admin/users` - 60/min (API preset)
- `/api/v1/admin/users/:id` - 60/min (API preset)
- `/api/v1/admin/users/:id/billing` - 60/min (API preset)
- `/api/v1/admin/audit` - 60/min (API preset)
- `/api/v1/admin/system` - 120/min (Relaxed preset)

**Still needed:** Add rate limiting to remaining user-facing endpoints:
- Sessions/Assistants/Messages: `RateLimitPresets.relaxed` (120/min)
- Billing webhooks: Already has Stripe signature verification

### Priority 2: Add CORS Configuration

Review and configure CORS for production:

```typescript
// middleware.ts or next.config.js
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
```

### Priority 3: Security Logging

Consider adding security event logging for:
- Failed authentication attempts
- Rate limit violations
- Admin actions (already done via audit log)
- Suspicious activity patterns

### Priority 4: Review Webhook Security

Stripe webhooks (`/api/v1/billing/webhooks/stripe`) should verify:
- Stripe signature validation (likely already done)
- IP allowlisting if applicable
- Idempotency handling

## Test Coverage

Current test coverage for auth/admin APIs:
- `api-admin-system.test.ts` - 14 tests
- `api-admin-audit.test.ts` - 17 tests
- `api-admin-users-detail.test.ts` - 13 tests
- `api-admin-users-billing.test.ts` - 17 tests

Recommended additional tests:
- Rate limiting behavior tests
- Token refresh flow tests
- Suspended user rejection tests
- Role change propagation tests

## Architecture Strengths

1. **User Status Caching** - 30-second TTL cache reduces DB load while maintaining security
2. **Cache Invalidation** - `invalidateUserStatusCache()` called on role/status changes
3. **Layered Auth** - `withAdminAuth` builds on `withAuth` for DRY code
4. **Audit Logging** - All admin actions logged with changes, metadata, IP
5. **Soft Deletes** - Users are deactivated, not hard deleted

## Files Reviewed

```
packages/web/src/lib/auth/middleware.ts - Auth middleware with DB verification
packages/web/src/lib/auth/jwt.ts - JWT token handling
packages/web/src/lib/rate-limit.ts - Rate limiting implementation
packages/web/src/lib/api/errors.ts - Error classes and validation
packages/web/src/app/api/v1/admin/users/[id]/route.ts - User management
packages/web/src/app/api/v1/admin/users/[id]/billing/route.ts - Billing management
packages/web/src/app/api/v1/admin/audit/route.ts - Audit logs
packages/web/src/app/api/v1/admin/system/route.ts - System health
```

## Conclusion

The security posture is good with proper auth patterns established. Rate limiting has been added to all admin API endpoints. Remaining endpoints (sessions, messages, assistants) should also receive rate limiting in a follow-up. No critical vulnerabilities found.
