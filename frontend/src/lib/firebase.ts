import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? ''
};

let firebaseApp: FirebaseApp | null = null;
let firestoreDb: Firestore | null = null;

function missingFirebaseVars(): string[] {
  return Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

export function getDb(): Firestore {
  const missingVars = missingFirebaseVars();
  if (missingVars.length > 0) {
    throw new Error(
      `Firebase is not configured. Missing env vars: ${missingVars.join(', ')}. ` +
        'Add them to frontend/.env before running the app.'
    );
  }

  if (!firebaseApp) {
    firebaseApp = initializeApp(firebaseConfig);
  }

  if (!firestoreDb) {
    firestoreDb = getFirestore(firebaseApp);
  }

  return firestoreDb;
}
