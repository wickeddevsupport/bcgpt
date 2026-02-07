import React from 'react';

import { FeatureKey } from './request-trial';

type LockedFeatureGuardProps = {
  children: React.ReactNode;
  locked: boolean;
  lockTitle: string;
  lockDescription: string;
  lockVideoUrl?: string;
  featureKey: FeatureKey;
};

export const LockedFeatureGuard = ({
  children,
  locked,
  lockTitle,
  lockDescription,
  lockVideoUrl,
  featureKey,
}: LockedFeatureGuardProps) => {
  return children;
};

export default LockedFeatureGuard;
