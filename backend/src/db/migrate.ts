import { readFileSync } from 'fs';
import { join } from 'path';
import { pool } from './index.js';
import dotenv from 'dotenv';

dotenv.config();

async function migrate() {
  console.log('Running database migrations...');

  try {
    // Use process.cwd() and relative path since we run via tsx
    const schemaPath = join(process.cwd(), 'src', 'db', 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    await pool.query(schema);

    console.log('Migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
