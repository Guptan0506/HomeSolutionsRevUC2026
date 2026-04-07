# HomeSolutions Workspace Map

This folder contains both the frontend app and the backend API used for local development.

## Folder Layout

- `frontend/` - React UI (all app screens and components)
- `backend/` - Express API and database scripts
- `docs/` - project documentation and security notes
- `public/` - static assets served by Vite
- `dist/` - production build output (generated)

## Folder Indexes

- `docs/README.md` - documentation index
- `backend/scripts/README.md` - backend script catalog and usage

## Important Root Files

- `package.json` - frontend tooling scripts (Vite, ESLint)
- `vite.config.js` - dev server and API proxy config
- `eslint.config.js` - linting rules
- `index.html` - Vite HTML entry
- `docs/SECURITY.md` - security controls and environment settings

## Run Commands

From this folder:

- `npm run dev` - start frontend
- `npm run build` - build frontend
- `npm run lint` - lint code

Backend (from `backend/`):

- `node server.js` - start API server

## Notes

- `node_modules/` and `dist/` are generated folders and should not be manually edited.
- Backend package metadata now points to `server.js` as the main entry.
