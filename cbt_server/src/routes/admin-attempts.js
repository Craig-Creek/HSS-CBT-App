const express=require('express');
const {pool}=require('../db');
const {authenticate,requireRole}=require('../middleware/auth');
const {asyncRoute,parseId,httpError}=require('../utils');
const router=express.Router();
router.use(authenticate,requireRole('admin'));

router.get('/:id',asyncRoute(async(req,res)=>{
  const id=parseId(req.params.id,'attempt id');
  const [[attempt]]=await pool.execute(
    `SELECT a.id,a.exam_id AS examId,e.title AS examTitle,a.student_id AS studentId,u.username,u.full_name AS studentName,
      a.status,a.started_at AS startedAt,a.expires_at AS expiresAt,a.submitted_at AS submittedAt,a.score,a.percentage,
      e.total_marks AS totalMarks,e.pass_mark AS passMark
     FROM exam_attempts a JOIN exams e ON e.id=a.exam_id JOIN users u ON u.id=a.student_id WHERE a.id=?`,[id]);
  if(!attempt) throw httpError(404,'Attempt not found');
  const [answers]=await pool.execute(
    `SELECT q.id,q.question_text AS question,aa.selected_option_key AS selectedOption,
      q.correct_option_key AS correctOption,aqr.is_correct AS isCorrect,aqr.marks_awarded AS marksAwarded,
      q.options,aq.option_order,aq.question_order AS questionOrder
     FROM attempt_questions aq JOIN questions q ON q.id=aq.question_id
     LEFT JOIN attempt_answers aa ON aa.attempt_id=aq.attempt_id AND aa.question_id=aq.question_id
     LEFT JOIN attempt_question_results aqr ON aqr.attempt_id=aq.attempt_id AND aqr.question_id=aq.question_id
     WHERE aq.attempt_id=? ORDER BY aq.question_order`,[id]);
  const review=answers.map(row=>{
    const opts=typeof row.options==='string'?JSON.parse(row.options):row.options;
    const order=typeof row.option_order==='string'?JSON.parse(row.option_order):row.option_order;
    const displayed={};
    ['A','B','C','D'].forEach((key,index)=>displayed[key]=opts[order[index]]);
    const correctDisplay=['A','B','C','D'][order.indexOf(row.correctOption)];
    return {id:row.id,question:row.question,questionOrder:row.questionOrder,options:displayed,
      selectedOption:row.selectedOption,correctOption:attempt.status==='in_progress'?undefined:correctDisplay,
      isCorrect:attempt.status==='in_progress'?undefined:row.isCorrect,marksAwarded:row.marksAwarded};
  });
  res.json({attempt,questions:review});
}));
module.exports=router;
