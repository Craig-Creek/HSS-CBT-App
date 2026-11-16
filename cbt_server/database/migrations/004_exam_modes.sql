-- Run once after migration 003 to add examination category and mode.
USE hss_cbt;
ALTER TABLE exams
  ADD COLUMN exam_type ENUM('jamb','waec','neco','school','custom') NOT NULL DEFAULT 'school' AFTER instructions,
  ADD COLUMN exam_mode ENUM('timed','practice') NOT NULL DEFAULT 'timed' AFTER exam_type;
