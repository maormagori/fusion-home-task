import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { feedbackStatusSchema } from '../../src/domain/types.js';
import { IN_MEMORY_PATH, openDatabase } from '../../src/db/database.js';
import { feedback } from '../../src/db/schema.js';

const NOW = '2026-01-01T00:00:00.000Z';

describe('openDatabase', () => {
  it('creates both tables by running the migrations', () => {
    const db = openDatabase(IN_MEMORY_PATH);

    const tables = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    );
    const tableNames = tables.map((table) => table.name);

    expect(tableNames).toContain('feedback');
    expect(tableNames).toContain('analysis_attempts');
  });

  it('rejects a status outside the allowed values', () => {
    const db = openDatabase(IN_MEMORY_PATH);

    // Raw SQL because the Drizzle column type would not let us write a bad status from TypeScript.
    const insertBadStatus = (): void => {
      db.run(sql`
        INSERT INTO feedback (id, content, content_hash, status, created_at, updated_at)
        VALUES ('id-1', 'hello', 'hash-1', 'PENDING', ${NOW}, ${NOW})
      `);
    };

    // Drizzle wraps driver errors in its own query error; the SQLite error is its `cause`.
    expect(insertBadStatus).toThrow(expect.objectContaining({
      cause: expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }),
    }));
  });

  it('accepts a row with an allowed status', () => {
    const db = openDatabase(IN_MEMORY_PATH);

    db.insert(feedback).values({
      id: 'id-1', content: 'hello', contentHash: 'hash-1',
      status: feedbackStatusSchema.enum.RECEIVED, createdAt: NOW, updatedAt: NOW,
    }).run();

    expect(db.select().from(feedback).all()).toHaveLength(1);
  });
});
