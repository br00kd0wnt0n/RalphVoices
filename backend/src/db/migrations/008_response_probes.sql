-- Intent probes (opt-in per test via variant_config.probes).
-- {p_stop, p_tap, p_quote}: probability of "Yes" read from token logprobs on a
-- one-word follow-up question after the in-character response. NULL when the
-- test ran without probes. See backend/src/utils/probes.ts.
-- Note: docs/trupanion-build-plan.md reserved 008 for persona_evidence; that
-- migration takes the next free number instead.
ALTER TABLE test_responses ADD COLUMN IF NOT EXISTS probes JSONB;
