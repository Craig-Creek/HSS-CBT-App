const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncRoute, pageParams, parseId, httpError } = require('../utils');
const router = express.Router();
router.use(authenticate,requireRole('admin'));

function validateExam(body) {
  const title=String(body.title||'').trim(), subjectId=parseId(body.subjectId,'subject id');
  const duration=Number(body.durationMinutes), questionCount=Number(body.questionCount);
  const totalMarks=Number(body.totalMarks), passMark=Number(body.passMark??0);
  const attemptsAllowed=Number(body.attemptsAllowed??1);
  if(!title||title.length>180) throw httpError(400,'Exam title is required (maximum 180 characters)');
  if(!Number.isInteger(duration)||duration<1||duration>600) throw httpError(400,'Duration must be between 1 and 600 minutes');
  if(!Number.isInteger(questionCount)||questionCount<1||questionCount>500) throw httpError(400,'Question count must be between 1 and 500');
  if(!Number.isFinite(totalMarks)||totalMarks<=0||!Number.isFinite(passMark)||passMark<0||passMark>totalMarks) throw httpError(400,'Check total marks and pass mark');
  if(!Number.isInteger(attemptsAllowed)||attemptsAllowed<1||attemptsAllowed>10) throw httpError(400,'Attempts allowed must be from 1 to 10');
  const startsAt=body.startsAt||null, endsAt=body.endsAt||null;
  if(startsAt&&Number.isNaN(new Date(startsAt).getTime())) throw httpError(400,'Invalid exam start date');
  if(endsAt&&Number.isNaN(new Date(endsAt).getTime())) throw httpError(400,'Invalid exam end date');
  if(startsAt&&endsAt&&new Date(endsAt)<=new Date(startsAt)) throw httpError(400,'Exam end time must be after start time');
  return {title,subjectId,duration,questionCount,totalMarks,passMark,attemptsAllowed,startsAt,endsAt,instructions:body.instructions||null};
}

router.get('/',asyncRoute(async(req,res)=>{
  const {page,limit,offset}=pageParams(req.query), search=String(req.query.search||'').trim();
  const status=['draft','published','closed'].includes(req.query.status)?req.query.status:null;
  const [rows]=await pool.execute(
    `SELECT e.id,e.title,e.subject_id AS subjectId,s.name AS subject,e.instructions,
      e.duration_minutes AS durationMinutes,e.question_count AS questionCount,e.total_marks AS totalMarks,
      e.pass_mark AS passMark,e.attempts_allowed AS attemptsAllowed,e.status,e.starts_at AS startsAt,e.ends_at AS endsAt,
      e.created_at AS createdAt,(SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id=e.id) AS questionPoolCount,
      (SELECT COUNT(*) FROM exam_assignments ea WHERE ea.exam_id=e.id) AS assignedGroupCount
     FROM exams e JOIN subjects s ON s.id=e.subject_id
     WHERE (? IS NULL OR e.status=?) AND (?='' OR e.title LIKE ? OR s.name LIKE ?)
     ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
    [status,status,search,`%${search}%`,`%${search}%`,limit,offset]);
  res.json({data:rows,pagination:{page,limit}});
}));

router.post('/',asyncRoute(async(req,res)=>{
  const x=validateExam(req.body);
  const [subject]=await pool.execute('SELECT id FROM subjects WHERE id=?',[x.subjectId]);
  if(!subject.length) throw httpError(400,'Subject does not exist');
  const [result]=await pool.execute(
    `INSERT INTO exams(title,subject_id,instructions,duration_minutes,question_count,total_marks,pass_mark,attempts_allowed,starts_at,ends_at,created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    [x.title,x.subjectId,x.instructions,x.duration,x.questionCount,x.totalMarks,x.passMark,x.attemptsAllowed,x.startsAt,x.endsAt,Number(req.user.sub)]);
  res.status(201).json({id:result.insertId,message:'Exam created as draft'});
}));

router.patch('/:id',asyncRoute(async(req,res)=>{
  const id=parseId(req.params.id), [[existing]]=await pool.execute('SELECT status FROM exams WHERE id=?',[id]);
  if(!existing) throw httpError(404,'Exam not found');
  if(existing.status!=='draft') throw httpError(409,'Only draft exams can be edited');
  const x=validateExam(req.body);
  const [subject]=await pool.execute('SELECT id FROM subjects WHERE id=?',[x.subjectId]);
  if(!subject.length) throw httpError(400,'Subject does not exist');
  await pool.execute(
    `UPDATE exams SET title=?,subject_id=?,instructions=?,duration_minutes=?,question_count=?,total_marks=?,pass_mark=?,attempts_allowed=?,starts_at=?,ends_at=? WHERE id=?`,
    [x.title,x.subjectId,x.instructions,x.duration,x.questionCount,x.totalMarks,x.passMark,x.attemptsAllowed,x.startsAt,x.endsAt,id]);
  res.json({message:'Draft exam updated'});
}));

router.put('/:id/questions',asyncRoute(async(req,res)=>{
  const id=parseId(req.params.id), questions=req.body.questions;
  if(!Array.isArray(questions)||!questions.length||questions.length>2000) throw httpError(400,'Provide a question array');
  const [[exam]]=await pool.execute('SELECT status,question_count,subject_id FROM exams WHERE id=?',[id]);
  if(!exam) throw httpError(404,'Exam not found');
  if(exam.status!=='draft') throw httpError(409,'Questions can only be changed while the exam is a draft');
  const normalized=questions.map(q=>({id:parseId(q.questionId,'question id'),marks:Number(q.marks??1)}));
  if(new Set(normalized.map(q=>q.id)).size!==normalized.length) throw httpError(400,'Duplicate questions are not allowed');
  if(normalized.some(q=>!Number.isFinite(q.marks)||q.marks<=0)) throw httpError(400,'Every question must have positive marks');
  const connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    const ids=normalized.map(q=>q.id), placeholders=ids.map(()=>'?').join(',');
    const [valid]=await connection.query(`SELECT id FROM questions WHERE id IN(${placeholders}) AND subject_id=?`,[...ids,exam.subject_id]);
    if(valid.length!==ids.length) throw httpError(400,'All selected questions must exist and belong to the exam subject');
    await connection.execute('DELETE FROM exam_questions WHERE exam_id=?',[id]);
    for(const q of normalized) await connection.execute('INSERT INTO exam_questions(exam_id,question_id,marks) VALUES(?,?,?)',[id,q.id,q.marks]);
    await connection.commit();
    res.json({message:'Question pool saved',questionPoolCount:normalized.length,questionsPerAttempt:exam.question_count});
  }catch(e){await connection.rollback();throw e;}finally{connection.release();}
}));

