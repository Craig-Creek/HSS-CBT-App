const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncRoute, pageParams, parseId, httpError } = require('../utils');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

router.get('/dashboard', asyncRoute(async (req, res) => {
  const [[students]] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role='student' AND is_active=1");
  const [[groups]] = await pool.query('SELECT COUNT(*) AS total FROM student_groups');
  const [[questions]] = await pool.query('SELECT COUNT(*) AS total FROM questions');
  const [[exams]] = await pool.query("SELECT COUNT(*) AS total FROM exams WHERE status='published'");
  const [[active]] = await pool.query("SELECT COUNT(*) AS total FROM exam_attempts WHERE status='in_progress'");
  const [[submitted]] = await pool.query("SELECT COUNT(*) AS total FROM exam_attempts WHERE status='submitted'");
  res.json({ students: students.total, groups: groups.total, questions: questions.total, publishedExams: exams.total, activeAttempts: active.total, submittedAttempts: submitted.total });
}));

router.get('/users', asyncRoute(async (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  const role = ['admin', 'student'].includes(req.query.role) ? req.query.role : null;
  const search = String(req.query.search || '').trim();
  const [rows] = await pool.execute(
    `SELECT u.id,u.username,u.full_name AS fullName,u.role,u.is_active AS isActive,u.created_at AS createdAt,
       GROUP_CONCAT(DISTINCT g.name ORDER BY g.name SEPARATOR ', ') AS groups
     FROM users u LEFT JOIN group_members gm ON gm.student_id=u.id LEFT JOIN student_groups g ON g.id=gm.group_id
     WHERE (? IS NULL OR u.role=?) AND (?='' OR u.username LIKE ? OR u.full_name LIKE ?)
     GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [role, role, search, `%${search}%`, `%${search}%`, limit, offset]
  );
  const [[count]] = await pool.execute(
    "SELECT COUNT(*) AS total FROM users WHERE (? IS NULL OR role=?) AND (?='' OR username LIKE ? OR full_name LIKE ?)",
    [role, role, search, `%${search}%`, `%${search}%`]
  );
  res.json({ data: rows, pagination: { page, limit, total: count.total } });
}));

router.post('/users', asyncRoute(async (req, res) => {
  const { username, password, fullName, role = 'student', groupIds = [] } = req.body;
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(String(username || ''))) throw httpError(400, 'Username must be 3–80 characters and use letters, numbers, dots, underscores or hyphens');
  if (String(password || '').length < 10) throw httpError(400, 'Password must be at least 10 characters');
  if (!String(fullName || '').trim() || String(fullName).length > 160) throw httpError(400, 'A valid full name is required');
  if (!['admin', 'student'].includes(role)) throw httpError(400, 'Role must be admin or student');
  if (!Array.isArray(groupIds) || groupIds.length > 20 || (role === 'admin' && groupIds.length)) throw httpError(400, 'Invalid group assignments');
  const hash = await bcrypt.hash(password, 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [insert] = await connection.execute('INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,?)', [username, hash, String(fullName).trim(), role]);
    for (const rawId of [...new Set(groupIds)]) {
      const groupId = parseId(rawId, 'group id');
      await connection.execute('INSERT INTO group_members (group_id,student_id) VALUES (?,?)', [groupId, insert.insertId]);
    }
    await connection.commit();
    res.status(201).json({ id: insert.insertId, username, fullName: String(fullName).trim(), role });
  } catch (e) {
    await connection.rollback();
    if (e.code === 'ER_DUP_ENTRY') throw httpError(409, 'That username is already in use');
    throw e;
  } finally { connection.release(); }
}));

router.patch('/users/:id', asyncRoute(async (req, res) => {
  const id = parseId(req.params.id);
  const fields = [];
  const values = [];
  if (req.body.fullName !== undefined) {
    const name = String(req.body.fullName).trim();
    if (!name || name.length > 160) throw httpError(400, 'Invalid full name');
    fields.push('full_name=?'); values.push(name);
  }
  if (req.body.isActive !== undefined) {
    fields.push('is_active=?'); values.push(req.body.isActive ? 1 : 0);
  }
  if (req.body.password !== undefined) {
    if (String(req.body.password).length < 10) throw httpError(400, 'Password must be at least 10 characters');
    fields.push('password_hash=?'); values.push(await bcrypt.hash(req.body.password, 12));
  }
  if (!fields.length) throw httpError(400, 'No supported user fields supplied');
  values.push(id);
  const [result] = await pool.execute(`UPDATE users SET ${fields.join(',')} WHERE id=?`, values);
  if (!result.affectedRows) throw httpError(404, 'User not found');
  res.json({ message: 'User updated' });
}));

router.delete('/users/:id', asyncRoute(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === Number(req.user.sub)) throw httpError(400, 'You cannot deactivate your own account');
  const [result] = await pool.execute("UPDATE users SET is_active=0 WHERE id=?", [id]);
  if (!result.affectedRows) throw httpError(404, 'User not found');
  res.json({ message: 'User deactivated. Historical exam records are retained.' });
}));

router.get('/groups', asyncRoute(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT g.id,g.name,g.description,g.created_at AS createdAt,COUNT(gm.student_id) AS studentCount
     FROM student_groups g LEFT JOIN group_members gm ON gm.group_id=g.id
     GROUP BY g.id ORDER BY g.name`
  );
  res.json({ data: rows });
}));

