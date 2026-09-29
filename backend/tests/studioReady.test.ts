// Ready for production (services/studio/ready.ts): the acceptance checks from
// Brook's 28 Sep brief on the file store. The same scenario runs on Postgres
// in studioPg.test.ts. Mock client, example rules.
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import { FileStore } from '../src/services/studio/store.js';
import { scenario } from './helpers/readyScenario.js';

test('Ready for production on the file store', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-ready-'));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath: path.join(__dirname, '../scripts/studio/rules.example.json') }));
  await S.refreshRules();
  await scenario();
});
