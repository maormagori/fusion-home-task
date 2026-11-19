// drizzle-kit config: `npm run db:generate` diffs src/db/schema.ts and writes SQL migrations to ./drizzle.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
