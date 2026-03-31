# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HomeSolutions is a full-stack web app connecting customers with home service professionals (plumbers, electricians, etc.). Built for RevUC 2026 hackathon.

## Commands

### Frontend (run from `homesolutions-frontend/`)
```bash
npm run dev       # Start Vite dev server (port 5173)
npm run build     # Production build
npm run lint      # Run ESLint
npm run preview   # Preview production build
```

### Backend (run from `homesolutions-frontend/backend/`)
```bash
node server.js    # Start Express server (port 5001)
```

### Full Dev Setup
Start backend first, then frontend — the Vite proxy requires the backend to be running.

## Architecture

```
homesolutions-frontend/
├── frontend/src/          # React app
│   ├── App.jsx            # Root component — owns all state and routing logic
│   ├── api.js             # Shared fetch utility with buildApiUrl()
│   └── components/        # Page-level components
├── backend/
│   ├── server.js          # Single-file Express API (all routes)
│   └── sql/               # Database schema
├── vite.config.js         # Proxy: /api/* → localhost:5001
└── index.html
```

### Frontend Routing
There is no React Router. Navigation is state-driven: `App.jsx` holds a `currentScreen` state string and conditionally renders components. All navigation is done by calling setter functions passed down as props.

### Authentication
- User logs in/registers → backend generates JWT token and returns it
- JWT token stored in localStorage with expiry timestamp
- Token sent in `Authorization: Bearer <token>` header on all protected requests
- Token expires after 7 days (configurable via `JWT_EXPIRY` env var)
- `requireAuth` middleware validates token signature and expiry
- Password complexity enforced: 10+ chars, 1 uppercase, 1 number, 1 special char

### API Layer
- In dev, Vite proxies `/api/*` to `http://localhost:5001` (or `VITE_PROXY_TARGET` env var)
- `api.js` exports `buildApiUrl(path)` which handles prod vs dev URL differences
- Backend auto-creates all DB tables on startup (`CREATE TABLE IF NOT EXISTS`)

### Database (Supabase PostgreSQL)
Tables: `app_users`, `service_provider`, `service_requests`, `invoices`

Key relationships:
- `service_requests` links `customer_id` → `app_users` and `sp_id` → `service_provider`
- `invoices` links to `service_requests` by `request_id`
- Request status lifecycle: `pending` → `accepted` → `in_progress` → `completed` (or `rejected`)

### Backend Environment
Requires `homesolutions-frontend/backend/.env`:
```
DB_USER=...
DB_PASSWORD=...
DB_HOST=...
DB_PORT=5432
DB_NAME=postgres
DB_SSL=true
PORT=5001
```

## Assets

Located at `homesolutions-frontend/frontend/src/Assets/`:
- `1.png` — hero section background/left-panel image (used in the split hero layout in App.jsx)
- `2.png` — favicon (referenced in `index.html`)

Import assets in JSX using a relative path: `import heroImage from './Assets/1.png'` (from `frontend/src/App.jsx`), or `import heroImage from '../Assets/1.png'` from any file under `frontend/src/components/`.

## Design System

All styles live in `frontend/src/components/App.css`. Key design tokens (CSS variables in `:root`):
- `--accent-ocean: #0f6e8c` — primary blue, used for most `btn-p` buttons, links, active states
- `--accent-coral: #ef8354` — coral/orange, used **only** for booking CTAs (`.book-now-btn`, `.hero-actions .btn-p`)
- `--ink-900/700/500/300` — text color scale (dark → light)
- `--line-soft: #dbe4ec` — default border color

**Button rules:** `.btn-p` is ocean blue by default. Coral is applied via overrides on `.book-now-btn` and `.hero-actions .btn-p` only.

**Hero layout:** Split two-column — `1.png` fills `.hero-image-panel` (left, 42%), text/stats in `.hero-content` (right). Collapses to single column on mobile.

**Typography targets:** body 15px minimum, headings 28px–48px, subheadings 18px–22px, labels 13px.

## Security (Phase 4)

See [SECURITY.md](./SECURITY.md) for comprehensive security documentation.

**Key Features:**
- JWT token-based authentication (7-day expiry)
- Strong password requirements (10+ chars, upper/number/special)
- Rate limiting on auth endpoints (5 attempts per 15 min)
- Security headers via Helmet.js
- CORS whitelisting
- Input validation & SQL injection prevention
- Token auto-expiry checking on frontend

**Environment Variables (Security):**
```
JWT_SECRET=your-32-character-secret-key
JWT_EXPIRY=7d
CORS_ALLOWED_ORIGINS=https://yourdomain.com
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=5
```
