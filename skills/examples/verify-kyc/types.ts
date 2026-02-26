export type KycLevel = "none" | "basic" | "enhanced" | "full";

export type KycStatus = "pending" | "verified" | "rejected" | "expired";

export interface KycVerificationResult {
  subject: string;
  level: KycLevel;
  status: KycStatus;
  filtered: boolean;
}
