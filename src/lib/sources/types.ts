import "server-only";
import type { Settings } from "../settings";
import type { Connection, Item, Task } from "../store";

export type SyncContext = {
  conn: Connection;
  settings: Settings;
  now: Date;
  /** First sync of this connection: import history quietly, without firing alerts. */
  backfill: boolean;
};

export type SyncResult = {
  newItems?: Item[];
  newAssignments?: Task[];
  counts?: Record<string, number>;
  cursor?: Record<string, unknown>;
  /** Updated credentials to persist (e.g. refreshed access token). */
  secret?: unknown;
  account?: string;
  /** Part of the sync failed (e.g. Calendar API not enabled); shown in Settings → Connections. */
  warning?: string;
};

export type SourceAdapter = {
  /** Minimum minutes between automatic syncs. */
  intervalMinutes: number;
  sync(ctx: SyncContext): Promise<SyncResult>;
};
