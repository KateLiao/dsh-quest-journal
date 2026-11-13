// Quest Journal — Host half of the web panel.
//
// The browser bundle in the `dsh-client-ui-quest-journal` package cannot use
// the Typert `remote.*` surface: DSH packs every Client RPC namespace at build
// time, so a third-party plugin cannot register `remote.questJournal`. It talks
// to these `/quest-journal/*` routes instead, mirroring how the media-desk
// plugin ships its own web panel.
//
// This module is transport-only: every route delegates to the shared journal
// service (lib/journal.mjs), so the panel and the `quest_*` tools share one
// implementation and one SQLite database.

export const ROUTE_PREFIX = "/quest-journal";

const MAX_BODY_BYTES = 1_000_000;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("request body is not valid JSON"), { status: 400 });
  }
}

function errorStatus(error) {
  if (typeof error?.status === "number") return error.status;
  // Journal domain errors (NOT_FOUND, INVALID_*, QUEST_ARCHIVED) are caller
  // mistakes, not server faults.
  return typeof error?.code === "string" ? 400 : 500;
}

/**
 * Build the prefix handler mounted at {@link ROUTE_PREFIX}.
 * @param {{getService: () => object | undefined, reject: (req: object) => number | undefined}} options
 *   `getService` resolves `ctx.questJournal` per request (lazily, so this
 *   plugin never waits on the journal service during activation); `reject`
 *   returns an HTTP status when the request is unauthenticated or cross-origin.
 * @returns {(req: object, res: object) => Promise<void>}
 */
export function createRoutes({ getService, reject, getCommands }) {
  return async function questJournalRoutes(req, res) {
    try {
      const rejected = reject(req);
      if (rejected) {
        sendJson(res, rejected, { error: "unauthorized" });
        return;
      }

      const service = getService();
      if (!service) {
        sendJson(res, 503, { error: "quest journal service is not available yet" });
        return;
      }

      const url = new URL(req.url || "/", "http://quest-journal.local");
      const path = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\/+/, "");
      const method = (req.method || "GET").toUpperCase();

      if (method === "GET" || method === "HEAD") {
        if (path === "todos") { sendJson(res, 200, {todos:service.todos.list()}); return; }
        if (path === "state") {
          const includeArchived = url.searchParams.get("archived") === "1";
          sendJson(res, 200, { quests: service.listQuests({ includeArchived }) });
          return;
        }
        if (path === "quest") {
          const id = url.searchParams.get("id") || "";
          const quest = id ? service.getQuest(id) : null;
          if (!quest) {
            sendJson(res, 404, { error: "quest not found" });
            return;
          }
          sendJson(res, 200, { quest });
          return;
        }
        if (path === "trace") {
          const id = url.searchParams.get("id") || "";
          if (!id || !service.getQuest(id)) {
            sendJson(res, 404, { error: "quest not found" });
            return;
          }
          sendJson(res, 200, { events: service.getTrace(id) });
          return;
        }
        sendJson(res, 404, { error: "unknown route" });
        return;
      }

      if (method === "POST") {
        // Same-origin fence for state-changing calls; `requestRejection` already
        // checks the Host/Origin fence, this rejects cross-site form posts early.
        const site = req.headers?.["sec-fetch-site"];
        if (site && site !== "same-origin" && site !== "none") {
          sendJson(res, 403, { error: "cross-site request rejected" });
          return;
        }
        if (["command/preview", "command/apply", "command/new/preview", "command/new/apply"].includes(path)) {
          const commands = getCommands?.();
          if (!commands) { sendJson(res, 503, { error: "DSH 指令服务尚未就绪" }); return; }
          const body = await readJson(req);
          if (!body || typeof body !== "object" || Array.isArray(body)) throw Object.assign(new Error("指令请求必须是对象"), { status: 400 });
          const controller = new AbortController();
          const abort = () => { if (!res.writableEnded) controller.abort(new Error("请求已取消")); };
          req.once?.("aborted", abort);
          res.once?.("close", abort);
          try {
            const result = path === "command/new/preview" ? await commands.proposeNew(body, controller.signal)
              : path === "command/new/apply" ? commands.confirmNew(body)
              : path === "command/preview" ? await commands.propose(body, controller.signal) : commands.confirm(body);
            if (!res.destroyed) sendJson(res, 200, result);
          } finally { req.removeListener?.("aborted", abort); res.removeListener?.("close", abort); }
          return;
        }
        if (path === "ops") {
          const body = await readJson(req);
          if (!body || !Array.isArray(body.changes)) throw Object.assign(new Error("changes must be an array"), { status: 400 });
          const changes = body.changes;
          const results = service.applyChanges(changes);
          sendJson(res, 200, { results });
          return;
        }
        sendJson(res, 404, { error: "unknown route" });
        return;
      }

      sendJson(res, 405, { error: "method not allowed" });
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      sendJson(res, errorStatus(error), { error: error instanceof Error ? error.message : String(error), code: error?.code });
    }
  };
}
