import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/lib/db/schema";

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

export async function ensureDatabase() {
  if (!initializationPromise) {
    initializationPromise = Promise.resolve().then(() => {
      migrate(db, { migrationsFolder: migrationsFolderPath });
      seedDefaultNotes();
    });
  }

  return initializationPromise;
}