router.get('/:id/questions',asyncRoute(async(req,res)=>{
  const id=parseId(req.params.id);
  const [rows]=await pool.execute(
    `SELECT q.id,q.subject_id AS subjectId,s.name AS subject,q.topic,q.question_text AS question,q.options,q.difficulty,q.source_year AS year,eq.marks
     FROM exam_questions eq JOIN questions q ON q.id=eq.question_id JOIN subjects s ON s.id=q.subject_id
     WHERE eq.exam_id=? ORDER BY q.id`,[id]);
  res.json({data:rows});
}));

router.put('/:id/assignments',asyncRoute(async(req,res)=>{
  const id=parseId(req.params.id), groupIds=req.body.groupIds;
  if(!Array.isArray(groupIds)||!groupIds.length||groupIds.length>500) throw httpError(400,'Assign the exam to at least one group');
  const ids=[...new Set(groupIds.map(v=>parseId(v,'group id')))];
  const [[exam]]=await pool.execute('SELECT status FROM exams WHERE id=?',[id]);
  if(!exam) throw httpError(404,'Exam not found');
  if(exam.status!=='draft') throw httpError(409,'Assignments can only be changed while the exam is a draft');
  const placeholders=ids.map(()=>'?').join(',');
  const [valid]=await pool.query(`SELECT id FROM student_groups WHERE id IN(${placeholders})`,ids);
  if(valid.length!==ids.length) throw httpError(400,'One or more groups do not exist');
  const connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    await connection.execute('DELETE FROM exam_assignments WHERE exam_id=?',[id]);
    for(const groupId of ids) await connection.execute('INSERT INTO exam_assignments(exam_id,group_id) VALUES(?,?)',[id,groupId]);
    await connection.commit();
    res.json({message:'Exam assigned to groups',groupCount:ids.length});
  }catch(e){await connection.rollback();throw e;}finally{connection.release();}
}));

router.get('/:id/assignments',asyncRoute(async(req,res)=>{
  const id=parseId(req.params.id);
  const [rows]=await pool.execute('SELECT g.id,g.name,g.description FROM exam_assignments ea JOIN student_groups g ON g.id=ea.group_id WHERE ea.exam_id=? ORDER BY g.name',[id]);
  res.json({data:rows});
}));

