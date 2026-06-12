import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/lib/db/schema";
import { expandMessageUsageRecords } from "@/lib/usage-records";

const dataDirectoryPath = path.join(process.cwd(), "data");
const databaseFilePath = path.join(dataDirectoryPath, "agent-chat-lab.sqlite");
const migrationsFolderPath = path.join(process.cwd(), "drizzle");

fs.mkdirSync(dataDirectoryPath, { recursive: true });

const sqlite = new Database(databaseFilePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { databaseFilePath };

let initializationPromise: Promise<void> | undefined;

const defaultNotes = [
  {
    title: "Agent 学习路线",
    content: "先学 prompt、tools、state、loop，再扩展到 memory 和 planning。",
    tags: ["agent", "learning"],
  },
  {
    title: "当前项目定位",
    content: "这是一个教学型 Agent Web 应用，目标是把最小可解释流程先跑通。",
    tags: ["project", "mvp"],
  },
];

const defaultTodos = [
  {
    title: "补齐更多内置 Tools",
    content: "优先实现 TodoRead / TodoWrite，再评估 read-only 文件工具。",
    status: "in_progress",
    priority: "high",
  },
  {
    title: "验证 Tavily 联网工具",
    content: "拿真实 API Key 跑一次 WebSearch 和 WebFetch 联调。",
    status: "todo",
    priority: "default",
  },
];

function seedDefaultNotes() {
  const existingNote = db.select({ id: schema.notes.id }).from(schema.notes).limit(1).all()[0];

  if (existingNote) {
    return;
  }

  const now = Date.now();

  db.insert(schema.notes).values(
    defaultNotes.map((note) => ({
      id: crypto.randomUUID(),
      title: note.title,
      content: note.content,
      tagsJson: JSON.stringify(note.tags),
      createdAt: now,
      updatedAt: now,
    })),
  ).run();
}

function seedDefaultTodos() {
  const existingTodo = db.select({ id: schema.todos.id }).from(schema.todos).limit(1).all()[0];

  if (existingTodo) {
    return;
  }

  const now = Date.now();

  db.insert(schema.todos).values(
    defaultTodos.map((todo) => ({
      id: crypto.randomUUID(),
      title: todo.title,
      content: todo.content,
      status: todo.status,
      priority: todo.priority,
      createdAt: now,
      updatedAt: now,
      completedAt: todo.status === "done" ? now : null,
    })),
  ).run();
}

// One-time migration of historical assistant-message metadata into usage_records.
// Runs only when the table is empty so it is a no-op on every subsequent boot.
function backfillUsageRecords() {
  const existing = db
    .select({ id: schema.usageRecords.id })
    .from(schema.usageRecords)
    .limit(1)
    .all()[0];

  if (existing) {
    return;
  }

  const assistantRows = db
    .select({
      id: schema.messages.id,
      conversationId: schema.messages.conversationId,
      metadataJson: schema.messages.metadataJson,
    })
    .from(schema.messages)
    .where(eq(schema.messages.role, "assistant"))
    .all();

  const seeds = assistantRows.flatMap((row) => {
    if (!row.metadataJson) {
      return [];
    }

    let metadata: unknown;
    try {
      metadata = JSON.parse(row.metadataJson);
    } catch {
      return [];
    }

    return expandMessageUsageRecords(row.conversationId, row.id, metadata);
  });

  if (seeds.length === 0) {
    return;
  }

  const batchSize = 50;
  for (let index = 0; index < seeds.length; index += batchSize) {
    db.insert(schema.usageRecords).values(seeds.slice(index, index + batchSize)).run();
  }
}

export async function ensureDatabase() {
  if (!initializationPromise) {
    initializationPromise = Promise.resolve().then(() => {
      migrate(db, { migrationsFolder: migrationsFolderPath });
      seedDefaultNotes();
      seedDefaultTodos();
      backfillUsageRecords();
    });
  }

  return initializationPromise;
}
