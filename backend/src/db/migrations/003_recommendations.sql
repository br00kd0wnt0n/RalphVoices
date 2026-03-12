-- Add recommendations column to test_results
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS recommendations JSONB;
