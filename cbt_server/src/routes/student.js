const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncRoute, shuffle, parseId, httpError } = require('../utils');
const { gradeAttempt } = require('../services/attempts');

const router = express.Router();
router.use(authenticate, requireRole('student'));

router.get('/exams', asyncRoute(async (req, res) => {
  const studentId = Number(req.user.sub);
  const [rows] = await pool.execute(
    `SELECT e.id,e.title,s.name AS subject,e.instructions,e.duration_minutes AS durationMinutes,
      e.question_count AS questionCount,e.total_marks AS totalMarks,e.pass_mark AS passMark,
      e.exam_type AS examType,e.exam_mode AS examMode,
      e.starts_at AS startsAt,e.ends_at AS endsAt,
      (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id=e.id AND a.student_id=?) AS attemptsUsed,
      e.attempts_allowed AS attemptsAllowed
     FROM exams e JOIN subjects s ON s.id=e.subject_id
     WHERE e.status='published' AND EXISTS(
       SELECT 1 FROM exam_assignments ea JOIN group_members gm ON gm.group_id=ea.group_id
       WHERE ea.exam_id=e.id AND gm.student_id=?
     ) ORDER BY e.starts_at,e.title`,
    [studentId,studentId]
  );
  res.json({ data:rows });
}));

router.post('/exams/:examId/start', asyncRoute(async (req, res) => {
  const examId = parseId(req.params.examId,'exam id');
  const studentId = Number(req.user.sub);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[exam]] = await connection.execute(
      `SELECT e.* FROM exams e
       WHERE e.id=? AND e.status='published'
       AND EXISTS(SELECT 1 FROM exam_assignments ea JOIN group_members gm ON gm.group_id=ea.group_id WHERE ea.exam_id=e.id AND gm.student_id=?)
       FOR UPDATE`,
      [examId,studentId]
    );
    if (!exam) throw httpError(404,'Exam is not available to this student');
    const now = new Date();
    if (exam.starts_at && now < new Date(exam.starts_at)) throw httpError(403,'This exam has not started yet');
    if (exam.ends_at && now >= new Date(exam.ends_at)) throw httpError(403,'The exam window has ended');

    const [[existing]] = await connection.execute(
      "SELECT id,status,expires_at FROM exam_attempts WHERE exam_id=? AND student_id=? AND status='in_progress' FOR UPDATE",
      [examId,studentId]
    );
    if (existing) {
      await connection.commit();
      return res.json({ attemptId:existing.id,resumed:true,expiresAt:existing.expires_at,examMode:exam.exam_mode });
    }

    const [[used]] = await connection.execute(
      'SELECT COUNT(*) AS total FROM exam_attempts WHERE exam_id=? AND student_id=?',
      [examId,studentId]
    );
    if (used.total >= exam.attempts_allowed) throw httpError(409,'You have used all attempts allowed for this exam');

    const [poolRows] = await connection.execute('SELECT question_id,marks FROM exam_questions WHERE exam_id=?',[examId]);
    if (poolRows.length < exam.question_count) throw httpError(500,'Exam question pool is incomplete');
    const chosen = shuffle(poolRows).slice(0,Number(exam.question_count));
    const started = new Date();
    const durationExpiry = new Date(started.getTime() + Number(exam.duration_minutes) * 60000);
    const examExpiry = exam.ends_at ? new Date(exam.ends_at) : null;
    const expiresAt = exam.exam_mode === 'practice'
      ? (examExpiry || new Date('2099-12-31T23:59:59.000Z'))
      : (examExpiry && examExpiry < durationExpiry ? examExpiry : durationExpiry);

    const [insert] = await connection.execute(
      "INSERT INTO exam_attempts (exam_id,student_id,status,started_at,expires_at) VALUES (?,?,'in_progress',UTC_TIMESTAMP(),?)",
      [examId,studentId,expiresAt]
    );
    const attemptId = insert.insertId;
    for (let i=0;i<chosen.length;i++) {
      const optionOrder = shuffle(['A','B','C','D']);
      await connection.execute(
        'INSERT INTO attempt_questions (attempt_id,question_id,question_order,option_order) VALUES (?,?,?,?)',
        [attemptId,chosen[i].question_id,i+1,JSON.stringify(optionOrder)]
      );
    }
    await connection.commit();
    res.status(201).json({ attemptId,resumed:false,expiresAt,examMode:exam.exam_mode });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}));

