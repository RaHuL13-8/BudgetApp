import {
  GoogleAuthProvider,
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Unsubscribe,
  type User
} from 'firebase/auth';
import { getFirebaseAuth } from './firebase';

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

let persistenceReady: Promise<void> | null = null;

function ensurePersistence(): Promise<void> {
  if (!persistenceReady) {
    persistenceReady = setPersistence(getFirebaseAuth(), browserLocalPersistence);
  }

  return persistenceReady;
}

function shouldFallbackToRedirect(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('auth/popup-blocked') ||
    error.message.includes('auth/popup-closed-by-user') ||
    error.message.includes('auth/cancelled-popup-request') ||
    error.message.includes('auth/operation-not-supported-in-this-environment')
  );
}

export function observeAuthState(onChange: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(getFirebaseAuth(), onChange);
}

export async function signInWithGoogle(): Promise<void> {
  await ensurePersistence();

  try {
    await signInWithPopup(getFirebaseAuth(), googleProvider);
  } catch (error) {
    if (!shouldFallbackToRedirect(error)) {
      throw error;
    }

    await signInWithRedirect(getFirebaseAuth(), googleProvider);
  }
}

export async function signOutFromApp(): Promise<void> {
  await signOut(getFirebaseAuth());
}

export type { User as AuthUser } from 'firebase/auth';
