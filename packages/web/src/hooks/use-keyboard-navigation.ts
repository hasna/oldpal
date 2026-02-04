'use client';

import { useEffect, useCallback, useRef } from 'react';

type KeyHandler = (event: KeyboardEvent) => void;

interface KeyBinding {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  handler: KeyHandler;
  description?: string;
}

export function useKeyboardNavigation(bindings: KeyBinding[], enabled = true) {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        // Allow Escape key to work in inputs
        if (event.key !== 'Escape') return;
      }

      for (const binding of bindingsRef.current) {
        const keyMatch = event.key.toLowerCase() === binding.key.toLowerCase();
        const ctrlMatch = !!binding.ctrl === (event.ctrlKey || event.metaKey);
        const altMatch = !!binding.alt === event.altKey;
        const shiftMatch = !!binding.shift === event.shiftKey;

        if (keyMatch && ctrlMatch && altMatch && shiftMatch) {
          event.preventDefault();
          binding.handler(event);
          return;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}

// Hook for arrow key navigation in lists
interface UseArrowNavigationOptions {
  containerRef: React.RefObject<HTMLElement | null>;
  itemSelector: string;
  onSelect?: (element: HTMLElement, index: number) => void;
  orientation?: 'vertical' | 'horizontal' | 'both';
  loop?: boolean;
}

export function useArrowNavigation({
  containerRef,
  itemSelector,
  onSelect,
  orientation = 'vertical',
  loop = true,
}: UseArrowNavigationOptions) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
      if (items.length === 0) return;

      const currentIndex = items.findIndex((item) => item === document.activeElement);
      let nextIndex = currentIndex;

      const isVertical = orientation === 'vertical' || orientation === 'both';
      const isHorizontal = orientation === 'horizontal' || orientation === 'both';

      switch (event.key) {
        case 'ArrowDown':
          if (!isVertical) return;
          event.preventDefault();
          nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : loop ? 0 : currentIndex;
          break;
        case 'ArrowUp':
          if (!isVertical) return;
          event.preventDefault();
          nextIndex = currentIndex > 0 ? currentIndex - 1 : loop ? items.length - 1 : currentIndex;
          break;
        case 'ArrowRight':
          if (!isHorizontal) return;
          event.preventDefault();
          nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : loop ? 0 : currentIndex;
          break;
        case 'ArrowLeft':
          if (!isHorizontal) return;
          event.preventDefault();
          nextIndex = currentIndex > 0 ? currentIndex - 1 : loop ? items.length - 1 : currentIndex;
          break;
        case 'Home':
          event.preventDefault();
          nextIndex = 0;
          break;
        case 'End':
          event.preventDefault();
          nextIndex = items.length - 1;
          break;
        case 'Enter':
        case ' ':
          if (currentIndex >= 0 && onSelect) {
            event.preventDefault();
            onSelect(items[currentIndex], currentIndex);
          }
          return;
        default:
          return;
      }

      if (nextIndex !== currentIndex && nextIndex >= 0 && nextIndex < items.length) {
        items[nextIndex].focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [containerRef, itemSelector, onSelect, orientation, loop]);
}
