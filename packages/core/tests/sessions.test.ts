import { describe, expect, test, beforeEach, mock, spyOn } from 'bun:test';
import { SessionRegistry, type SessionInfo } from '../src/sessions/registry';
import { EmbeddedClient } from '../src/client';
import type { StreamChunk } from '@oldpal/shared';

// Mock EmbeddedClient to avoid actual initialization
const createMockClient = (sessionId: string, cwd: string) => {
  const chunkCallbacks: ((chunk: StreamChunk) => void)[] = [];
  const errorCallbacks: ((error: Error) => void)[] = [];

  return {
    getSessionId: () => sessionId,
    getCwd: () => cwd,
    initialize: async () => {},
    onChunk: (cb: (chunk: StreamChunk) => void) => chunkCallbacks.push(cb),
    onError: (cb: (error: Error) => void) => errorCallbacks.push(cb),
    disconnect: () => {},
    stop: () => {},
    send: async () => {},
    isProcessing: () => false,
    getTokenUsage: () => ({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      maxContextTokens: 200000,
    }),
    getMessages: () => [],
    // Helper to emit chunks for testing
    _emitChunk: (chunk: StreamChunk) => {
      for (const cb of chunkCallbacks) {
        cb(chunk);
      }
    },
    _emitError: (error: Error) => {
      for (const cb of errorCallbacks) {
        cb(error);
      }
    },
  };
};

describe('SessionRegistry', () => {
  let registry: SessionRegistry;
  let mockClientCounter = 0;

  // Store mock clients for verification
  let createdMockClients: ReturnType<typeof createMockClient>[] = [];

  beforeEach(() => {
    registry = new SessionRegistry();
    mockClientCounter = 0;
    createdMockClients = [];

    // Mock EmbeddedClient constructor
    // Note: We'll test with a real instance approach since mocking constructors
    // in Bun is complex. Instead, we'll test the registry's behavior independently.
  });

  describe('basic session management', () => {
    test('should start with no sessions', () => {
      expect(registry.getSessionCount()).toBe(0);
      expect(registry.listSessions()).toEqual([]);
      expect(registry.getActiveSession()).toBeNull();
      expect(registry.getActiveSessionId()).toBeNull();
    });

    test('getSession should return null for non-existent session', () => {
      expect(registry.getSession('non-existent-id')).toBeNull();
    });

    test('getSessionIndex should return 0 for non-existent session', () => {
      expect(registry.getSessionIndex('non-existent-id')).toBe(0);
    });
  });

  describe('chunk callback registration', () => {
    test('should allow registering chunk callbacks', () => {
      const chunks: StreamChunk[] = [];
      registry.onChunk((chunk) => chunks.push(chunk));
      // Callback is registered, no errors
      expect(chunks).toEqual([]);
    });

    test('should allow registering error callbacks', () => {
      const errors: Error[] = [];
      registry.onError((error) => errors.push(error));
      // Callback is registered, no errors
      expect(errors).toEqual([]);
    });
  });

  describe('setProcessing', () => {
    test('should not throw for non-existent session', () => {
      expect(() => registry.setProcessing('non-existent', true)).not.toThrow();
    });
  });

  describe('hasProcessingSession', () => {
    test('should return false when no sessions exist', () => {
      expect(registry.hasProcessingSession()).toBe(false);
    });
  });

  describe('getBackgroundProcessingSessions', () => {
    test('should return empty array when no sessions', () => {
      expect(registry.getBackgroundProcessingSessions()).toEqual([]);
    });
  });

  describe('closeAll', () => {
    test('should handle closing when no sessions exist', () => {
      expect(() => registry.closeAll()).not.toThrow();
      expect(registry.getSessionCount()).toBe(0);
    });
  });

  describe('closeSession', () => {
    test('should handle closing non-existent session', () => {
      expect(() => registry.closeSession('non-existent')).not.toThrow();
    });
  });

  describe('switchSession', () => {
    test('should throw for non-existent session', async () => {
      await expect(registry.switchSession('non-existent')).rejects.toThrow(
        'Session non-existent not found'
      );
    });
  });
});

// Test SessionInfo interface structure
describe('SessionInfo interface', () => {
  test('should have correct structure', () => {
    const sessionInfo: SessionInfo = {
      id: 'test-id',
      cwd: '/test/path',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      isProcessing: false,
      client: {} as any, // Mock client
    };

    expect(sessionInfo.id).toBe('test-id');
    expect(sessionInfo.cwd).toBe('/test/path');
    expect(typeof sessionInfo.startedAt).toBe('number');
    expect(typeof sessionInfo.updatedAt).toBe('number');
    expect(sessionInfo.isProcessing).toBe(false);
  });
});
