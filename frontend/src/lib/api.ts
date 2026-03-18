import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAt,
  endAt,
  Timestamp,
  Transaction,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import type { User as AuthUser } from 'firebase/auth';
import { getDb } from './firebase';
import type {
  Analytics,
  Category,
  CreateCategoryPayload,
  CreateExpensePayload,
  Expense,
  FriendInsight,
  Subcategory,
  UserProfile,
  UserSearchResult
} from './types';

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,24}$/;

const PREDEFINED_CATEGORIES: Array<{ id: string; name: string; color: string }> = [
  { id: 'food', name: 'Food', color: '#FB7185' },
  { id: 'travel', name: 'Travel', color: '#0EA5E9' },
  { id: 'shopping', name: 'Shopping', color: '#8B5CF6' },
  { id: 'bills', name: 'Bills', color: '#F97316' },
  { id: 'health', name: 'Health', color: '#22C55E' },
  { id: 'entertainment', name: 'Entertainment', color: '#EAB308' },
  { id: 'education', name: 'Education', color: '#6366F1' },
  { id: 'transport', name: 'Transport', color: '#14B8A6' },
  { id: 'gifts', name: 'Gifts', color: '#EC4899' },
  { id: 'other', name: 'Other', color: '#64748B' }
];

const LEGACY_GOOGLE_LINKS = parseLegacyGoogleLinks(import.meta.env.VITE_LEGACY_GOOGLE_LINKS);

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function authLinksCollection() {
  return collection(getDb(), 'authLinks');
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeLabelLower(value: string): string {
  return normalizeLabel(value).toLowerCase();
}

function validateUsername(value: string): string {
  const trimmed = value.trim();

  if (!USERNAME_PATTERN.test(trimmed)) {
    throw new Error('Username must be 3-24 characters using letters, numbers, underscore or hyphen.');
  }

  return trimmed;
}

function toIso(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (typeof value === 'string') {
    return value;
  }

  return new Date().toISOString();
}

function usersCollection() {
  return collection(getDb(), 'users');
}

function usernamesCollection() {
  return collection(getDb(), 'usernames');
}

function categoriesCollection(userId: string) {
  return collection(getDb(), 'users', userId, 'categories');
}

function expensesCollection(userId: string) {
  return collection(getDb(), 'users', userId, 'expenses');
}

function subcategoriesCollectionForCategoryName(categoryName: string) {
  return collection(
    getDb(),
    'globalCategorySubcategories',
    normalizeKey(categoryName),
    'items'
  );
}

function mapUserProfile(userId: string, data: Record<string, unknown>): UserProfile {
  const username = typeof data.username === 'string' ? data.username : userId;
  return {
    id: userId,
    username,
    usernameLower: typeof data.usernameLower === 'string' ? data.usernameLower : username.toLowerCase(),
    friends: Array.isArray(data.friends)
      ? data.friends.filter((friend): friend is string => typeof friend === 'string')
      : [],
    authUid: typeof data.authUid === 'string' ? data.authUid : undefined,
    authEmail: typeof data.authEmail === 'string' ? data.authEmail : undefined,
    displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
    photoUrl: typeof data.photoUrl === 'string' ? data.photoUrl : undefined,
    createdAt: toIso(data.createdAt)
  };
}

function parseLegacyGoogleLinks(value: string | undefined): Map<string, string> {
  const links = new Map<string, string>();

  if (!value) {
    return links;
  }

  for (const pair of value.split(',')) {
    const trimmedPair = pair.trim();
    if (!trimmedPair) {
      continue;
    }

    const separator = trimmedPair.includes('=') ? '=' : ':';
    const [usernameRaw, emailRaw] = trimmedPair.split(separator);
    const username = normalizeUsername(usernameRaw ?? '');
    const emailLower = (emailRaw ?? '').trim().toLowerCase();

    if (!username || !emailLower) {
      continue;
    }

    links.set(emailLower, username);
  }

  return links;
}

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function sanitizeUsernameBase(value: string): string {
  const collapsed = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  const base = collapsed || 'user';
  const sliced = base.slice(0, 24);

  if (sliced.length >= 3) {
    return sliced;
  }

  return `${sliced}${'user'.slice(sliced.length, 3)}`;
}

function buildUsernameCandidates(authUser: AuthUser): string[] {
  const emailLower = normalizeEmail(authUser.email);
  const emailBase = sanitizeUsernameBase(emailLower.split('@')[0] ?? '');
  const displayBase = sanitizeUsernameBase(authUser.displayName ?? '');
  const candidates = new Set<string>([displayBase, emailBase, `user-${emailBase}`]);

  return Array.from(candidates).filter(Boolean);
}

async function claimAvailableUsername(transaction: Transaction, authUser: AuthUser): Promise<string> {
  const candidates = buildUsernameCandidates(authUser);

  for (const candidate of candidates) {
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const proposed = suffix === 0 ? candidate : `${candidate.slice(0, Math.max(0, 24 - String(suffix).length - 1))}-${suffix}`;
      const userId = normalizeUsername(proposed);
      const usernameRef = doc(usernamesCollection(), userId);
      const usernameSnapshot = await transaction.get(usernameRef);

      if (!usernameSnapshot.exists()) {
        return userId;
      }
    }
  }

  throw new Error('Could not generate a unique username for this Google account.');
}

