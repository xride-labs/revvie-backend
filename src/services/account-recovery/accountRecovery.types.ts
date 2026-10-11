export type AccountRecoveryStatus =
  | "PENDING_REVIEW"
  | "NEEDS_INFO"
  | "REJECTED"
  | "APPROVED"
  | "CANCELLED"
  | "PROCESSING"
  | "COMPLETED"
  | "EXPIRED";

export type RecoveryChannel = "EMAIL" | "PHONE";
export type RecoveryFactor = "EMAIL" | "PHONE" | "OAUTH" | "PASSKEY";
export type RecoveryChallengePurpose = "RECOVERY_DESTINATION" | "FACTOR_LINK";

export interface CreateRecoveryChallengeInput {
  channel: RecoveryChannel;
  value: string;
  purpose: RecoveryChallengePurpose;
  /** Binds a FACTOR_LINK challenge to the signed-in rider requesting it. */
  userId?: string;
}

export interface VerifyRecoveryChallengeInput {
  challengeToken: string;
  code: string;
}

export interface LinkFactorInput {
  userId: string;
  channel: RecoveryChannel;
  value: string;
  challengeToken: string;
  code: string;
}

export interface CreateRecoveryRequestInput {
  lookup: string;
  destination: {
    channel: RecoveryChannel;
    value: string;
    challengeToken: string;
  };
  explanation?: string;
}

export interface AccountRecoveryServiceOptions {
  hmacSecret?: string;
  generateCode?: () => string;
  now?: () => Date;
}
