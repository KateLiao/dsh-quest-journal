// Quest Journal — Host entry for the Web panel's routes.
//
// A separate Loader row (`@deepseek-ai/dsh-quest-journal/web`) so the journal
// tools stay available in contexts without a web server. Only `webServer` is
// injected; `connection` is read lazily per request, and the journal service is
// the process-wide instance from lib/journal.mjs (same SQLite file as the
// tools).

import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { QuestCommandService, createDshPlanner } from "./commands.mjs";
import { getJournal } from "./journal.mjs";
import { createRoutes, ROUTE_PREFIX } from "./web.js";

export const name = "quest-journal-web";

export const inject = ["webServer"];

// DSH reports a failed entry only in the host's stderr, which a desktop launch
// swallows. Leave a breadcrumb next to the database when activation fails so the
// cause survives the restart.
const ERROR_LOG = join(process.env.DSH_HOME || join(homedir(), ".dsh"), "storages", "quest-journal-web.error.log");

export function apply(ctx, config) {
  try {
    const { service } = getJournal(config?.dbPath);
    const commands = new QuestCommandService(service, createDshPlanner(
      () => ctx.get("llm"),
      () => ctx.get("agentDefaultModel")?.currentSelection(),
    ));
    const handler = createRoutes({
      getCommands: () => commands,
      getService: () => service,
      reject: (req) => {
        const connection = ctx.get("connection");
        // The web server does not authenticate plugin routes, so a missing
        // connection service must fail closed rather than expose local data.
        if (typeof connection?.requestRejection !== "function") return 403;
        return connection.requestRejection({ headers: req.headers });
      },
    });
    ctx.effect(
      () => ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler }),
      "quest-journal-web: /quest-journal routes",
    );
  } catch (error) {
    try {
      appendFileSync(ERROR_LOG, `${new Date().toISOString()} apply failed: ${error?.stack || error}\n`);
    } catch {
      /* never mask the original failure */
    }
    throw error;
  }
}
