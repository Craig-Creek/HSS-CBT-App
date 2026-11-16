-- Run once after migration 002 to enable per-question time analytics.
USE hss_cbt;
ALTER TABLE attempt_questions
  ADD COLUMN time_spent_seconds INT UNSIGNED NOT NULL DEFAULT 0 AFTER option_order;
