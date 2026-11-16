# Harmonie Spring School CBT — Server

Central Node.js/Express API and MySQL database for the school's LAN-based Computer-Based Testing system.

## Architecture
- `CBT-System`: central API and database schema.
- `admin`: separate Flutter desktop application for administrators.
- `student`: separate Flutter desktop application for candidates.
- Both desktop applications communicate with this API over the school's private LAN.

## Requirements and setup
- Node.js 20 or newer
- MySQL 8.0 or newer

1. Install MySQL and create a database user.
2. Open a terminal in `cbt_server`.
3. Run `npm install`.
4. Copy `.env.example` to `.env` and configure the database and a long random JWT secret.
5. For a new database, run `database/schema.sql` in MySQL.
6. For a database created with the earlier starter schema, run `database/migrations/002_exam_lifecycle.sql` once.
7. Run `npm run create-admin` and follow the prompts to create the first administrator.
8. Run `npm run dev` or `npm start`.
9. Check `http://localhost:3000/api/health`.

For LAN access set `HOST=0.0.0.0`, allow TCP port 3000 only on the school's Windows Private network, and configure both Flutter apps to use the server PC's LAN IPv4 address. Never expose the API or MySQL directly to the public internet. Never commit `.env`.

## Question imports
All import modes accept up to 1,000 questions per request. XLSX reads the first worksheet.

CSV headers: `subject,question,option_a,option_b,option_c,option_d,correct_option,topic,difficulty,year,explanation`.
JSON: send a `rows` array with `subject`, `question`, `options` object (A/B/C/D), `correctOption`, and optional `topic`, `difficulty`, `year`, `explanation`.
XLSX: send `format: "xlsx"` and the file bytes as base64 in `fileBase64`, using the same column headers as CSV.

## API overview
All routes except health and login require a Bearer token. Admin routes require the admin role; student routes require the student role.

### Authentication
- `POST /api/auth/login`

### Administration
- `GET /api/admin/dashboard`
- `GET/POST /api/admin/users`; `PATCH/DELETE /api/admin/users/:id`
- `GET/POST /api/admin/groups`; `PATCH/DELETE /api/admin/groups/:id`
- `GET /api/admin/groups/:id/members`; `PUT /api/admin/groups/:id/members`
- `GET/POST /api/admin/subjects`; `PATCH/DELETE /api/admin/subjects/:id`
- `GET /api/admin/monitor`; `GET /api/admin/results`; `GET /api/admin/attempts/:id`

### Question bank
- `GET/POST /api/questions`; `PATCH/DELETE /api/questions/:id`
- `POST /api/questions/import` for CSV, JSON or XLSX.
- Correct answers are returned only to administrators.

### Exams
- `GET/POST /api/exams`; `PATCH/DELETE /api/exams/:id`
- `PUT /api/exams/:id/questions`; `GET /api/exams/:id/questions`
- `PUT /api/exams/:id/assignments`; `GET /api/exams/:id/assignments`
- `POST /api/exams/:id/publish`; `POST /api/exams/:id/close`
- `GET /api/exams/:id/analytics`

### Candidate lifecycle
- `GET /api/student/exams`
- `POST /api/student/exams/:examId/start` (starts or resumes)
- `GET /api/student/attempts/:id`
- `PUT /api/student/attempts/:id/answers/:questionId` (save or clear answer)
- `POST /api/student/attempts/:id/submit`
- `GET /api/student/results`

## Integrity rules
- The server randomizes and persists each candidate's question order and option order.
- The same order and saved answers are restored after reconnect.
- Correct answers are never included in an in-progress student response.
- The server enforces start/end windows and attempt duration. A background worker finalizes expired attempts.
- The Flutter client should show a saved indicator only after receiving server confirmation.
- Submission is idempotent; duplicate submissions return the stored result.
- Exams are assigned to classes/groups, not individual students.
- Attempts are limited by the exam's configured attempts allowance.
- Only draft exams can be edited; published exams cannot have their question pool or assignments changed.

The server API is the integration target for the two separate Flutter desktop applications. Live push notifications, rich-media uploads, psychometric reporting and an XLSX template generator are future enhancements, not claimed as implemented.
