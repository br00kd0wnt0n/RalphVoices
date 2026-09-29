// B2 settings (thresholds, models, pace) from config.json next to this file.
// AUDIT_CONFIG points at another file for a one-off run.
import fs from 'node:fs';
import path from 'node:path';

export interface AuditConfig {
  text_load: { max_words: number; source: string };
  feature_threshold: number;
  lone_yesno_min: number;
  models: { vision: string; yesno: string; compliance: string; reviewer: string; objection: string; transcribe: string };
  tpm_default: number;
  transcribe_usd_per_minute: number;
  ask_over_usd: number;
  cap_usd: number;
}

export const CONFIG_PATH = process.env.AUDIT_CONFIG || path.join(__dirname, 'config.json');
export const CONFIG: AuditConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