router.get('/attempts/:id', asyncRoute(async (req, res) => {
  const attemptId = parseId(req.params.id,'attempt id');
  const studentId = Number(req.user.sub);
  const [[attempt]] = await pool.execute(
    'SELECT a.id,a.exam_id AS examId,a.status,a.started_at AS startedAt,a.expires_at AS expiresAt,a.submitted_at AS submittedAt,a.score,a.percentage,e.exam_mode AS examMode FROM exam_attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=? AND a.student_id=?',
    [attemptId,studentId]
  );
  if (!attempt) throw httpError(404,'Attempt not found');

  if (attempt.status === 'in_progress' && new Date() >= new Date(attempt.expiresAt)) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await gradeAttempt(connection,attemptId,'expired');
      await connection.commit();
      attempt.status = 'expired';
      attempt.score = result.score;
      attempt.percentage = result.percentage;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  const [rows] = await pool.execute(
    `SELECT aq.question_id AS id,aq.question_order AS questionOrder,q.question_text AS question,
      q.options,aq.option_order,aq.time_spent_seconds AS timeSpentSeconds,aa.selected_option_key AS selectedOption
     FROM attempt_questions aq JOIN questions q ON q.id=aq.question_id
     LEFT JOIN attempt_answers aa ON aa.attempt_id=aq.attempt_id AND aa.question_id=aq.question_id
     WHERE aq.attempt_id=? ORDER BY aq.question_order`,
    [attemptId]
  );
  const questions = rows.map(row => {
    const source = typeof row.options === 'string' ? JSON.parse(row.options) : row.options;
    const order = typeof row.option_order === 'string' ? JSON.parse(row.option_order) : row.option_order;
    const options = {};
    ['A','B','C','D'].forEach((label,index) => { options[label] = source[order[index]]; });
    return { id:row.id,questionOrder:row.questionOrder,question:row.question,options,selectedOption:row.selectedOption,timeSpentSeconds:row.timeSpentSeconds };
  });
  const result = { ...attempt,questions };
  if (attempt.status !== 'in_progress') {
    const [review] = await pool.execute(
      `SELECT q.id,q.question_text AS question,q.correct_option_key AS correctOption,aq.option_order,
        aq.time_spent_seconds AS timeSpentSeconds,aa.selected_option_key AS selectedOption,
        aqr.is_correct AS isCorrect,aqr.marks_awarded AS marksAwarded
       FROM attempt_questions aq JOIN questions q ON q.id=aq.question_id
       LEFT JOIN attempt_answers aa ON aa.attempt_id=aq.attempt_id AND aa.question_id=aq.question_id
       LEFT JOIN attempt_question_results aqr ON aqr.attempt_id=aq.attempt_id AND aqr.question_id=aq.question_id
       WHERE aq.attempt_id=? ORDER BY aq.question_order`,
      [attemptId]
    );
    result.review = review.map(row => {
      const order = typeof row.option_order === 'string' ? JSON.parse(row.option_order) : row.option_order;
      const correctDisplay = ['A','B','C','D'][order.indexOf(row.correctOption)];
      return { id:row.id,question:row.question,correctOption:correctDisplay,selectedOption:row.selectedOption,
        isCorrect:row.isCorrect,marksAwarded:row.marksAwarded,timeSpentSeconds:row.timeSpentSeconds };
    });
  }
  res.json(result);
}));

