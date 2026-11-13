#!/usr/bin/env node
// Dump the Quest Journal SQLite database to a JSON snapshot that
// preview/index.html loads through “⇩ 载入导出数据”.
//
// Usage:
//   node scripts/export-journal.mjs                  # -> preview/quest-journal-export.json
//   node scripts/export-journal.mjs --out /tmp/j.json
//   node scripts/export-journal.mjs --stdout         # JSON on stdout, summary on stderr
//   node scripts/export-journal.mjs --db <path>      # override the database file
//
// The database is opened read-only: this script never mutates the journal.

import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const USAGE = `用法: node scripts/export-journal.mjs [--db <sqlite>] [--out <json>] [--stdout]

  --db <path>    任务日志数据库，默认 <DSH_HOME>/storages/quest-journal.db
  --out <path>   输出文件，默认 preview/quest-journal-export.json
  --stdout       把 JSON 打到标准输出（摘要改走 stderr）
  -h, --help     显示本帮助`;

function parseArgs(argv) {
  const args = { stdout: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--db" || arg === "--out") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 缺少路径参数`);
      args[arg.slice(2)] = value;
      i += 1;
    } else if (arg === "--stdout") {
      args.stdout = true;
    } else if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}

function expandHome(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`${error.message}\n\n${USAGE}`);
  process.exit(2);
}

if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const dbPath = resolve(
  expandHome(args.db ?? join(process.env.DSH_HOME || join(homedir(), ".dsh"), "storages", "quest-journal.db")),
);
const outPath = args.out
  ? resolve(expandHome(args.out))
  : fileURLToPath(new URL("../preview/quest-journal-export.json", import.meta.url));

if (!existsSync(dbPath)) {
  console.error(`找不到数据库：${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
let snapshot;
try {
  const rows = (sql) => db.prepare(sql).all();
  snapshot = {
    format: "quest-journal-export/v1",
    exported_at: new Date().toISOString(),
    source_db: dbPath,
    quests: rows("SELECT * FROM quests ORDER BY sort_order, created_at"),
    objectives: rows("SELECT * FROM objectives ORDER BY quest_id, sort_order, created_at"),
    steps: rows("SELECT * FROM steps ORDER BY objective_id, sort_order, created_at"),
    attachments: rows("SELECT * FROM attachments ORDER BY created_at"),
    events: rows("SELECT * FROM events ORDER BY created_at, id"),
    ...Object.fromEntries(["todos","todo_events"].filter(table=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)).map(table=>[table,rows(`SELECT * FROM ${table} ORDER BY created_at, id`)])),
  };
} finally {
  db.close();
}

const json = `${JSON.stringify(snapshot, null, 2)}\n`;
const summary =
  `已导出 ${snapshot.quests.length} 个任务 / ${snapshot.objectives.length} 个目标 / ` +
  `${snapshot.steps.length} 个进展 / ${snapshot.attachments.length} 条备注 / ${snapshot.events.length} 条 Trace`;

if (args.stdout) {
  process.stdout.write(json);
  console.error(summary);
} else {
  writeFileSync(outPath, json);
  console.log(`${summary}\n→ ${outPath}`);
}
