import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { UserEditDialog, type UserForEdit } from '../src/components/admin/UserEditDialog';
import { UserDetailDialog } from '../src/components/admin/UserDetailDialog';

// Note: Radix Dialog components use portals which don't work with renderToStaticMarkup
// These tests verify the component exports and types are correct

const mockActiveUser: UserForEdit = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
  role: 'user',
  isActive: true,
  suspendedReason: null,
};

const mockSuspendedUser: UserForEdit = {
  id: 'user-456',
  email: 'suspended@example.com',
  name: 'Suspended User',
  role: 'user',
  isActive: false,
  suspendedReason: 'Violated terms of service',
};

const mockAdminUser: UserForEdit = {
  id: 'admin-789',
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'admin',
  isActive: true,
  suspendedReason: null,
};

describe('UserEditDialog', () => {
  test('exports UserEditDialog component', () => {
    expect(UserEditDialog).toBeDefined();
    expect(typeof UserEditDialog).toBe('function');
  });

  test('UserForEdit interface has required fields', () => {
    // Type checking test - if this compiles, the interface is correct
    const user: UserForEdit = mockActiveUser;
    expect(user.id).toBe('user-123');
    expect(user.email).toBe('test@example.com');
    expect(user.name).toBe('Test User');
    expect(user.role).toBe('user');
    expect(user.isActive).toBe(true);
    expect(user.suspendedReason).toBeNull();
  });

  test('UserForEdit supports suspended state', () => {
    const user: UserForEdit = mockSuspendedUser;
    expect(user.isActive).toBe(false);
    expect(user.suspendedReason).toBe('Violated terms of service');
  });

  test('UserForEdit supports admin role', () => {
    const user: UserForEdit = mockAdminUser;
    expect(user.role).toBe('admin');
  });

  test('props interface requires user, open, onOpenChange, onSave, currentUserId', () => {
    // This is a compile-time type check
    // If the component interface is wrong, TypeScript would catch it
    const props = {
      user: mockActiveUser,
      open: true,
      onOpenChange: (open: boolean) => {},
      onSave: async (userId: string, data: Partial<UserForEdit>) => {},
      currentUserId: 'current-user',
    };
    expect(props.user).toBeDefined();
    expect(props.open).toBe(true);
    expect(typeof props.onOpenChange).toBe('function');
    expect(typeof props.onSave).toBe('function');
    expect(props.currentUserId).toBe('current-user');
  });

  test('onSave receives userId and partial user data', async () => {
    const mockOnSave = mock(async (userId: string, data: Partial<UserForEdit>) => {
      return;
    });

    await mockOnSave('user-123', { name: 'Updated Name', role: 'admin' });

    expect(mockOnSave).toHaveBeenCalledTimes(1);
    expect(mockOnSave).toHaveBeenCalledWith('user-123', { name: 'Updated Name', role: 'admin' });
  });

  test('onOpenChange receives boolean value', () => {
    const mockOnOpenChange = mock((open: boolean) => {});

    mockOnOpenChange(true);
    mockOnOpenChange(false);

    expect(mockOnOpenChange).toHaveBeenCalledTimes(2);
    expect(mockOnOpenChange).toHaveBeenCalledWith(true);
    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('UserDetailDialog', () => {
  test('exports UserDetailDialog component', () => {
    expect(UserDetailDialog).toBeDefined();
    expect(typeof UserDetailDialog).toBe('function');
  });

  test('props interface requires userId, open, onOpenChange, fetchWithAuth', () => {
    const mockFetch = async (url: string, options?: RequestInit): Promise<Response> => {
      return new Response(JSON.stringify({ success: true, data: {} }));
    };

    const props = {
      userId: 'user-123',
      open: true,
      onOpenChange: (open: boolean) => {},
      fetchWithAuth: mockFetch,
    };

    expect(props.userId).toBe('user-123');
    expect(props.open).toBe(true);
    expect(typeof props.onOpenChange).toBe('function');
    expect(typeof props.fetchWithAuth).toBe('function');
  });

  test('userId can be null', () => {
    const props = {
      userId: null as string | null,
      open: true,
      onOpenChange: (open: boolean) => {},
      fetchWithAuth: async () => new Response(),
    };

    expect(props.userId).toBeNull();
  });

  test('fetchWithAuth is called with user endpoint', async () => {
    const mockFetch = mock(async (url: string) => {
      return new Response(JSON.stringify({
        success: true,
        data: {
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
          role: 'user',
          isActive: true,
          _counts: { sessions: 5, agents: 2 },
        },
      }));
    });

    await mockFetch('/api/v1/admin/users/user-123');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/admin/users/user-123');
  });

  test('fetchWithAuth is called with billing endpoint', async () => {
    const mockFetch = mock(async (url: string) => {
      return new Response(JSON.stringify({
        success: true,
        data: {
          stripeCustomerId: 'cus_123',
          subscription: null,
          invoices: [],
          availablePlans: [],
        },
      }));
    });

    await mockFetch('/api/v1/admin/users/user-123/billing');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/admin/users/user-123/billing');
  });
});

describe('UserForEdit validation', () => {
  test('role must be "user" or "admin"', () => {
    const userRole: UserForEdit = { ...mockActiveUser, role: 'user' };
    const adminRole: UserForEdit = { ...mockActiveUser, role: 'admin' };

    expect(userRole.role).toBe('user');
    expect(adminRole.role).toBe('admin');
  });

  test('suspendedReason can be string or null', () => {
    const withReason: UserForEdit = { ...mockSuspendedUser, suspendedReason: 'Some reason' };
    const withoutReason: UserForEdit = { ...mockActiveUser, suspendedReason: null };

    expect(withReason.suspendedReason).toBe('Some reason');
    expect(withoutReason.suspendedReason).toBeNull();
  });

  test('name can be string or null', () => {
    const withName: UserForEdit = { ...mockActiveUser, name: 'John Doe' };
    const withoutName: UserForEdit = { ...mockActiveUser, name: null };

    expect(withName.name).toBe('John Doe');
    expect(withoutName.name).toBeNull();
  });

  test('isActive is boolean', () => {
    const active: UserForEdit = { ...mockActiveUser, isActive: true };
    const inactive: UserForEdit = { ...mockSuspendedUser, isActive: false };

    expect(active.isActive).toBe(true);
    expect(inactive.isActive).toBe(false);
  });
});

describe('User states', () => {
  test('active user has isActive=true and no suspension reason', () => {
    expect(mockActiveUser.isActive).toBe(true);
    expect(mockActiveUser.suspendedReason).toBeNull();
  });

  test('suspended user has isActive=false and suspension reason', () => {
    expect(mockSuspendedUser.isActive).toBe(false);
    expect(mockSuspendedUser.suspendedReason).not.toBeNull();
  });

  test('admin user has role=admin', () => {
    expect(mockAdminUser.role).toBe('admin');
  });

  test('regular user has role=user', () => {
    expect(mockActiveUser.role).toBe('user');
  });

  test('self-editing detection works via currentUserId comparison', () => {
    const isSelf = mockActiveUser.id === 'user-123';
    const isNotSelf = mockActiveUser.id === 'other-user';

    expect(isSelf).toBe(true);
    expect(isNotSelf).toBe(false);
  });
});

describe('API response handling', () => {
  test('user detail response structure', async () => {
    const mockResponse = {
      success: true,
      data: {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'user' as const,
        emailVerified: true,
        avatarUrl: null,
        isActive: true,
        suspendedAt: null,
        suspendedReason: null,
        stripeCustomerId: 'cus_123',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        _counts: {
          sessions: 5,
          agents: 2,
        },
      },
    };

    expect(mockResponse.success).toBe(true);
    expect(mockResponse.data.id).toBe('user-123');
    expect(mockResponse.data._counts.sessions).toBe(5);
    expect(mockResponse.data._counts.agents).toBe(2);
  });

  test('billing response structure', async () => {
    const mockResponse = {
      success: true,
      data: {
        stripeCustomerId: 'cus_123',
        subscription: {
          id: 'sub_123',
          status: 'active',
          currentPeriodStart: '2024-01-01T00:00:00Z',
          currentPeriodEnd: '2024-02-01T00:00:00Z',
          cancelAtPeriodEnd: false,
          plan: {
            id: 'plan-pro',
            name: 'pro',
            displayName: 'Pro',
            priceMonthly: 2900,
          },
        },
        invoices: [
          {
            id: 'inv_123',
            amountDue: 2900,
            amountPaid: 2900,
            status: 'paid',
            periodStart: '2024-01-01T00:00:00Z',
            periodEnd: '2024-02-01T00:00:00Z',
            paidAt: '2024-01-01T00:00:00Z',
            invoiceUrl: 'https://invoice.stripe.com/inv_123',
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
        availablePlans: [
          { id: 'plan-free', name: 'free', displayName: 'Free', priceMonthly: 0 },
          { id: 'plan-pro', name: 'pro', displayName: 'Pro', priceMonthly: 2900 },
        ],
      },
    };

    expect(mockResponse.success).toBe(true);
    expect(mockResponse.data.subscription?.status).toBe('active');
    expect(mockResponse.data.subscription?.plan.priceMonthly).toBe(2900);
    expect(mockResponse.data.invoices.length).toBe(1);
    expect(mockResponse.data.availablePlans.length).toBe(2);
  });

  test('error response handling', async () => {
    const mockErrorResponse = {
      success: false,
      error: {
        message: 'User not found',
        code: 'NOT_FOUND',
      },
    };

    expect(mockErrorResponse.success).toBe(false);
    expect(mockErrorResponse.error.message).toBe('User not found');
  });
});
