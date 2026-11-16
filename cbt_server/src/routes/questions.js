const express = require('express');
const { parse } = require('csv-parse/sync');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();

    const [rows] = await pool.execute(
      `SELECT q.id, q.subject_id AS subjectId, s.name AS subject, q.topic,
              q.question_text AS question, q.options, q.difficulty, q.source_year AS year,
              q.created_at AS createdAt
       FROM questions q
       JOIN subjects s ON s.id = q.subject_id
       WHERE (? = '' OR q.question_text LIKE ? OR s.name LIKE ? OR q.topic LIKE ?)
       ORDER BY q.created_at DESC
       LIMIT ? OFFSET ?`,
      [search, `%${search}%`, `%${search}%`, `%${search}%`, limit, offset]
    );

    const [[count]] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM questions q JOIN subjects s ON s.id = q.subject_id
       WHERE (? = '' OR q.question_text LIKE ? OR s.name LIKE ? OR q.topic LIKE ?)`,
      [search, `%${search}%`, `%${search}%`, `%${search}%`]
    );

    return res.json({ data: rows, pagination: { page, limit, total: count.total } });
  } catch (error) {
    return next(error);
  }
});

async function getOrCreateSubject(connection, name) {
  const subject = String(name || '').trim();
  if (!subject || subject.length > 120) throw new Error('Each question needs a subject (maximum 120 characters)');
  await connection.execute('INSERT IGNORE INTO subjects (name) VALUES (?)', [subject]);
  const [rows] = await connection.execute('SELECT id FROM subjects WHERE name = ?', [subject]);
  return rows[0].id;
}

async function insertQuestion(connection, item, userId) {
  const question = String(item.question || '').trim();
  const options = item.options;
  const correct = String(item.correctOption || '').trim().toUpperCase();

  if (!question || question.length > 10000) throw new Error('Question text is required (maximum 10,000 characters)');
  if (!options || !['A', 'B', 'C', 'D'].every((key) => typeof options[key] === 'string' && options[key].trim())) {
    throw new Error('Each question must have four non-empty options: A, B, C and D');
  }
  if (!['A', 'B', 'C', 'D'].includes(correct)) throw new Error('Correct option must be A, B, C or D');

  const subjectId = await getOrCreateSubject(connection, item.subject);
  const difficulty = ['easy', 'medium', 'hard'].includes(item.difficulty) ? item.difficulty : null;
  const year = item.year ? Number(item.year) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2200)) {
    throw new Error('Year must be a valid four-digit year');
  }

  await connection.execute(
    `INSERT INTO questions
      (subject_id, topic, question_text, options, correct_option_key, explanation, difficulty, source_year, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [subjectId, item.topic || null, question, JSON.stringify(options), correct,
      item.explanation || null, difficulty, year, userId]
  );
}

router.post('/', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await insertQuestion(connection, req.body, Number(req.user.sub));
    await connection.commit();
    return res.status(201).json({ message: 'Question created' });
  } catch (error) {
    await connection.rollback();
    if (error.message && !error.code) return res.status(400).json({ error: error.message });
    return next(error);
  } finally {
    connection.release();
  }
});

router.post('/import', async (req, res, next) => {
  const csv = String(req.body.csv || '');
  if (!csv.trim()) return res.status(400).json({ error: 'Provide CSV text in the csv field' });
  if (Buffer.byteLength(csv, 'utf8') > 2 * 1024 * 1024) {
    return res.status(413).json({ error: 'CSV import is limited to 2 MB per request' });
  }

  let records;
  try {
    records = parse(csv, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch {
    return res.status(400).json({ error: 'The CSV file could not be read. Check its headers and formatting.' });
  }

  if (!records.length || records.length > 1000) {
    return res.status(400).json({ error: 'Import between 1 and 1,000 questions at a time' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      try {
        await insertQuestion(connection, {
          subject: row.subject,
          question: row.question,
          options: { A: row.option_a, B: row.option_b, C: row.option_c, D: row.option_d },
          correctOption: row.correct_option,
          topic: row.topic,
          difficulty: row.difficulty,
          year: row.year,
          explanation: row.explanation
        }, Number(req.user.sub));
      } catch (error) {
        throw new Error(`CSV row ${i + 2}: ${error.message}`);
      }
    }
    await connection.commit();
    return res.status(201).json({ imported: records.length });
  } catch (error) {
    await connection.rollback();
    if (error.message && !error.code) return res.status(400).json({ error: error.message });
    return next(error);
  } finally {
    connection.release();
  }
});

module.exports = router;
