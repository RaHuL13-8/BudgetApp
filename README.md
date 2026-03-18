# BudgetPulse Prototype (React + Firebase)

Mobile-first budget web app for multi-user expense tracking with categories, trends, and universe comparisons.

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
7. Enforce unique usernames (case-insensitive) when creating users.
8. Sign in with BudgetPulse user ID + password.
9. Search users and add/remove people in your universe.
10. Compare spending across your universe (total spend chart, top category per person, and recent universe activity).
11. Link existing legacy usernames like `rahul` and `sneha` to password auth on first registration.

## Project structure
- `frontend/` React app (Firebase-only)
- `backend/` legacy Spring Boot code from earlier prototype (not required by current frontend)

## Prerequisites
- Node.js 18+
- Firebase project with Firestore enabled

## Firebase setup
1. Create Firebase project.
2. Enable Firestore database.
3. Enable Firebase Authentication and turn on the Email/Password provider.
4. In Firebase project settings, copy Web App config values.
5. Set frontend env vars in `frontend/.env`:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`

Use `frontend/.env.example` as template.

On first successful password registration, the app will:
- link an existing legacy username such as `rahul` or `sneha` to that new auth account
- keep all existing expenses/categories/universe connections under the same username document id
- create a new username-based profile automatically for brand-new user IDs

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
- The UI now requires authenticated sign-in with a BudgetPulse user ID and password, but you should still add Firestore rules before production use.
- Existing data remains keyed by username in Firestore; auth is linked through `authLinks/{uid}`.
- New subcategory suggestions are derived from the current user plus their universe, rather than a global registry.
