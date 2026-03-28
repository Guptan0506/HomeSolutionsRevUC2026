# HomeSolutions

HomeSolutions is a full-stack web app for connecting customers with local home service professionals such as plumbers and electricians.

The project currently includes:

- A React + Vite frontend with a simple multi-screen flow (Home, Providers, Request Form)
- A Node.js + Express backend API
- A PostgreSQL integration for provider data and service requests

## Features

- Browse available professionals from a PostgreSQL-backed API
- View provider details including service type, hourly rate, and experience
- Submit service requests from the frontend form (UI flow currently implemented)
- Clean, mobile-friendly interface designed around a card-based layout

## Tech Stack

- Frontend: React, Vite, CSS
- Backend: Node.js, Express, CORS, dotenv
- Database: PostgreSQL (via pg)

## Project Structure

```
homesolutions-frontend/
	backend/
		server.js
		package.json
		.env
	frontend/
		src/
			App.jsx
			main.jsx
			components/
	package.json
	index.html
	vite.config.js
```

## Prerequisites

- Node.js 18+
- npm
- PostgreSQL running locally (or accessible remotely)

## Environment Variables

Create or update `backend/.env` with your PostgreSQL credentials:

```env
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_HOST=localhost
DB_PORT=5432
DB_NAME=homesolutions_db
```

## Database Requirements

The backend expects at least these tables:

- `providers`
	- `id`
	- `full_name`
	- `service_type`
	- `hourly_rate`
	- `experience_years`
- `service_requests`
	- `customer_id`
	- `provider_id`
	- `description`
	- `urgency`
	- `address`
	- `status`

## Setup and Run

### 1. Install frontend dependencies

From the project root:

```bash
npm install
```

### 2. Install backend dependencies

From the backend folder:

```bash
cd backend
npm install
```

### 3. Start backend server

From `backend/`:

```bash
node server.js
```

The API runs on:

- `http://localhost:5000`

### 4. Start frontend dev server

From the project root in a separate terminal:

```bash
npm run dev
```

The frontend runs on:

- `http://localhost:5173` (default Vite port)

## API Endpoints

- `GET /api/providers`
	- Returns all providers ordered by `full_name`
- `POST /api/requests`
	- Creates a new service request
	- Expected JSON body:

```json
{
	"customer_id": 1,
	"provider_id": 2,
	"description": "Leaking faucet in kitchen",
	"urgency": "Medium",
	"address": "123 Main St",
	"status": "Pending"
}
```

## Current Notes

- The providers screen already fetches live data from the backend.
- The request form currently demonstrates the flow in the UI and can be connected to the POST endpoint as a next step.

## Future Improvements

- Connect request form submission directly to `POST /api/requests`
- Add authentication for customers and providers
- Add request history and status tracking
- Add robust validation and error handling on both client and server
