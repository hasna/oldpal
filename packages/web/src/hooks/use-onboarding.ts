'use client';

import { useState, useEffect, useCallback } from 'react';

const ONBOARDING_KEY = 'onboarding-state';

export interface OnboardingState {
  hasSeenWelcome: boolean;
  hasCompletedTour: boolean;
  completedSteps: string[];
  dismissedAt: string | null;
}

const defaultState: OnboardingState = {
  hasSeenWelcome: false,
  hasCompletedTour: false,
  completedSteps: [],
  dismissedAt: null,
};

export const ONBOARDING_STEPS = [
  {
    id: 'first-message',
    label: 'Send your first message',
    description: 'Start a conversation with your assistant',
    link: '/chat',
  },
  {
    id: 'create-assistant',
    label: 'Create a custom assistant',
    description: 'Build an AI assistant tailored to your needs',
    link: '/assistants',
  },
  {
    id: 'create-schedule',
    label: 'Set up a schedule',
    description: 'Automate tasks with scheduled runs',
    link: '/schedules',
  },
  {
    id: 'explore-settings',
    label: 'Customize settings',
    description: 'Configure your experience',
    link: '/settings',
  },
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]['id'];

export function useOnboarding() {
  const [state, setState] = useState<OnboardingState>(defaultState);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load state from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(ONBOARDING_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as OnboardingState;
        setState(parsed);
      }
    } catch {
      // Ignore parse errors
    }
    setIsLoaded(true);
  }, []);

  // Save state to localStorage
  const saveState = useCallback((newState: OnboardingState) => {
    setState(newState);
    try {
      localStorage.setItem(ONBOARDING_KEY, JSON.stringify(newState));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const markWelcomeSeen = useCallback(() => {
    saveState({ ...state, hasSeenWelcome: true });
  }, [state, saveState]);

  const markTourCompleted = useCallback(() => {
    saveState({ ...state, hasCompletedTour: true });
  }, [state, saveState]);

  const completeStep = useCallback(
    (stepId: OnboardingStepId) => {
      if (state.completedSteps.includes(stepId)) return;
      saveState({
        ...state,
        completedSteps: [...state.completedSteps, stepId],
      });
    },
    [state, saveState]
  );

  const dismissOnboarding = useCallback(() => {
    saveState({
      ...state,
      dismissedAt: new Date().toISOString(),
      hasSeenWelcome: true,
      hasCompletedTour: true,
    });
  }, [state, saveState]);

  const resetOnboarding = useCallback(() => {
    saveState(defaultState);
  }, [saveState]);

  const isNewUser = isLoaded && !state.hasSeenWelcome;
  const showTour = isLoaded && state.hasSeenWelcome && !state.hasCompletedTour && !state.dismissedAt;
  const showChecklist = isLoaded && state.hasSeenWelcome && !state.dismissedAt;

  const completedCount = state.completedSteps.length;
  const totalSteps = ONBOARDING_STEPS.length;
  const progress = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;
  const isComplete = completedCount >= totalSteps;

  return {
    state,
    isLoaded,
    isNewUser,
    showTour,
    showChecklist,
    completedSteps: state.completedSteps,
    completedCount,
    totalSteps,
    progress,
    isComplete,
    markWelcomeSeen,
    markTourCompleted,
    completeStep,
    dismissOnboarding,
    resetOnboarding,
  };
}
