import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { createPool, type Pool } from 'mysql2/promise';

import * as schema from './schema.ts';

export interface DatabaseConnection {
  pool: Pool;
  db: MySql2Database<typeof schema>;
}

export function createDatabaseConnection(databaseUrl: string): DatabaseConnection {
  const pool = createPool({ uri: databaseUrl, connectionLimit: 10 });
  return { pool, db: drizzle(pool, { schema, mode: 'default' }) };
}
