'use client';

import { useRef, useEffect, type ReactNode, type KeyboardEvent } from 'react';

interface FocusTrapProps {
  children: ReactNode;
  active?: boolean;
  returnFocusOnDeactivate?: boolean;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

export function FocusTrap({
  children,
  active = true,
  returnFocusOnDeactivate = true,
}: FocusTrapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Store the previously focused element when the trap is activated
  useEffect(() => {
    if (active) {
      previousActiveElement.current = document.activeElement as HTMLElement;

      // Focus the first focusable element in the trap
      const container = containerRef.current;
      if (container) {
        const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        const firstFocusable = focusables[0];
        if (firstFocusable) {
          // Use setTimeout to ensure the element is visible
          setTimeout(() => firstFocusable.focus(), 0);
        }
      }
    }

    return () => {
      // Return focus when the trap is deactivated
      if (returnFocusOnDeactivate && previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    };
  }, [active, returnFocusOnDeactivate]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!active || event.key !== 'Tab') return;

    const container = containerRef.current;
    if (!container) return;

    const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const firstFocusable = focusables[0];
    const lastFocusable = focusables[focusables.length - 1];

    if (event.shiftKey) {
      // Shift + Tab: moving backwards
      if (document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable?.focus();
      }
    } else {
      // Tab: moving forwards
      if (document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable?.focus();
      }
    }
  };

  return (
    <div ref={containerRef} onKeyDown={handleKeyDown}>
      {children}
    </div>
  );
}
