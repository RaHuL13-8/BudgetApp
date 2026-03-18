import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type Unsubscribe,
  type User
} from 'firebase/auth';
import { getFirebaseAuth } from './firebase';

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,24}$/;
const AUTH_EMAIL_DOMAIN = 'users.budgetpulse.app';

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function validateUsername(value: string): string {
  const normalized = normalizeUsername(value);

  if (!USERNAME_PATTERN.test(normalized)) {
    throw new Error('Username must be 3-24 characters using letters, numbers, underscore or hyphen.');
  }

  return normalized;
}

export function buildAuthEmail(username: string): string {
  return `${validateUsername(username)}@${AUTH_EMAIL_DOMAIN}`;
}

export function extractUsernameFromAuthEmail(email: string | null | undefined): string {
  const normalizedEmail = email?.trim().toLowerCase() ?? '';
  const suffix = `@${AUTH_EMAIL_DOMAIN}`;

  if (!normalizedEmail.endsWith(suffix)) {
    throw new Error('This account is not a valid BudgetPulse username/password account.');
  }

  const username = normalizedEmail.slice(0, -suffix.length);
  return validateUsername(username);
}

export async function initializeAuthState(): Promise<void> {
  return Promise.resolve();
}

export function observeAuthState(onChange: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(getFirebaseAuth(), onChange);
}

export async function signInWithPassword(username: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(getFirebaseAuth(), buildAuthEmail(username), password);
}

export async function registerWithPassword(username: string, password: string): Promise<void> {
  if (password.trim().length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  await createUserWithEmailAndPassword(getFirebaseAuth(), buildAuthEmail(username), password);
}

export async function signOutFromApp(): Promise<void> {
  await signOut(getFirebaseAuth());
}

export type { User as AuthUser } from 'firebase/auth';
