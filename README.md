# BudgetPulse Prototype (React + Java + Firebase)

First prototype for a **multi-user budget web app** with a mobile-first UI, custom categories, and spending trend analytics.

## Stack
- Frontend: React + TypeScript + Vite + Recharts
- Backend: Java 17 + Spring Boot
- Data store: Firebase Firestore

## Current functionality
1. Add and track expenses with amount, date, category, notes.
2. Delete previously added expenses.
3. Predefined categories (Food, Travel, Shopping, Rent, Utilities, etc.).
4. Create custom categories with custom color.
5. Choose custom quick-select categories for expense entry.
6. Filter recent expense list by year, month, and start/end date (via filter popup).
7. Analytics visualizations:
   - Daily trend (last 30 days)
   - Monthly trend (last 12 months)
   - Yearly trend (last 5 years)
   - Trend filter by category (or all categories)
   - Trend filter by start/end date (via filter popup)
   - Category split chart
8. Multi-user data separation (prototype-level) via `X-User-Id` header; UI lets you switch user quickly.

## Project structure
- `frontend/` React app
- `backend/` Spring Boot API

## Prerequisites
- Node.js 18+
- Java 17+
- Maven 3.9+
- Firebase project with Firestore enabled
- Firebase service account JSON key

## Firebase setup
1. Create a Firebase project.
2. Enable Firestore.
3. Create a service account key JSON.
4. Set environment variables:
   - `FIREBASE_PROJECT_ID`
   - `GOOGLE_APPLICATION_CREDENTIALS` (absolute path to service-account JSON)

See `backend/.env.example`.

## Run backend
```bash
cd backend
export FIREBASE_PROJECT_ID=your-project-id
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/service-account.json
mvn spring-boot:run
```

Backend runs on `http://localhost:8080`.

## Run frontend
```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

## API overview
- `GET /api/categories` - list predefined + custom categories
- `POST /api/categories` - create custom category
- `GET /api/expenses` - list expenses
- `POST /api/expenses` - create expense
- `DELETE /api/expenses/{expenseId}` - delete expense
- `GET /api/analytics?range=daily|monthly|yearly` - trends and category totals

All endpoints require `X-User-Id` header.

## Deployment guidance
- Store code in GitHub.
- Frontend can be hosted on GitHub Pages, Vercel, or Netlify.
- Backend (Spring Boot) cannot run on GitHub Pages; use Render, Railway, Fly.io, or Cloud Run.
- Use a managed Firebase service account strategy (secret manager / environment secrets).

## Notes for next iteration
- Replace `X-User-Id` with real auth (Firebase Auth + JWT verification in backend).
- Add expense editing and budget goals.
- Add tests and CI workflows.
