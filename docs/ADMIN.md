# Admin Dashboard Documentation

The admin dashboard provides user management, audit logging, and system monitoring capabilities for administrators.

## Access Control

Admin features require the `admin` role. Users with the `user` role will receive a 403 Forbidden response when attempting to access admin endpoints or pages.

## Admin Pages

| Page | URL | Description |
|------|-----|-------------|
| Dashboard | `/admin/stats` | System statistics and health monitoring |
| Users | `/admin/users` | User management and search |
| Audit Log | `/admin/audit` | View admin action history |

## User Management

### User Fields

The users table includes these admin-relevant fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | User identifier |
| `email` | string | User email address |
| `name` | string | Display name |
| `role` | enum | `user` or `admin` |
| `isActive` | boolean | Whether the user can log in |
| `suspendedAt` | timestamp | When the user was suspended |
| `suspendedReason` | string | Reason for suspension |
| `stripeCustomerId` | string | Stripe customer identifier |
| `createdAt` | timestamp | Account creation date |
| `updatedAt` | timestamp | Last modification date |

### User Actions

Admins can perform the following actions on users:

1. **View Details** - See full user profile with session/agent counts
2. **Edit User** - Update name, email, role, and suspension status
3. **Suspend User** - Disable login with a reason
4. **Activate User** - Re-enable a suspended user
5. **Delete User** - Soft-delete (sets `isActive: false`)

### Restrictions

- Admins cannot demote themselves
- Admins cannot suspend themselves
- Cannot demote the last admin user
- Cannot delete the last admin user

## Billing Management

Admins can view and manage user billing:

- View subscription status and plan
- View recent invoices
- Override subscription plan (promotional upgrades, etc.)

## Audit Logging

All admin actions are logged to the `admin_audit_logs` table.

### Audit Log Schema

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Log entry identifier |
| `adminUserId` | UUID | Admin who performed the action |
| `action` | string | Action type (see below) |
| `targetType` | string | Type of entity affected |
| `targetId` | UUID | ID of the affected entity |
| `changes` | JSON | Before/after values for modifications |
| `metadata` | JSON | Additional context |
| `ipAddress` | string | Admin's IP address |
| `createdAt` | timestamp | When the action occurred |

### Action Types

| Action | Description |
|--------|-------------|
| `user.update` | User profile or role modified |
| `user.delete` | User account deleted |
| `user.suspend` | User suspended |
| `user.activate` | User activated |
| `billing.override` | Subscription plan changed |

### Filtering

The audit log supports filtering by:
- **Action** - Filter by action type
- **Target Type** - Filter by entity type (user, subscription)
- **Admin ID** - Filter by specific admin
- **Date Range** - Filter by start/end dates

## API Endpoints

All admin endpoints require the `Authorization: Bearer <token>` header with a valid admin token.

### System Health

```
GET /api/v1/admin/system
```

Returns system health status, database latency, and activity metrics.

