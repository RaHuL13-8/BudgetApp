import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
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
let redirectResultReady: Promise<void> | null = null;

function ensureRedirectResultProcessed(): Promise<void> {
  if (!redirectResultReady) {
    redirectResultReady = getRedirectResult(getFirebaseAuth())
      .then(() => undefined)
      .catch((error: unknown) => {
        if (error instanceof Error && error.message.includes('auth/no-auth-event')) {
          return undefined;
        }
        throw error;
      });
  }

  return redirectResultReady;
}

function prefersRedirectFlow(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const standaloneMedia =
    typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  const standaloneNavigator = Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
  const mobileUserAgent = /android|iphone|ipad|ipod/i.test(window.navigator.userAgent);

  return standaloneMedia || standaloneNavigator || mobileUserAgent;
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

export async function initializeAuthState(): Promise<void> {
  if (!persistenceReady) {
    persistenceReady = ensureRedirectResultProcessed();
  }

  await persistenceReady;
}

export function observeAuthState(onChange: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(getFirebaseAuth(), onChange);
}

export async function signInWithGoogle(): Promise<void> {
  await initializeAuthState();

  if (prefersRedirectFlow()) {
    await signInWithRedirect(getFirebaseAuth(), googleProvider);
    return;
  }

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
