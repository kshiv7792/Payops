# PayOps

**Never manage invoices manually again.**

PayOps is a demo-ready accounts payable and invoice operations workspace for small businesses. It includes a live dashboard, demo data, invoice upload and extraction, deterministic validation, duplicate checks, approvals, payments, vendor spend, CSV export, role-based API permissions and an invoice assistant grounded in the current workspace records.

This is an operational demo, not a full accounting ERP. Sample records are explicitly seeded demo data; uploaded invoices are processed and stored separately.

## What works

- Upload PDF, PNG and JPG invoices (configurable file-size limit). Original files are retained in local storage.
- Extract text PDFs with local rules by default; use optional Tesseract OCR, Azure Document Intelligence, and/or an OpenAI-compatible extraction model.
- Review extracted values, validation results, potential duplicates, and the original invoice document.
- Edit extracted invoice values, approve or reject, and record full or partial payments.
- Browse invoices, vendors, approvals, payment balances, notifications, dashboard metrics, and monthly charts.
- Ask the assistant about overdue invoices, upcoming due dates, invoice numbers, vendor payables, duplicate flags and payments. Answers and source references are generated from records in the logged-in company.
- When an OpenAI-compatible model is configured, the assistant can rephrase deterministic database answers using only the result and linked invoice records; without credentials, the database-grounded deterministic answer is used directly.
- Run with PostgreSQL through Docker Compose or use SQLite for a quick local backend-only setup.

Without AI/OCR credentials, uploads use **DEMO_FALLBACK** mode. Text-based PDFs are still parsed locally; scanned documents require Tesseract or Azure Document Intelligence. The application marks fallback extraction and low confidence for review rather than presenting it as an AI extraction.

## Quick start with Docker

1. Copy `.env.example` to `.env`. Keep API credentials empty to use local fallback extraction.
2. From the project root, run:

   ```powershell
   docker compose up --build
   ```

3. Open [http://localhost:3000](http://localhost:3000) to view the PayOps landing page. Choose **Sign in** and use:

   - Email: `demo@invoiceai.local`
   - Password: `Demo@123`

4. FastAPI Swagger UI is available at [http://localhost:8000/docs](http://localhost:8000/docs).

Docker starts PostgreSQL, applies the Alembic migration, seeds 28 invoices and runs the Next.js frontend. Uploaded source documents and PostgreSQL data are kept in named volumes.

The separate framework-free UI in `frontend_ui/` can also be served at `http://localhost:5500`; see [frontend_ui/README.md](./frontend_ui/README.md). Its origin is included in the default CORS configuration.

## Run locally without Docker

Requirements: Python 3.12+, Node.js 20+, npm, and (optionally) Tesseract OCR for scanned PDFs/images. If no `DATABASE_URL` is set, the backend uses a local SQLite file.
Copy `.env.example` to `.env` in the project root to load the listed configuration values locally.

Backend, from the repository root:

```powershell
cd backend
uv run --python 3.12 --with-requirements requirements.txt uvicorn app.main:app --reload --port 8000
```

Frontend, in a second terminal:

```powershell
cd frontend
npm install
$env:NEXT_PUBLIC_API_URL = "http://localhost:8000"
npm run dev
```

For local PostgreSQL, set `DATABASE_URL` to a `postgresql+psycopg://...` URL before starting the backend. Apply schema changes with `alembic upgrade head` from `backend`. The API also runs `create_all` at startup for convenient local development.

## Configuration

See `.env.example`. Important settings:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string; SQLite is the local default |
| `JWT_SECRET_KEY` | Signing secret for access tokens; set a long random secret outside demos |
| `MAX_UPLOAD_MB` | Maximum accepted invoice size (default 20 MB) |
| `UPLOAD_DIR` | Local invoice document storage |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Optional OpenAI-compatible structured extraction |
| `OPENAI_BASE_URL` | Optional OpenAI-compatible API endpoint |
| `AZURE_OPENAI_*` | Optional Azure OpenAI deployment configuration |
| `AZURE_DOCUMENT_INTELLIGENCE_*` | Optional Azure prebuilt-invoice OCR |
| `DEMO_EMAIL`, `DEMO_PASSWORD` | Seeded demo account credentials |
| `CORS_ORIGINS` | Comma-separated browser origins allowed by the API |

The sign-in screen's **Try the demo workspace** shortcut uses the default demo credentials shown above. If you customize `DEMO_EMAIL` or `DEMO_PASSWORD`, enter the configured values in the sign-in form.

For scanned files in a local install, install the Tesseract executable and ensure `tesseract` is on `PATH`. The backend Docker image installs it. Configure both Azure Document Intelligence endpoint and key to enable managed OCR instead.

## Demo workflow

1. Sign in and explore dashboard insights, alerts and sample records.
2. Open **Invoices → Upload invoice** and select a real PDF or image.
3. Review extracted fields, confidence, validation findings and the attached document. Fallback or incomplete extraction is called out for manual review.
4. Approve or reject an invoice (OWNER/MANAGER), then record payment (OWNER/ACCOUNTANT).
5. Ask the AI Invoice Assistant questions such as “How many invoices are overdue?”, “What’s due this week?” or “How much did I pay this month?”
6. Export the invoice summary from Reports as CSV.

## Roles and API permissions

The API checks the bearer token and company scope on every protected request. Roles are `OWNER`, `ACCOUNTANT`, `MANAGER` and `STAFF`. Owners manage demo data and approve/pay invoices; accountants upload/edit/pay; managers approve/reject; staff can upload and read but cannot approve or change payment records. New registrations create an isolated company and owner account.

## Main API routes

- `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me`
- `GET /api/dashboard/summary`
- `GET /api/invoices`, `POST /api/invoices/upload`, `GET/PUT /api/invoices/{id}`
- `POST /api/invoices/{id}/approve`, `/reject`, `/mark-paid`
- `GET /api/approvals`, `/api/payments`, `/api/vendors`, `/api/validations`
- `POST /api/ai/chat`, `GET /api/ai/history`
- `GET /api/reports/summary.csv`, `POST /api/settings/reset-demo`
- `GET /api/health`

## Tests

From `backend`, install `requirements.txt` and run:

```powershell
pytest
```

The workflow tests cover demo seeding, grounded assistant answers, extraction from a generated real PDF, and backend role enforcement.

## Production notes

This project is designed for local client demonstrations. Before deploying publicly, set strong JWT/database secrets, add HTTPS and a managed object store, configure backups and retention, review operational logging, and add rate limiting and production-grade identity/account recovery. The demo credentials must be changed or disabled for a public deployment.
