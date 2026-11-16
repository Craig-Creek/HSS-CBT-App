const express=require('express');
const cors=require('cors');
const helmet=require('helmet');
const {rateLimit}=require('express-rate-limit');
const {checkDatabase}=require('./db');
const authRoutes=require('./routes/auth');
const questionRoutes=require('./routes/questions');
const adminRoutes=require('./routes/admin');
const adminAttemptRoutes=require('./routes/admin-attempts');
const examRoutes=require('./routes/exams');
const studentRoutes=require('./routes/student');
const app=express();
app.disable('x-powered-by');
app.use(helmet());
const origins=(process.env.CORS_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean);
app.use(cors({origin(origin,callback){if(!origin||origins.length===0||origins.includes(origin))return callback(null,true);return callback(new Error('Origin not allowed by CORS'));}}));
app.use(express.json({limit:'12mb'}));
app.use(rateLimit({windowMs:60000,limit:180,standardHeaders:true,legacyHeaders:false}));
app.get('/api/health',async(req,res)=>{
  try{await checkDatabase();return res.json({status:'ok',service:'Harmonie Spring School CBT API',database:'connected'});}
  catch(error){console.error('Database health check failed:',error.message);return res.status(503).json({status:'degraded',service:'Harmonie Spring School CBT API',database:'unavailable'});}
});
app.use('/api/auth',authRoutes);
app.use('/api/questions',questionRoutes);
app.use('/api/admin/attempts',adminAttemptRoutes);
app.use('/api/admin',adminRoutes);
app.use('/api/exams',examRoutes);
app.use('/api/student',studentRoutes);
app.use((req,res)=>res.status(404).json({error:'Endpoint not found'}));
app.use((error,req,res,next)=>{
  console.error(error);
  if(res.headersSent)return next(error);
  const status=Number.isInteger(error.status)?error.status:500;
  return res.status(status).json({error:status===500?'An unexpected server error occurred':error.message});
});
module.exports=app;
