import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

function resolveAuthDomain(configuredAuthDomain: string): string {
  if (typeof window === 'undefined') {
    return configuredAuthDomain;
  }

  const { hostname, protocol } = window.location;
  const isLocalHost =
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.local');

  if (isLocalHost || protocol !== 'https:' || !configuredAuthDomain) {
    return configuredAuthDomain;
  }

  const shouldUseCurrentHost =
    configuredAuthDomain.endsWith('.firebaseapp.com') &&
    hostname !== configuredAuthDomain &&
    (hostname.endsWith('.web.app') || !hostname.endsWith('.firebaseapp.com'));

  return shouldUseCurrentHost ? hostname : configuredAuthDomain;
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: resolveAuthDomain(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? ''),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? ''
};

let firebaseApp: FirebaseApp | null = null;
let firestoreDb: Firestore | null = null;
let firebaseAuth: Auth | null = null;

function missingFirebaseVars(): string[] {
  return Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

export function getFirebaseApp(): FirebaseApp {
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

  return firebaseApp;
}

export function getDb(): Firestore {
  const app = getFirebaseApp();

  if (!firestoreDb) {
    firestoreDb = getFirestore(app);
  }

  return firestoreDb;
}

export function getFirebaseAuth(): Auth {
  const app = getFirebaseApp();

  if (!firebaseAuth) {
    firebaseAuth = initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
      popupRedirectResolver: browserPopupRedirectResolver
    });
  }

  return firebaseAuth;
}