router.put('/attempts/:id/answers/:questionId', asyncRoute(async (req, res) => {
  const attemptId = parseId(req.params.id,'attempt id');
  const questionId = parseId(req.params.questionId,'question id');
  const selected = req.body.selectedOption === null ? null : String(req.body.selectedOption || '').toUpperCase();
  const timeSpentSeconds = Number(req.body.timeSpentSeconds || 0);
  if (selected !== null && !['A','B','C','D'].includes(selected)) throw httpError(400,'selectedOption must be A, B, C, D or null');
  if (!Number.isFinite(timeSpentSeconds) || timeSpentSeconds < 0 || timeSpentSeconds > 300) throw httpError(400,'timeSpentSeconds must be between 0 and 300');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[attempt]] = await connection.execute(
      'SELECT status,expires_at FROM exam_attempts WHERE id=? AND student_id=? FOR UPDATE',
      [attemptId,Number(req.user.sub)]
    );
    if (!attempt) throw httpError(404,'Attempt not found');
    if (attempt.status !== 'in_progress') throw httpError(409,'This attempt is no longer active');
    if (new Date() >= new Date(attempt.expires_at)) {
      await gradeAttempt(connection,attemptId,'expired');
      await connection.commit();
      return res.status(409).json({ error:'Time has expired; the attempt was submitted automatically' });
    }
    const [[belongs]] = await connection.execute(
      'SELECT 1 AS yes FROM attempt_questions WHERE attempt_id=? AND question_id=?',
      [attemptId,questionId]
    );
    if (!belongs) throw httpError(400,'Question does not belong to this attempt');
    await connection.execute(
      `INSERT INTO attempt_answers (attempt_id,question_id,selected_option_key) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE selected_option_key=VALUES(selected_option_key),saved_at=UTC_TIMESTAMP()`,
      [attemptId,questionId,selected]
    );
    if (timeSpentSeconds > 0) {
      await connection.execute('UPDATE attempt_questions SET time_spent_seconds=LEAST(time_spent_seconds+?,36000) WHERE attempt_id=? AND question_id=?',
        [Math.round(timeSpentSeconds),attemptId,questionId]);
    }
    await connection.commit();
    res.json({ saved:true,questionId,savedAt:new Date().toISOString() });
  } catch(error) { await connection.rollback().catch(()=>{}); throw error; }
  finally { connection.release(); }
}));

router.post('/attempts/:id/submit', asyncRoute(async (req, res) => {
  const attemptId = parseId(req.params.id,'attempt id');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[attempt]] = await connection.execute(
      'SELECT status,expires_at FROM exam_attempts WHERE id=? AND student_id=? FOR UPDATE',
      [attemptId,Number(req.user.sub)]
    );
    if (!attempt) throw httpError(404,'Attempt not found');
    if (attempt.status !== 'in_progress') {
      const [[saved]] = await connection.execute('SELECT score,percentage FROM exam_attempts WHERE id=?',[attemptId]);
      await connection.commit();
      return res.json({ alreadySubmitted:true,score:saved.score,percentage:saved.percentage });
    }
    const finalStatus = new Date() >= new Date(attempt.expires_at) ? 'expired' : 'submitted';
    const result = await gradeAttempt(connection,attemptId,finalStatus);
    await connection.commit();
    res.json({ submitted:true,result });
  } catch(error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}));

router.get('/results', asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT a.id AS attemptId,e.id AS examId,e.title,e.total_marks AS totalMarks,
      e.pass_mark AS passMark,a.status,a.score,a.percentage,a.started_at AS startedAt,a.submitted_at AS submittedAt
     FROM exam_attempts a JOIN exams e ON e.id=a.exam_id
     WHERE a.student_id=? AND a.status IN ('submitted','expired') ORDER BY a.submitted_at DESC`,
    [Number(req.user.sub)]
  );
  res.json({ data:rows });
}));

module.exports = router;
