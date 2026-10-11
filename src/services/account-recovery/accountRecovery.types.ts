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
}

export interface VerifyRecoveryChallengeInput {
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
