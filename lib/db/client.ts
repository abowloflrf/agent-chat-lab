import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/lib/db/schema";
import { expandMessageUsageRecords } from "@/lib/usage-records";
import { logger } from "@/lib/logger";

const dbLog = logger.child({ module: "DB" });

const dataDirectoryPath = path.join(process.cwd(), "data");
const databaseFilePath = path.join(dataDirectoryPath, "agent-chat-lab.sqlite");
const migrationsFolderPath = path.join(process.cwd(), "drizzle");

type DrizzleDatabase = ReturnType<typeof drizzle<typeof schema>>;

let drizzleInstance: DrizzleDatabase | undefined;

// 惰性打开连接：模块求值时不碰数据库，避免 `next build` 收集 page data
// 时多个 worker 进程并发打开同一文件、争抢 WAL 切换锁而报 SQLITE_BUSY。
function getDb(): DrizzleDatabase {
  if (!drizzleInstance) {
    fs.mkdirSync(dataDirectoryPath, { recursive: true });

    const sqlite = new Database(databaseFilePath);
    sqlite.pragma("busy_timeout = 5000");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");

    drizzleInstance = drizzle(sqlite, { schema });
    dbLog.info({ path: databaseFilePath }, "SQLite database opened");
  }

  return drizzleInstance;
}

export const db = new Proxy({} as DrizzleDatabase, {
  get(_target, prop) {
    const instance = getDb();
    const value = Reflect.get(instance, prop, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
}) as DrizzleDatabase;

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

// Returns the number of rows seeded (0 when the table already had data).
function seedDefaultNotes(): number {
  const existingNote = db.select({ id: schema.notes.id }).from(schema.notes).limit(1).all()[0];

  if (existingNote) {
    return 0;
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

  return defaultNotes.length;
}

// Returns the number of rows seeded (0 when the table already had data).
function seedDefaultTodos(): number {
  const existingTodo = db.select({ id: schema.todos.id }).from(schema.todos).limit(1).all()[0];

  if (existingTodo) {
    return 0;
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

  return defaultTodos.length;
}

// One-time migration of historical assistant-message metadata into usage_records.
// Runs only when the table is empty so it is a no-op on every subsequent boot.
// Returns the number of usage records backfilled.
function backfillUsageRecords(): number {
  const existing = db
    .select({ id: schema.usageRecords.id })
    .from(schema.usageRecords)
    .limit(1)
    .all()[0];

  if (existing) {
    return 0;
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
    return 0;
  }

  const batchSize = 50;
  for (let index = 0; index < seeds.length; index += batchSize) {
    db.insert(schema.usageRecords).values(seeds.slice(index, index + batchSize)).run();
  }

  return seeds.length;
}

export async function ensureDatabase() {
  if (!initializationPromise) {
    initializationPromise = Promise.resolve().then(() => {
      const startedAt = Date.now();
      migrate(db, { migrationsFolder: migrationsFolderPath });
      const seededNotes = seedDefaultNotes();
      const seededTodos = seedDefaultTodos();
      const backfilledUsageRecords = backfillUsageRecords();
      dbLog.info(
        {
          durationMs: Date.now() - startedAt,
          seededNotes,
          seededTodos,
          backfilledUsageRecords,
        },
        "database initialized",
      );
    });
  }

  return initializationPromise;
}
