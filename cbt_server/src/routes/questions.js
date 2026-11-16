const express = require('express');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncRoute, pageParams, parseId, httpError } = require('../utils');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

function normalizeQuestion(row) {
  return {
    subject:row.subject,
    question:row.question,
    options:row.options || { A:row.option_a, B:row.option_b, C:row.option_c, D:row.option_d },
    correctOption:row.correctOption || row.correct_option,
    topic:row.topic,
    difficulty:row.difficulty,
    year:row.year,
    explanation:row.explanation
  };
}
async function insertQuestion(connection, item, userId) {
  const question = String(item.question || '').trim();
  const options = item.options;
  const correct = String(item.correctOption || '').trim().toUpperCase();
  if (!question || question.length > 10000) throw new Error('Question text is required (maximum 10,000 characters)');
  if (!options || !['A','B','C','D'].every(k => typeof options[k] === 'string' && options[k].trim())) throw new Error('Four non-empty options A, B, C and D are required');
  if (!['A','B','C','D'].includes(correct)) throw new Error('Correct option must be A, B, C or D');
  const subject = String(item.subject || '').trim();
  if (!subject || subject.length > 120) throw new Error('A valid subject is required');
  await connection.execute('INSERT IGNORE INTO subjects (name) VALUES (?)',[subject]);
  const [[subjectRow]] = await connection.execute('SELECT id FROM subjects WHERE name=?',[subject]);
  const difficulty = ['easy','medium','hard'].includes(item.difficulty) ? item.difficulty : null;
  const year = item.year ? Number(item.year) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2200)) throw new Error('Year must be a valid four-digit year');
  await connection.execute(
    `INSERT INTO questions (subject_id,topic,question_text,options,correct_option_key,explanation,difficulty,source_year,created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [subjectRow.id,item.topic || null,question,JSON.stringify(options),correct,item.explanation || null,difficulty,year,userId]
  );
}

router.get('/', asyncRoute(async (req,res) => {
  const { page,limit,offset } = pageParams(req.query);
  const search = String(req.query.search || '').trim();
  const subjectId = req.query.subjectId ? parseId(req.query.subjectId,'subject id') : null;
  const [rows] = await pool.execute(
    `SELECT q.id,q.subject_id AS subjectId,s.name AS subject,q.topic,q.question_text AS question,
      q.options,q.correct_option_key AS correctOption,q.explanation,q.difficulty,q.source_year AS year,q.created_at AS createdAt
     FROM questions q JOIN subjects s ON s.id=q.subject_id
     WHERE (?='' OR q.question_text LIKE ? OR s.name LIKE ? OR q.topic LIKE ?)
       AND (? IS NULL OR q.subject_id=?)
     ORDER BY q.created_at DESC LIMIT ? OFFSET ?`,
    [search,`%${search}%`,`%${search}%`,`%${search}%`,subjectId,subjectId,limit,offset]
  );
  const [[count]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM questions q JOIN subjects s ON s.id=q.subject_id
     WHERE (?='' OR q.question_text LIKE ? OR s.name LIKE ? OR q.topic LIKE ?) AND (? IS NULL OR q.subject_id=?)`,
    [search,`%${search}%`,`%${search}%`,`%${search}%`,subjectId,subjectId]
  );
  res.json({ data:rows,pagination:{page,limit,total:count.total} });
}));

router.post('/', asyncRoute(async (req,res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await insertQuestion(connection,normalizeQuestion(req.body),Number(req.user.sub));
    await connection.commit();
    res.status(201).json({ message:'Question created' });
  } catch(error) { await connection.rollback(); if (!error.code) throw httpError(400,error.message); throw error; }
  finally { connection.release(); }
}));

