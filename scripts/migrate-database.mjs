import console from 'node:console';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

import mysql from 'mysql2/promise';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const sql = await readFile(
  new URL('../apps/server/src/db/migrations/0001_initial.sql', import.meta.url),
  'utf8',
);
const connection = await mysql.createConnection({ uri: databaseUrl, multipleStatements: true });
try {
  await connection.query(sql);
  console.log('Database migration 0001_initial applied');
} finally {
  await connection.end();
}
