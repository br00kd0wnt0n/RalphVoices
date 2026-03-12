import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pool } from './index.js';
import dotenv from 'dotenv';

dotenv.config();

async function migrate() {
  console.log('Running database migrations...');

  try {
    // Run base schema first
    const schemaPath = join(process.cwd(), 'src', 'db', 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    await pool.query(schema);
    console.log('Base schema applied.');

    // Run incremental migration files in order
    const migrationsDir = join(process.cwd(), 'src', 'db', 'migrations');
    try {
      const files = readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        const sql = readFileSync(join(migrationsDir, file), 'utf-8');
        await pool.query(sql);
        console.log(`Applied migration: ${file}`);
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        console.log('No migrations directory found, skipping.');
      } else {
        throw err;
      }
    }

    console.log('Migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