router.post('/groups', asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 100) throw httpError(400, 'Group name is required (maximum 100 characters)');
  const [result] = await pool.execute('INSERT INTO student_groups (name,description) VALUES (?,?)', [name, req.body.description || null]);
  res.status(201).json({ id: result.insertId, name });
}));

router.patch('/groups/:id', asyncRoute(async (req, res) => {
  const id = parseId(req.params.id);
  const name = req.body.name === undefined ? undefined : String(req.body.name).trim();
  if (name !== undefined && (!name || name.length > 100)) throw httpError(400, 'Invalid group name');
  const description = req.body.description;
  const [result] = await pool.execute('UPDATE student_groups SET name=COALESCE(?,name), description=? WHERE id=?',
    [name || null, description === undefined ? null : (description || null), id]);
  if (!result.affectedRows) throw httpError(404, 'Group not found');
  res.json({ message: 'Group updated' });
}));

router.delete('/groups/:id', asyncRoute(async (req, res) => {
  const id = parseId(req.params.id);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[active]] = await connection.execute(
      "SELECT COUNT(*) AS total FROM exam_assignments ea JOIN exams e ON e.id=ea.exam_id WHERE ea.group_id=? AND e.status='published'",
      [id]
    );
    if (active.total) throw httpError(409, 'Remove published exam assignments before deleting this group');
    await connection.execute('DELETE FROM group_members WHERE group_id=?', [id]);
    await connection.execute('DELETE FROM exam_assignments WHERE group_id=?', [id]);
    const [result] = await connection.execute('DELETE FROM student_groups WHERE id=?', [id]);
    if (!result.affectedRows) throw httpError(404, 'Group not found');
    await connection.commit();
    res.json({ message: 'Group deleted' });
  } catch (e) { await connection.rollback(); throw e; }
  finally { connection.release(); }
}));

router.get('/groups/:id/members', asyncRoute(async (req, res) => {
  const id = parseId(req.params.id);
  const [rows] = await pool.execute(
    "SELECT u.id,u.username,u.full_name AS fullName,u.is_active AS isActive FROM group_members gm JOIN users u ON u.id=gm.student_id WHERE gm.group_id=? AND u.role='student' ORDER BY u.full_name",
    [id]
  );
  res.json({ data: rows });
}));

