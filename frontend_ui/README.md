# PayOps — Standalone Vanilla Frontend

This folder contains a separate, framework-free SPA. It does not replace or modify the existing `frontend/` application. It uses HTML5, CSS3, and native JavaScript modules and connects to the existing FastAPI backend.

## Run

Start the backend first (or start the project's Docker Compose stack), then from the repository root run:

```powershell
python -m http.server 5500 --directory frontend_ui
```

Open [http://localhost:5500](http://localhost:5500). Visitors first see the PayOps landing page; use **Sign in** or **Get started** to enter the workspace. Do not open `index.html` with `file://`: the browser module loader and API CORS checks require a local HTTP server.

Default demo login:

- Email: `demo@invoiceai.local`
- Password: `Demo@123`

The API base URL defaults to `http://localhost:8000`. To change it, edit `window.PAYOPS_CONFIG.API_BASE_URL` in `index.html`, or set this in the browser console before reloading:

```js
localStorage.setItem("payops_api_base_url", "http://localhost:8000");
```

The frontend stores the backend-issued bearer token in `localStorage`, matching the existing frontend's session behavior. Use Logout on shared demo machines.

## Backend / CORS

The backend must allow the frontend origin. The project defaults and Docker Compose configuration include `http://localhost:5500`; if you use another host/port, add that exact origin to `CORS_ORIGINS` in the root `.env`.

## Connected backend features

- Login, registration, session validation and logout
- Dashboard summary, invoice trend, payment mix, alerts, upcoming and overdue invoices
- Searchable, filterable, sortable, paginated invoice list
- PDF/image upload with actual backend extraction and validation response
- Authenticated original-document preview
- Invoice extracted data, items, validations, workflow history, approve/reject/request changes and payments
- Approval queue, payment balances and vendor profiles/history
- Workspace-grounded AI chat and conversation history
- CSV invoice report export and demo workspace reset

## Coming Soon / backend limitations

- Gmail, Outlook, WhatsApp, bank, Tally and Zoho Books connections are explicitly marked Coming Soon.
- Vendor reminders, editing extracted invoice fields, invoice notes, team-member management, company profile editing and notification preferences do not have corresponding backend routes and are not simulated.
- Integrations, user role assignments and AI configuration are managed by the backend and are not changeable in this UI.

## Structure

- `index.html`: app shell and API URL configuration
- `css/`: design system, shared layout and responsive page styles
- `js/api.js`: centralized authenticated REST API client
- `js/app.js`: SPA navigation, session state and user actions
- Other `js/` modules: auth and individual product screens
- `assets/`: local brand/icon/illustration SVGs
