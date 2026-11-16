-- Run once on a database created with the original CBT-System schema.
USE hss_cbt;
ALTER TABLE exams ADD COLUMN attempts_allowed TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER pass_mark;
ALTER TABLE exam_attempts DROP INDEX uq_exam_attempt_student,
  ADD INDEX idx_attempts_exam_student(exam_id,student_id),
  ADD INDEX idx_attempts_expiry(status,expires_at);
ALTER TABLE attempt_questions ADD COLUMN option_order JSON NULL AFTER question_order;
UPDATE attempt_questions SET option_order=JSON_ARRAY('A','B','C','D') WHERE option_order IS NULL;
ALTER TABLE attempt_questions MODIFY option_order JSON NOT NULL;
CREATE TABLE IF NOT EXISTS attempt_question_results (
 attempt_id BIGINT UNSIGNED NOT NULL, question_id BIGINT UNSIGNED NOT NULL,
 is_correct BOOLEAN NOT NULL, marks_awarded DECIMAL(8,2) NOT NULL DEFAULT 0,
 PRIMARY KEY(attempt_id,question_id),
 CONSTRAINT fk_attempt_results_attempt FOREIGN KEY(attempt_id) REFERENCES exam_attempts(id),
 CONSTRAINT fk_attempt_results_question FOREIGN KEY(question_id) REFERENCES questions(id)
) ENGINE=InnoDB;
