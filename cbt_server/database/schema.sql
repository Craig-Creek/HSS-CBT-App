CREATE DATABASE IF NOT EXISTS hss_cbt
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hss_cbt;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(80) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  role ENUM('admin', 'student') NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS student_groups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_student_groups_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS group_members (
  group_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, student_id),
  CONSTRAINT fk_group_members_group FOREIGN KEY (group_id) REFERENCES student_groups(id),
  CONSTRAINT fk_group_members_student FOREIGN KEY (student_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS subjects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_subjects_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS questions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subject_id BIGINT UNSIGNED NOT NULL,
  topic VARCHAR(160) NULL,
  question_text TEXT NOT NULL,
  options JSON NOT NULL,
  correct_option_key CHAR(1) NOT NULL,
  explanation TEXT NULL,
  difficulty ENUM('easy', 'medium', 'hard') NULL,
  source_year SMALLINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_questions_subject (subject_id),
  CONSTRAINT fk_questions_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_questions_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS exams (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(180) NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  instructions TEXT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  question_count SMALLINT UNSIGNED NOT NULL,
  total_marks DECIMAL(8,2) NOT NULL,
  pass_mark DECIMAL(8,2) NOT NULL DEFAULT 0,
  status ENUM('draft', 'published', 'closed') NOT NULL DEFAULT 'draft',
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_exams_status_dates (status, starts_at, ends_at),
  CONSTRAINT fk_exams_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_exams_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS exam_questions (
  exam_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  marks DECIMAL(8,2) NOT NULL DEFAULT 1,
  PRIMARY KEY (exam_id, question_id),
  CONSTRAINT fk_exam_questions_exam FOREIGN KEY (exam_id) REFERENCES exams(id),
  CONSTRAINT fk_exam_questions_question FOREIGN KEY (question_id) REFERENCES questions(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS exam_assignments (
  exam_id BIGINT UNSIGNED NOT NULL,
  group_id BIGINT UNSIGNED NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (exam_id, group_id),
  CONSTRAINT fk_exam_assignments_exam FOREIGN KEY (exam_id) REFERENCES exams(id),
  CONSTRAINT fk_exam_assignments_group FOREIGN KEY (group_id) REFERENCES student_groups(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS exam_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  exam_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  status ENUM('in_progress', 'submitted', 'expired') NOT NULL DEFAULT 'in_progress',
  started_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  submitted_at DATETIME NULL,
  score DECIMAL(8,2) NULL,
  percentage DECIMAL(6,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_exam_attempt_student (exam_id, student_id),
  KEY idx_attempts_student_status (student_id, status),
  CONSTRAINT fk_attempts_exam FOREIGN KEY (exam_id) REFERENCES exams(id),
  CONSTRAINT fk_attempts_student FOREIGN KEY (student_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attempt_questions (
  attempt_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  question_order SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (attempt_id, question_id),
  UNIQUE KEY uq_attempt_question_order (attempt_id, question_order),
  CONSTRAINT fk_attempt_questions_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id),
  CONSTRAINT fk_attempt_questions_question FOREIGN KEY (question_id) REFERENCES questions(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attempt_answers (
  attempt_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  selected_option_key CHAR(1) NULL,
  saved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (attempt_id, question_id),
  CONSTRAINT fk_attempt_answers_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id),
  CONSTRAINT fk_attempt_answers_question FOREIGN KEY (question_id) REFERENCES questions(id)
) ENGINE=InnoDB;
