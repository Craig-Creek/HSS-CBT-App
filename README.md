# Harmonie Spring School CBT — Server

Central Node.js API and MySQL database for the Harmonie Spring School Computer-Based Testing system.

## Architecture

- `CBT-System`: this server and database.
- `admin`: separate Flutter desktop application for school administrators.
- `student`: separate Flutter desktop application for candidates.
- The two Flutter applications communicate with this API over the school's private LAN.

## Requirements

- Node.js 20 or newer
- MySQL 8.0 or newer

## Run locally

1. Install MySQL and create a database user for this application.
2. Open a terminal in `cbt_server`.
3. Run `npm install`.
4. Copy `.env.example` to `.env` and enter the local database credentials.
5. Run `database/schema.sql` in MySQL Workbench or the MySQL command line.
6. Run `npm run dev` for development or `npm start` for normal startup.
7. Open `http://localhost:3000/api/health`. A healthy response reports both API and database status.

For LAN access, set `HOST=0.0.0.0`, allow TCP port 3000 only on the school's Private network in Windows Firewall, and configure both Flutter applications to use the server PC's LAN IPv4 address. Do not expose this service directly to the public internet.

## Environment

See `.env.example`. Never commit `.env`, database passwords, or production signing secrets.

## Current API

- `GET /api/health` — service and database health.
- `POST /api/auth/login` — username/password login; returns a signed access token.
- `GET /api/questions` — administrator question-bank listing.
- `POST /api/questions` — administrator manual question creation.
- `POST /api/questions/import` — administrator CSV question import.

Question import CSV headers: `subject,question,option_a,option_b,option_c,option_d,correct_option,topic,difficulty,year,explanation`. Correct option must be A, B, C, or D. The subject is created automatically if it does not exist.

## Important exam security rules

- Correct answers stay on the server and are never included in student exam payloads.
- The server, not the client, will select and persist a randomized question order for each attempt.
- A candidate's question order must remain unchanged on reconnect.
- Exam timing and expiry are enforced by the server.
- Answer saves must be authenticated and restricted to the candidate's active attempt.
- Submission and marking must be server-side and idempotent.

This repository is the initial server foundation. Complete exam lifecycle, administration, monitoring, imports for spreadsheet formats, and result reporting will be added in subsequent implementation stages.
