const { pool } = require('../db');

async function gradeAttempt(connection, attemptId, finalStatus = 'submitted') {
  const [rows] = await connection.execute(
    `SELECT aq.question_id,aq.option_order,eq.marks,q.correct_option_key,aa.selected_option_key
     FROM attempt_questions aq
     JOIN exam_attempts a ON a.id=aq.attempt_id
     JOIN exam_questions eq ON eq.exam_id=a.exam_id AND eq.question_id=aq.question_id
     JOIN questions q ON q.id=aq.question_id
     LEFT JOIN attempt_answers aa ON aa.attempt_id=aq.attempt_id AND aa.question_id=aq.question_id
     WHERE aq.attempt_id=? ORDER BY aq.question_order`,
    [attemptId]
  );

  let score = 0;
  let answered = 0;
  for (const row of rows) {
    const order = typeof row.option_order === 'string' ? JSON.parse(row.option_order) : row.option_order;
    const selected = row.selected_option_key;
    const originalOption = selected ? order[['A','B','C','D'].indexOf(selected)] : null;
    const correct = originalOption === row.correct_option_key;
    if (selected) answered++;
    if (correct) score += Number(row.marks);
    await connection.execute(
      `INSERT INTO attempt_question_results (attempt_id,question_id,is_correct,marks_awarded)
       VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE is_correct=VALUES(is_correct),marks_awarded=VALUES(marks_awarded)`,
      [attemptId,row.question_id,correct ? 1 : 0,correct ? Number(row.marks) : 0]
    );
  }

  const [[exam]] = await connection.execute(
    'SELECT e.total_marks,e.pass_mark FROM exams e JOIN exam_attempts a ON a.exam_id=e.id WHERE a.id=?',
    [attemptId]
  );
  const totalMarks = Number(exam.total_marks);
  const percentage = totalMarks > 0 ? Math.min(100, (score / totalMarks) * 100) : 0;
  await connection.execute(
    `UPDATE exam_attempts SET status=?,submitted_at=UTC_TIMESTAMP(),score=?,percentage=?
     WHERE id=? AND status='in_progress'`,
    [finalStatus,score,percentage,attemptId]
  );
  return { score, totalMarks, percentage:Number(percentage.toFixed(2)), passed:score >= Number(exam.pass_mark), answered, questionCount:rows.length };
}

async function expireOverdueAttempts() {
  const [ids] = await pool.query(
    "SELECT id FROM exam_attempts WHERE status='in_progress' AND expires_at <= UTC_TIMESTAMP() ORDER BY expires_at LIMIT 100"
  );
  for (const item of ids) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[attempt]] = await connection.execute(
        "SELECT id,status FROM exam_attempts WHERE id=? FOR UPDATE",
        [item.id]
      );
      if (attempt && attempt.status === 'in_progress') await gradeAttempt(connection,item.id,'expired');
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      console.error('Could not expire attempt',item.id,error.message);
    } finally {
      connection.release();
    }
  }
}

module.exports = { gradeAttempt, expireOverdueAttempts };