router.post('/:id/publish',asyncRoute(async(req,res)=>{
  const id=parseId(req.params.id), connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    const [[exam]]=await connection.execute('SELECT * FROM exams WHERE id=? FOR UPDATE',[id]);
    if(!exam) throw httpError(404,'Exam not found');
    if(exam.status!=='draft') throw httpError(409,'Only draft exams can be published');
    const [[poolInfo]]=await connection.execute('SELECT COUNT(*) AS total,MIN(marks) AS minMarks,MAX(marks) AS maxMarks FROM exam_questions WHERE exam_id=?',[id]);
    const [[groupInfo]]=await connection.execute('SELECT COUNT(*) AS total FROM exam_assignments WHERE exam_id=?',[id]);
    if(poolInfo.total<exam.question_count) throw httpError(400,`Add at least ${exam.question_count} questions to the question pool`);
    if(groupInfo.total<1) throw httpError(400,'Assign the exam to at least one class or group');
    const expected=Number(exam.total_marks)/Number(exam.question_count);
    if(Math.abs(Number(poolInfo.minMarks)-expected)>0.011||Math.abs(Number(poolInfo.maxMarks)-expected)>0.011)
      throw httpError(400,'Every question in the randomized pool must have equal marks: total marks divided by questions per attempt.');
    await connection.execute("UPDATE exams SET status='published' WHERE id=?",[id]);
    await connection.commit();
    res.json({message:'Exam published',id});
  }catch(e){await connection.rollback();throw e;}finally{connection.release();}
}));

router.post('/:id/close',asyncRoute(async(req,res)=>{
  const id=parseId(req.params.id);
  const [result]=await pool.execute("UPDATE exams SET status='closed' WHERE id=? AND status='published'",[id]);
  if(!result.affectedRows) throw httpError(409,'Exam is not currently published');
  res.json({message:'Exam closed'});
}));

router.delete('/:id',asyncRoute(async(req,res)=>{
  const id=parseId(req.params.id),connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    const [[exam]]=await connection.execute('SELECT status FROM exams WHERE id=? FOR UPDATE',[id]);
    if(!exam) throw httpError(404,'Exam not found');
    if(exam.status!=='draft') throw httpError(409,'Only draft exams can be deleted');
    const [[attempts]]=await connection.execute('SELECT COUNT(*) AS total FROM exam_attempts WHERE exam_id=?',[id]);
    if(attempts.total) throw httpError(409,'An exam with candidate attempts cannot be deleted');
    await connection.execute('DELETE FROM exam_assignments WHERE exam_id=?',[id]);
    await connection.execute('DELETE FROM exam_questions WHERE exam_id=?',[id]);
    await connection.execute('DELETE FROM exams WHERE id=?',[id]);
    await connection.commit();
    res.json({message:'Draft exam deleted'});
  }catch(e){await connection.rollback();throw e;}finally{connection.release();}
}));

router.get('/:id/analytics',asyncRoute(async(req,res)=>{
  const id=parseId(req.params.id);
  const [[summary]]=await pool.execute(
    `SELECT COUNT(*) AS attempts,SUM(status IN('submitted','expired')) AS completed,SUM(status='in_progress') AS inProgress,
      AVG(CASE WHEN status IN('submitted','expired') THEN percentage END) AS averagePercentage,
      MAX(percentage) AS highestPercentage,MIN(percentage) AS lowestPercentage
     FROM exam_attempts WHERE exam_id=?`,[id]);
  const [topics]=await pool.execute(
    `SELECT COALESCE(q.topic,'Uncategorised') AS topic,COUNT(*) AS responses,
      SUM(aqr.is_correct=1) AS correct,AVG(aqr.is_correct)*100 AS accuracy,
      AVG(aq.time_spent_seconds) AS averageTimeSpentSeconds
     FROM attempt_questions aq JOIN questions q ON q.id=aq.question_id
     JOIN attempt_question_results aqr ON aqr.attempt_id=aq.attempt_id AND aqr.question_id=aq.question_id
     JOIN exam_attempts a ON a.id=aq.attempt_id WHERE a.exam_id=? GROUP BY q.topic ORDER BY q.topic`,[id]);
  res.json({summary,topicBreakdown:topics});
}));
module.exports=router;