**Query Parameters:**
- `check` - Optional. `health` or `active-sessions` for specific checks.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "database": {
      "status": "connected",
      "latencyMs": 5
    },
    "activity": {
      "activeSessionsLastHour": 10,
      "activeUsersLastHour": 5
    },
    "timestamp": "2024-01-15T10:00:00.000Z"
  }
}
```

### List Users

```
GET /api/v1/admin/users
```

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20, max: 100)
- `search` - Search in name/email
- `role` - Filter by role (`user` or `admin`)
- `status` - Filter by status (`active` or `suspended`)
- `sortBy` - Sort column (`email`, `name`, `role`, `createdAt`)
- `sortDir` - Sort direction (`asc` or `desc`)

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "email": "user@example.com",
        "name": "User Name",
        "role": "user",
        "emailVerified": true,
        "isActive": true,
        "createdAt": "2024-01-15T10:00:00.000Z"
      }
    ],
    "total": 50,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

### Get User Details

```
GET /api/v1/admin/users/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "User Name",
    "role": "user",
    "emailVerified": true,
    "avatarUrl": null,
    "isActive": true,
    "suspendedAt": null,
    "suspendedReason": null,
    "stripeCustomerId": "cus_xxx",
    "createdAt": "2024-01-15T10:00:00.000Z",
    "updatedAt": "2024-01-15T10:00:00.000Z",
    "_counts": {
      "sessions": 5,
      "agents": 2
    }
  }
}
```

### Update User

```
PATCH /api/v1/admin/users/:id
```

**Request Body:**
```json
{
  "name": "New Name",
  "email": "newemail@example.com",
  "role": "admin",
  "isActive": false,
  "suspendedReason": "Violation of terms"
}
```

All fields are optional.

### Delete User

```
DELETE /api/v1/admin/users/:id
```

Performs a soft-delete (sets `isActive: false` with reason "Account deleted by admin").

### Get User Billing

```
GET /api/v1/admin/users/:id/billing
```

**Response:**
```json
{
  "success": true,
  "data": {
    "stripeCustomerId": "cus_xxx",
    "subscription": {
      "id": "sub_xxx",
      "status": "active",
      "currentPeriodStart": "2024-01-01T00:00:00.000Z",
      "currentPeriodEnd": "2024-02-01T00:00:00.000Z",
      "cancelAtPeriodEnd": false,
      "plan": {
        "id": "plan_xxx",
        "name": "pro",
        "displayName": "Pro Plan",
        "priceMonthly": 2900
      }
    },
    "invoices": [
      {
        "id": "inv_xxx",
        "amountDue": 2900,
        "amountPaid": 2900,
        "status": "paid",
        "periodStart": "2024-01-01T00:00:00.000Z",
        "periodEnd": "2024-02-01T00:00:00.000Z",
        "paidAt": "2024-01-01T00:00:00.000Z",
        "invoiceUrl": "https://stripe.com/invoice/xxx",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "availablePlans": [
      {
        "id": "plan_xxx",
        "name": "free",
        "displayName": "Free",
        "priceMonthly": 0
      }
    ]
  }
}
```

### Override User Plan

```
POST /api/v1/admin/users/:id/billing/override
```

**Request Body:**
```json
{
  "planId": "plan_uuid",
  "reason": "Promotional upgrade"
}
```

### List Audit Logs

```
GET /api/v1/admin/audit
```

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20, max: 100)
- `action` - Filter by action type
- `adminId` - Filter by admin user ID
- `targetType` - Filter by target type
- `startDate` - Filter from date (YYYY-MM-DD)
- `endDate` - Filter to date (YYYY-MM-DD)

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "action": "user.update",
        "targetType": "user",
        "targetId": "user_uuid",
        "changes": {
          "name": {
            "old": "Old Name",
            "new": "New Name"
          }
        },
        "metadata": null,
        "ipAddress": "192.168.1.1",
        "createdAt": "2024-01-15T10:00:00.000Z",
        "adminUser": {
          "id": "admin_uuid",
          "email": "admin@example.com",
          "name": "Admin User"
        }
      }
    ],
    "total": 100,
    "page": 1,
    "limit": 20,
    "totalPages": 5
  }
}
```

## Error Responses

All admin endpoints return standard error responses:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid auth token |
| `FORBIDDEN` | 403 | User is not an admin |
| `NOT_FOUND` | 404 | Requested resource not found |
| `BAD_REQUEST` | 400 | Invalid request parameters |
| `INTERNAL_ERROR` | 500 | Server error |

## Security Considerations

1. **Role Enforcement** - All admin endpoints verify the user has `role: admin`
2. **Self-Protection** - Admins cannot modify their own role or suspend themselves
3. **Last Admin Protection** - System prevents demoting or deleting the last admin
4. **Audit Trail** - All admin actions are logged with IP addresses
5. **Suspended User Enforcement** - Suspended users are blocked at the auth middleware level

## Database Migrations

The admin features require these database tables:

- `users` - Core user table with `isActive`, `suspendedAt`, `suspendedReason` fields
- `admin_audit_logs` - Audit log entries
- `subscriptions` - User subscriptions (for billing management)
- `subscription_plans` - Available plans
- `invoices` - Invoice history

Run migrations:
```bash
pnpm db:push
```
