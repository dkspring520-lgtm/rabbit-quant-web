export function withL2Provenance<T>(payload: T, now?: number): T;
export function l2ProvenanceText(payload: unknown): string;
export function shouldApplyL2Response(current: unknown, incoming: unknown): boolean;
