'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

interface ScreenReaderContextValue {
  announce: (message: string, priority?: 'polite' | 'assertive') => void;
}

const ScreenReaderContext = createContext<ScreenReaderContextValue | null>(null);

interface ScreenReaderProviderProps {
  children: ReactNode;
}

export function ScreenReaderProvider({ children }: ScreenReaderProviderProps) {
  const [politeMessage, setPoliteMessage] = useState('');
  const [assertiveMessage, setAssertiveMessage] = useState('');

  const announce = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    if (priority === 'assertive') {
      setAssertiveMessage('');
      // Force rerender by toggling
      setTimeout(() => setAssertiveMessage(message), 50);
    } else {
      setPoliteMessage('');
      setTimeout(() => setPoliteMessage(message), 50);
    }
  }, []);

  return (
    <ScreenReaderContext.Provider value={{ announce }}>
      {children}
      {/* Live regions for screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {politeMessage}
      </div>
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {assertiveMessage}
      </div>
    </ScreenReaderContext.Provider>
  );
}

export function useScreenReader() {
  const context = useContext(ScreenReaderContext);
  if (!context) {
    // Return a no-op function if not wrapped in provider
    return { announce: () => {} };
  }
  return context;
}

// Visually hidden element for screen readers
interface VisuallyHiddenProps {
  children: ReactNode;
}

export function VisuallyHidden({ children }: VisuallyHiddenProps) {
  return <span className="sr-only">{children}</span>;
}

// Skip link for keyboard navigation
interface SkipLinkProps {
  href?: string;
  children?: ReactNode;
}

export function SkipLink({ href = '#main-content', children = 'Skip to main content' }: SkipLinkProps) {
  return (
    <a
      href={href}
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-background focus:border focus:border-border focus:rounded-md focus:shadow-lg"
    >
      {children}
    </a>
  );
}
