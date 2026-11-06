// Quest Journal — process-wide journal instance.
//
// Third-party bundles cannot import `@deepseek-ai/*` packages: the loader uses
// plain Node resolution from the profile, and only DSH's own packages (inside
// the application bundle) can resolve them. Everything under `lib/` therefore
// depends on Node built-ins and this package's own modules only.
//
// The tools entry and the web entry both call `getJournal()` so they share one
// SQLite connection and one domain service, without needing a Cordis service
// registration (which would require importing the Cordis runtime).

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { QuestJournalService, QuestJournalStore } from "./quest-core.mjs";

let instance = null;

/** Resolve the SQLite file: explicit config wins, then `<DSH_HOME>/storages`. */
export function resolveDbPath(configured) {
  if (typeof configured === "string" && configured.trim().length > 0) return configured.trim();
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, "storages", "quest-journal.db");
}

/**
 * The shared store/service pair for this Host process.
 * @param {string} [configuredDbPath] - `dbPath` from the plugin row's config.
 */
export function getJournal(configuredDbPath) {
  if (instance === null) {
    const dbPath = resolveDbPath(configuredDbPath);
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    const store = new QuestJournalStore(dbPath);
    instance = { dbPath, store, service: new QuestJournalService(store) };
  }
  return instance;
}
