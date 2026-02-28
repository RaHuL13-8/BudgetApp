# BudgetPulse Prototype (React + Firebase)

Mobile-first budget web app for multi-user expense tracking with categories, trends, and friend comparisons.

## Stack
- Frontend: React + TypeScript + Vite + Recharts
- Data store: Firebase Firestore (direct client SDK)
- Hosting: Any static hosting (GitHub Pages, Firebase Hosting, Render Static Site)

## Current functionality
1. Track expenses with amount, date, category, and notes.
2. Delete added expenses.
3. Use predefined categories and create custom categories.
4. Choose custom quick-select categories for fast entry.
5. Filter recent expenses by year, month, and start/end date.
6. View daily/monthly/yearly trend analytics and category split.
7. Switch profile by username (no auth in this prototype).
8. Enforce unique usernames (case-insensitive) when creating users.
9. Search users and add/remove friends.
10. Compare spending with friends (total spend chart, top category per person, and friend recents).

## Project structure
- `frontend/` React app (Firebase-only)
- `backend/` legacy Spring Boot code from earlier prototype (not required by current frontend)

## Prerequisites
- Node.js 18+
- Firebase project with Firestore enabled

## Firebase setup
1. Create Firebase project.
2. Enable Firestore database.
3. In Firebase project settings, copy Web App config values.
4. Set frontend env vars in `frontend/.env`:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`

Use `frontend/.env.example` as template.

## Run frontend
```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

## Firestore collections used
- `usernames/{normalizedUsername}`
- `users/{normalizedUsername}`
- `users/{normalizedUsername}/categories/{categoryId}`
- `users/{normalizedUsername}/expenses/{expenseId}`

## Deployment
- Deploy frontend as static site:
  - GitHub Pages
  - Firebase Hosting
  - Render Static Site

No Java backend deployment is required for this Firebase-only version.

## Notes
- This prototype has no authentication yet.
- Add Firebase Auth + Firestore rules before production use.
