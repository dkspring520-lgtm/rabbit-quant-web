export const RESETTABLE_PREFIXES: readonly string[];
export function isPreopenResetWindow(input?: {phase?: string; time?: string}): boolean;
export function resetIntradayCaches(input?: {storage?: Storage|null; accountName?: string; code?: string; date?: string}): string[];