function buildAuthMetadata(authUser: AuthUser) {
  return {
    authUid: authUser.uid,
    authEmail: normalizeEmail(authUser.email),
    authProvider: 'google',
    displayName: authUser.displayName?.trim() ?? '',
    photoUrl: authUser.photoURL ?? '',
    updatedAt: serverTimestamp(),
    lastLoginAt: serverTimestamp()
  };
}

async function createOrLinkUserForGoogleAccount(authUser: AuthUser): Promise<string> {
  const emailLower = normalizeEmail(authUser.email);

  if (!emailLower) {
    throw new Error('Your Google account must have an email address before it can be linked.');
  }

  const authLinkRef = doc(authLinksCollection(), authUser.uid);

  return runTransaction(getDb(), async (transaction) => {
    const authLinkSnapshot = await transaction.get(authLinkRef);
    const authMetadata = buildAuthMetadata(authUser);

    if (authLinkSnapshot.exists()) {
      const linkedUserId = typeof authLinkSnapshot.data().userId === 'string' ? authLinkSnapshot.data().userId : '';
      if (!linkedUserId) {
        throw new Error('This Google account is linked to an invalid BudgetPulse profile.');
      }

      transaction.set(
        authLinkRef,
        {
          userId: linkedUserId,
          emailLower,
          ...authMetadata
        },
        { merge: true }
      );
      transaction.set(doc(usersCollection(), linkedUserId), authMetadata, { merge: true });
      return linkedUserId;
    }

    const legacyUserId = LEGACY_GOOGLE_LINKS.get(emailLower);
    if (legacyUserId) {
      const legacyUserRef = doc(usersCollection(), legacyUserId);
      const legacyUserSnapshot = await transaction.get(legacyUserRef);

      if (!legacyUserSnapshot.exists()) {
        throw new Error(`Legacy profile @${legacyUserId} was not found in Firestore.`);
      }

      const currentAuthUid = typeof legacyUserSnapshot.data().authUid === 'string' ? legacyUserSnapshot.data().authUid : '';
      if (currentAuthUid && currentAuthUid !== authUser.uid) {
        throw new Error(`@${legacyUserId} is already linked to another Google account.`);
      }

      transaction.set(
        authLinkRef,
        {
          userId: legacyUserId,
          emailLower,
          linkedAt: serverTimestamp(),
          ...authMetadata
        },
        { merge: true }
      );
      transaction.set(legacyUserRef, authMetadata, { merge: true });
      return legacyUserId;
    }

    const userId = await claimAvailableUsername(transaction, authUser);
    const usernameRef = doc(usernamesCollection(), userId);
    const userRef = doc(usersCollection(), userId);

    transaction.set(usernameRef, {
      username: userId,
      usernameLower: userId,
      userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    transaction.set(userRef, {
      username: userId,
      usernameLower: userId,
      friends: [],
      createdAt: serverTimestamp(),
      ...authMetadata
    });
    transaction.set(authLinkRef, {
      userId,
      emailLower,
      linkedAt: serverTimestamp(),
      ...authMetadata
    });
    return userId;
  });
}

async function ensureUsernameIndex(profile: UserProfile): Promise<void> {
  const indexRef = doc(usernamesCollection(), profile.id);
  const snapshot = await getDoc(indexRef);

  if (snapshot.exists()) {
    return;
  }

  await setDoc(
    indexRef,
    {
      username: profile.username,
      usernameLower: profile.usernameLower,
      userId: profile.id,
      createdAt: serverTimestamp()
    },
    { merge: true }
  );
}

async function ensureDefaultCategories(userId: string): Promise<void> {
  const categoryRef = categoriesCollection(userId);
  const existingSnapshot = await getDocs(query(categoryRef, limit(1)));

  if (!existingSnapshot.empty) {
    return;
  }

  const batch = writeBatch(getDb());

  for (const category of PREDEFINED_CATEGORIES) {
    const categoryDoc = doc(categoryRef, category.id);
    batch.set(categoryDoc, {
      name: category.name,
      nameLower: category.name.toLowerCase(),
      color: category.color,
      predefined: true,
      createdAt: serverTimestamp()
    });
  }

  await batch.commit();
}

export async function getUserByUsername(usernameInput: string): Promise<UserProfile | null> {
  const trimmed = usernameInput.trim();
  if (!trimmed) {
    return null;
  }

  const userId = normalizeUsername(trimmed);
  const userSnapshot = await getDoc(doc(usersCollection(), userId));

  if (!userSnapshot.exists()) {
    return null;
  }

  const profile = mapUserProfile(userSnapshot.id, userSnapshot.data());
  await Promise.all([ensureDefaultCategories(userId), ensureUsernameIndex(profile)]);
  return profile;
}

export async function fetchUserProfile(userId: string): Promise<UserProfile> {
  const userSnapshot = await getDoc(doc(usersCollection(), userId));

  if (!userSnapshot.exists()) {
    throw new Error('User not found.');
  }

  const profile = mapUserProfile(userSnapshot.id, userSnapshot.data());
  await Promise.all([ensureDefaultCategories(userId), ensureUsernameIndex(profile)]);
  return profile;
}

export async function createUser(usernameInput: string): Promise<UserProfile> {
  const username = validateUsername(usernameInput);
  const userId = normalizeUsername(username);
  const userRef = doc(usersCollection(), userId);
  const usernameRef = doc(usernamesCollection(), userId);

  await runTransaction(getDb(), async (transaction) => {
    const usernameSnapshot = await transaction.get(usernameRef);

    if (usernameSnapshot.exists()) {
      throw new Error('USERNAME_EXISTS');
    }

    transaction.set(usernameRef, {
      username,
      usernameLower: userId,
      userId,
      createdAt: serverTimestamp()
    });

    transaction.set(userRef, {
      username,
      usernameLower: userId,
      friends: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });

  await ensureDefaultCategories(userId);
  return fetchUserProfile(userId);
}

export async function ensureUserProfile(usernameInput: string): Promise<UserProfile> {
  const username = usernameInput.trim();
  if (!username) {
    throw new Error('Username is required.');
  }

  const existingUser = await getUserByUsername(username);
  if (existingUser) {
    return existingUser;
  }

  return createUser(username);
}

export async function ensureAuthenticatedUserProfile(authUser: AuthUser): Promise<UserProfile> {
  const userId = await createOrLinkUserForGoogleAccount(authUser);
  await ensureDefaultCategories(userId);
  return fetchUserProfile(userId);
}

export async function searchUsers(searchTerm: string, currentUserId: string): Promise<UserSearchResult[]> {
  const term = searchTerm.trim().toLowerCase();

  if (!term) {
    return [];
  }

  const usersQuery = query(
    usernamesCollection(),
    orderBy('usernameLower'),
    startAt(term),
    endAt(`${term}\uf8ff`),
    limit(10)
  );

  const snapshot = await getDocs(usersQuery);

  return snapshot.docs
    .map((item) => {
      const data = item.data();
      return {
        id: item.id,
        username: typeof data.username === 'string' ? data.username : item.id,
        usernameLower: typeof data.usernameLower === 'string' ? data.usernameLower : item.id
      } satisfies UserSearchResult;
    })
    .filter((item) => item.id !== currentUserId);
}

export async function fetchCategories(userId: string): Promise<Category[]> {
  const snapshot = await getDocs(query(categoriesCollection(userId), orderBy('name')));

  return snapshot.docs.map((item) => {
    const data = item.data();
    return {
      id: item.id,
      name: typeof data.name === 'string' ? data.name : 'Category',
      color: typeof data.color === 'string' ? data.color : '#64748B',
      predefined: Boolean(data.predefined)
    } satisfies Category;
  });
}

export async function createCategory(userId: string, payload: CreateCategoryPayload): Promise<Category> {
  const name = payload.name.trim();
  if (!name) {
    throw new Error('Category name is required.');
  }

  const nameLower = name.toLowerCase();
  const existing = await getDocs(
    query(categoriesCollection(userId), where('nameLower', '==', nameLower), limit(1))
  );

  if (!existing.empty) {
    throw new Error('Category already exists for this user.');
  }

  const categoryRef = await addDoc(categoriesCollection(userId), {
    name,
    nameLower,
    color: payload.color,
    predefined: false,
    createdAt: serverTimestamp()
  });

  return {
    id: categoryRef.id,
    name,
    color: payload.color,
    predefined: false
  };
}

export async function fetchGlobalSubcategories(categoryName: string): Promise<Subcategory[]> {
  const trimmedCategory = normalizeLabel(categoryName);
  if (!trimmedCategory) {
    return [];
  }

  const snapshot = await getDocs(
    query(subcategoriesCollectionForCategoryName(trimmedCategory), orderBy('nameLower'))
  );

  return snapshot.docs.map((item) => {
    const data = item.data();
    const name = typeof data.name === 'string' ? data.name : item.id;
    return {
      id: item.id,
      name,
      nameLower: typeof data.nameLower === 'string' ? data.nameLower : normalizeLabelLower(name)
    } satisfies Subcategory;
  });
}

function mapExpense(expenseId: string, data: Record<string, unknown>): Expense {
  return {
    id: expenseId,
    userId: typeof data.userId === 'string' ? data.userId : '',
    description: typeof data.description === 'string' ? data.description : '',
    categoryId: typeof data.categoryId === 'string' ? data.categoryId : '',
    categoryName: typeof data.categoryName === 'string' ? data.categoryName : 'Uncategorized',
    subcategoryName: typeof data.subcategoryName === 'string' ? normalizeLabel(data.subcategoryName) : '',
    isBigTicket: typeof data.isBigTicket === 'boolean' ? data.isBigTicket : false,
    amount: typeof data.amount === 'number' ? data.amount : Number(data.amount ?? 0),
    date: typeof data.date === 'string' ? data.date : new Date().toISOString().slice(0, 10),
    createdAt: toIso(data.createdAt)
  };
}

export async function fetchExpenses(userId: string): Promise<Expense[]> {
  const snapshot = await getDocs(query(expensesCollection(userId), orderBy('date', 'desc')));

  return snapshot.docs
    .map((item) => mapExpense(item.id, item.data()))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export async function createExpense(userId: string, payload: CreateExpensePayload): Promise<Expense> {
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero.');
  }

  if (!payload.categoryId) {
    throw new Error('Category is required.');
  }

  const requestedSubcategoryName = normalizeLabel(payload.subcategoryName ?? '');
  if (!requestedSubcategoryName) {
    throw new Error('Subcategory is required.');
  }

  const categorySnapshot = await getDoc(doc(categoriesCollection(userId), payload.categoryId));

  if (!categorySnapshot.exists()) {
    throw new Error('Selected category does not exist.');
  }

  const categoryData = categorySnapshot.data();
  const categoryName = typeof categoryData.name === 'string' ? categoryData.name : 'Uncategorized';
  const subcategoryName = requestedSubcategoryName;

  const expenseRef = await addDoc(expensesCollection(userId), {
    userId,
    amount,
    categoryId: payload.categoryId,
    categoryName,
    subcategoryName,
    isBigTicket: Boolean(payload.isBigTicket),
    date: payload.date,
    description: payload.description?.trim() ?? '',
    createdAt: serverTimestamp()
  });

  const createdExpense = await getDoc(expenseRef);

  if (!createdExpense.exists()) {
    throw new Error('Expense creation failed.');
  }

  return mapExpense(createdExpense.id, createdExpense.data());
}

export async function deleteExpense(userId: string, expenseId: string): Promise<void> {
  await deleteDoc(doc(expensesCollection(userId), expenseId));
}

function rangeStart(range: 'daily' | 'monthly' | 'yearly', end: Date): Date {
  if (range === 'daily') {
    const start = new Date(end);
    start.setDate(end.getDate() - 29);
    return start;
  }

  if (range === 'yearly') {
    return new Date(end.getFullYear() - 4, 0, 1);
  }

  return new Date(end.getFullYear(), end.getMonth() - 11, 1);
}

export async function fetchAnalytics(
  userId: string,
  range: 'daily' | 'monthly' | 'yearly'
): Promise<Analytics> {
  const expenses = await fetchExpenses(userId);
  const today = new Date();
  const start = rangeStart(range, today);

  const relevant = expenses.filter((expense) => {
    const expenseDate = new Date(expense.date);
    return expenseDate >= start && expenseDate <= today;
  });

  const totalsByCategory = relevant.reduce<Record<string, number>>((acc, expense) => {
    acc[expense.categoryName] = (acc[expense.categoryName] ?? 0) + expense.amount;
    return acc;
  }, {});

  return {
    range,
    totalSpend: relevant.reduce((sum, expense) => sum + expense.amount, 0),
    totalsByCategory,
    trend: []
  };
}

export async function addFriendByUsername(userId: string, friendUsername: string): Promise<void> {
  const owner = await fetchUserProfile(userId);
  const friend = await getUserByUsername(friendUsername);

  if (!friend) {
    throw new Error('No user found with that username.');
  }

  if (friend.id === userId) {
    throw new Error('You cannot add yourself to your universe.');
  }

  if (owner.friends.includes(friend.id)) {
    throw new Error('This user is already in your universe.');
  }

  await updateDoc(doc(usersCollection(), userId), {
    friends: arrayUnion(friend.id),
    updatedAt: serverTimestamp()
  });
}

function summarizeTopCategory(expenses: Expense[]): { name: string; amount: number } | null {
  const totals = new Map<string, number>();

  for (const expense of expenses) {
    totals.set(expense.categoryName, (totals.get(expense.categoryName) ?? 0) + expense.amount);
  }

  let top: { name: string; amount: number } | null = null;

  for (const [name, amount] of totals.entries()) {
    if (!top || amount > top.amount) {
      top = { name, amount };
    }
  }

  return top;
}

export async function fetchFriendInsights(userId: string): Promise<FriendInsight[]> {
  const owner = await fetchUserProfile(userId);
  const uniqueIds = Array.from(new Set([userId, ...owner.friends]));

  const profiles = (
    await Promise.all(
      uniqueIds.map(async (id) => {
        try {
          return await fetchUserProfile(id);
        } catch {
          return null;
        }
      })
    )
  ).filter((profile): profile is UserProfile => Boolean(profile));

  const expensesByUser = await Promise.all(
    profiles.map(async (profile) => {
      const expenses = await fetchExpenses(profile.id);
      return {
        profile,
        expenses
      };
    })
  );

  const insights = expensesByUser.map(({ profile, expenses }) => ({
    user: profile,
    isCurrentUser: profile.id === userId,
    expenses,
    totalSpend: expenses.reduce((sum, expense) => sum + expense.amount, 0),
    topCategory: summarizeTopCategory(expenses),
    recentExpenses: expenses.slice(0, 4)
  }));

  return insights.sort((left, right) => {
    if (left.isCurrentUser && !right.isCurrentUser) {
      return -1;
    }

    if (!left.isCurrentUser && right.isCurrentUser) {
      return 1;
    }

    return right.totalSpend - left.totalSpend;
  });
}

export async function removeFriend(userId: string, friendId: string): Promise<void> {
  const ownerRef = doc(usersCollection(), userId);
  const ownerSnapshot = await getDoc(ownerRef);

  if (!ownerSnapshot.exists()) {
    throw new Error('Owner profile not found.');
  }

  const ownerData = ownerSnapshot.data();
  const currentFriends = Array.isArray(ownerData.friends)
    ? ownerData.friends.filter((item): item is string => typeof item === 'string')
    : [];

  const nextFriends = currentFriends.filter((item) => item !== friendId);

  await setDoc(
    ownerRef,
    {
      friends: nextFriends,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}
