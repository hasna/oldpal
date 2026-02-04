'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useOnboarding, type OnboardingStepId } from '@/hooks/use-onboarding';
import { WelcomeModal } from './WelcomeModal';
import { FeatureTour } from './FeatureTour';
import { OnboardingChecklist } from './OnboardingChecklist';

export function OnboardingProvider() {
  const { user } = useAuth();
  const {
    isLoaded,
    isNewUser,
    showTour,
    showChecklist,
    completedSteps,
    progress,
    markWelcomeSeen,
    markTourCompleted,
    completeStep,
    dismissOnboarding,
  } = useOnboarding();

  const [showWelcomeModal, setShowWelcomeModal] = useState(true);
  const [tourActive, setTourActive] = useState(false);

  const handleCloseWelcome = useCallback(() => {
    setShowWelcomeModal(false);
    markWelcomeSeen();
  }, [markWelcomeSeen]);

  const handleStartTour = useCallback(() => {
    setShowWelcomeModal(false);
    markWelcomeSeen();
    setTourActive(true);
  }, [markWelcomeSeen]);

  const handleTourComplete = useCallback(() => {
    setTourActive(false);
    markTourCompleted();
  }, [markTourCompleted]);

  const handleTourDismiss = useCallback(() => {
    setTourActive(false);
    markTourCompleted();
  }, [markTourCompleted]);

  const handleChecklistDismiss = useCallback(() => {
    dismissOnboarding();
  }, [dismissOnboarding]);

  const handleCompleteStep = useCallback(
    (stepId: OnboardingStepId) => {
      completeStep(stepId);
    },
    [completeStep]
  );

  // Don't render anything until state is loaded
  if (!isLoaded) return null;

  return (
    <>
      {/* Welcome modal for new users */}
      {isNewUser && showWelcomeModal && (
        <WelcomeModal
          open={true}
          onClose={handleCloseWelcome}
          onStartTour={handleStartTour}
          userName={user?.name}
        />
      )}

      {/* Feature tour */}
      {(showTour || tourActive) && (
        <FeatureTour
          active={tourActive}
          onComplete={handleTourComplete}
          onDismiss={handleTourDismiss}
        />
      )}

      {/* Onboarding checklist */}
      {showChecklist && !tourActive && (
        <OnboardingChecklist
          completedSteps={completedSteps}
          progress={progress}
          onDismiss={handleChecklistDismiss}
          onCompleteStep={handleCompleteStep}
        />
      )}
    </>
  );
}
