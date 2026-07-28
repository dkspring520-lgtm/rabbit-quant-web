export type AlertDirection = "buy" | "sell" | null;

export type DeliveryAlert = {
  id?: string;
  code?: string;
  eventKey?: string;
  source?: string;
  createdAt?: string;
  level?: "candidate" | "signal" | "formal" | "risk";
  rabbit?: "buy" | "sell" | "both";
  title?: string;
  message?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

export function alertDirection(alert: DeliveryAlert | null | undefined): AlertDirection;

export function resolveAlertDelivery(input: {
  previous?: DeliveryAlert | null;
  next: DeliveryAlert;
  nowMs?: number;
}): {
  deliver: boolean;
  alert: DeliveryAlert;
  reason: string;
};

export function conciseAlertSpeech(input: {
  text: string;
  level?: "candidate" | "signal" | "formal" | "risk";
  direction?: AlertDirection;
  risk?: boolean;
}): string;

export const ALERT_DELIVERY_WINDOWS: Readonly<{
  candidateCooldownMs: number;
  sameDirectionMs: number;
  formalConflictMs: number;
}>;
