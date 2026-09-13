declare interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

declare interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(column?: string): Promise<T|null>;
  all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta?: Record<string, unknown> }>;
  run(): Promise<{ success: boolean; meta?: Record<string, unknown> }>;
  raw<T = unknown>(): Promise<T[]>;
}

declare interface D1Database {
  prepare(query: string): D1PreparedStatement;
  dump(): Promise<ArrayBuffer>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<Array<{ results: T[]; success: boolean; meta?: Record<string, unknown> }>>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

declare module "cloudflare:workers" {
  export const env: { DB?: D1Database; [key: string]: unknown };
}