router.put('/groups/:id/members', asyncRoute(async (req, res) => {
  const id = parseId(req.params.id);
  const studentIds = req.body.studentIds;
  if (!Array.isArray(studentIds) || studentIds.length > 5000) throw httpError(400, 'studentIds must be an array of at most 5,000 students');
  const ids = [...new Set(studentIds.map(v => parseId(v, 'student id')))];
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[group]] = await connection.execute('SELECT id FROM student_groups WHERE id=? FOR UPDATE', [id]);
    if (!group) throw httpError(404, 'Group not found');
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      const [valid] = await connection.query(`SELECT id FROM users WHERE role='student' AND id IN (${placeholders})`, ids);
      if (valid.length !== ids.length) throw httpError(400, 'One or more selected users are not students');
    }
    await connection.execute('DELETE FROM group_members WHERE group_id=?', [id]);
    for (const studentId of ids) await connection.execute('INSERT INTO group_members (group_id,student_id) VALUES (?,?)', [id, studentId]);
    await connection.commit();
    res.json({ message: 'Group membership replaced', memberCount: ids.length });
  } catch (e) { await connection.rollback(); throw e; }
  finally { connection.release(); }
}));

router.get('/subjects', asyncRoute(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.id,s.name,COUNT(DISTINCT q.id) AS questionCount,COUNT(DISTINCT e.id) AS examCount
     FROM subjects s LEFT JOIN questions q ON q.subject_id=s.id LEFT JOIN exams e ON e.subject_id=s.id
     GROUP BY s.id ORDER BY s.name`
  );
  res.json({ data: rows });
}));

router.post('/subjects', asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 120) throw httpError(400, 'Subject name is required (maximum 120 characters)');
  const [result] = await pool.execute('INSERT INTO subjects (name) VALUES (?)', [name]);
  res.status(201).json({ id: result.insertId, name });
}));

router.patch('/subjects/:id', asyncRoute(async (req, res) => {
  const id = parseId(req.params.id);
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 120) throw httpError(400, 'Invalid subject name');
  const [result] = await pool.execute('UPDATE subjects SET name=? WHERE id=?', [name, id]);
  if (!result.affectedRows) throw httpError(404, 'Subject not found');
  res.json({ message: 'Subject updated' });
}));

router.delete('/subjects/:id', asyncRoute(async (req, res) => {
  const id = parseId(req.params.id);
  try {
    const [result] = await pool.execute('DELETE FROM subjects WHERE id=?', [id]);
    if (!result.affectedRows) throw httpError(404, 'Subject not found');
    res.json({ message: 'Subject deleted' });
  } catch (e) {
    if (e.code === 'ER_ROW_IS_REFERENCED_2') throw httpError(409, 'Subject is in use and cannot be deleted');
    throw e;
  }
}));

router.get('/monitor', asyncRoute(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.id AS attemptId,a.exam_id AS examId,e.title AS examTitle,
       a.student_id AS studentId,u.username,u.full_name AS studentName,
       a.status,a.started_at AS startedAt,a.expires_at AS expiresAt,
       a.submitted_at AS submittedAt,a.score,a.percentage,
       (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id=a.id) AS answeredCount,
       (SELECT COUNT(*) FROM attempt_questions aq WHERE aq.attempt_id=a.id) AS questionCount
     FROM exam_attempts a JOIN exams e ON e.id=a.exam_id JOIN users u ON u.id=a.student_id
     WHERE a.status='in_progress' ORDER BY a.started_at DESC`
  );
  res.json({ data: rows });
}));

router.get('/results', asyncRoute(async (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  const examId = req.query.examId ? parseId(req.query.examId, 'exam id') : null;
  const [rows] = await pool.execute(
    `SELECT a.id AS attemptId,a.exam_id AS examId,e.title AS examTitle,
      u.id AS studentId,u.username,u.full_name AS studentName,a.status,
      a.started_at AS startedAt,a.submitted_at AS submittedAt,a.score,a.percentage
     FROM exam_attempts a JOIN exams e ON e.id=a.exam_id JOIN users u ON u.id=a.student_id
     WHERE a.status IN ('submitted','expired') AND (? IS NULL OR a.exam_id=?)
     ORDER BY a.submitted_at DESC LIMIT ? OFFSET ?`,
    [examId, examId, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit } });
}));

module.exports = router;