router.patch('/:id', asyncRoute(async (req,res) => {
  const id = parseId(req.params.id,'question id');
  const [[existing]] = await pool.execute('SELECT q.*,s.name AS subject FROM questions q JOIN subjects s ON s.id=q.subject_id WHERE q.id=?',[id]);
  if (!existing) throw httpError(404,'Question not found');
  const [[usage]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM exam_questions eq JOIN exams e ON e.id=eq.exam_id
     WHERE eq.question_id=? AND (e.status IN ('published','closed') OR EXISTS(SELECT 1 FROM exam_attempts a WHERE a.exam_id=e.id))`,
    [id]
  );
  if (usage.total) throw httpError(409,'This question is part of a published/closed exam or an exam attempt and is locked to preserve exam integrity');
  const currentOptions = typeof existing.options === 'string' ? JSON.parse(existing.options) : existing.options;
  const item = normalizeQuestion({
    subject:req.body.subject ?? existing.subject,
    question:req.body.question ?? existing.question_text,
    options:req.body.options ?? currentOptions,
    correctOption:req.body.correctOption ?? existing.correct_option_key,
    topic:req.body.topic ?? existing.topic,
    difficulty:req.body.difficulty ?? existing.difficulty,
    year:req.body.year ?? existing.source_year,
    explanation:req.body.explanation ?? existing.explanation
  });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const subject = String(item.subject).trim();
    await connection.execute('INSERT IGNORE INTO subjects (name) VALUES (?)',[subject]);
    const [[s]] = await connection.execute('SELECT id FROM subjects WHERE name=?',[subject]);
    const options = item.options;
    if (!item.question || !['A','B','C','D'].every(k => typeof options[k] === 'string' && options[k].trim()) || !['A','B','C','D'].includes(String(item.correctOption).toUpperCase())) throw httpError(400,'Invalid question text, options or correct option');
    await connection.execute(
      `UPDATE questions SET subject_id=?,topic=?,question_text=?,options=?,correct_option_key=?,explanation=?,difficulty=?,source_year=? WHERE id=?`,
      [s.id,item.topic || null,item.question,JSON.stringify(options),String(item.correctOption).toUpperCase(),item.explanation || null,['easy','medium','hard'].includes(item.difficulty) ? item.difficulty : null,item.year || null,id]
    );
    await connection.commit();
    res.json({ message:'Question updated' });
  } catch(error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}));

router.delete('/:id', asyncRoute(async (req,res) => {
  const id = parseId(req.params.id,'question id');
  try {
    const [result] = await pool.execute('DELETE FROM questions WHERE id=?',[id]);
    if (!result.affectedRows) throw httpError(404,'Question not found');
    res.json({ message:'Question deleted' });
  } catch(error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') throw httpError(409,'This question is used by an exam or attempt and cannot be deleted');
    throw error;
  }
}));

router.post('/import', asyncRoute(async (req,res) => {
  const format = String(req.body.format || (req.body.csv ? 'csv' : 'json')).toLowerCase();
  let rows = [];
  try {
    if (format === 'csv') {
      const csv = String(req.body.csv || req.body.data || '');
      if (!csv.trim()) throw new Error('CSV content is required');
      rows = parse(csv,{ columns:true,skip_empty_lines:true,trim:true,bom:true });
    } else if (format === 'json') {
      rows = req.body.rows;
      if (!Array.isArray(rows)) throw new Error('JSON import requires a rows array');
    } else if (format === 'xlsx') {
      const base64 = String(req.body.fileBase64 || '');
      if (!base64 || base64.length > 12 * 1024 * 1024) throw new Error('Provide an XLSX file as base64 (maximum 9 MB decoded)');
      const workbook = XLSX.read(Buffer.from(base64,'base64'),{ type:'buffer' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error('The workbook has no worksheet');
      rows = XLSX.utils.sheet_to_json(firstSheet,{ defval:'' });
    } else throw new Error('Supported import formats are csv, json and xlsx');
  } catch(error) { throw httpError(400,error.message || 'Could not read import file'); }

  if (!rows.length || rows.length > 1000) throw httpError(400,'Import between 1 and 1,000 questions at a time');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (let i=0;i<rows.length;i++) {
      try { await insertQuestion(connection,normalizeQuestion(rows[i]),Number(req.user.sub)); }
      catch(error) { throw httpError(400,`Import row ${i+2}: ${error.message}`); }
    }
    await connection.commit();
    res.status(201).json({ imported:rows.length,format });
  } catch(error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}));

module.exports = router;
