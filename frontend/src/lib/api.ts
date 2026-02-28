import axios from 'axios';
import type {
  Analytics,
  Category,
  CreateCategoryPayload,
  CreateExpensePayload,
  Expense
} from './types';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8080/api'
});

const userHeaders = (userId: string) => ({
  headers: {
    'X-User-Id': userId
  }
});

export async function fetchCategories(userId: string): Promise<Category[]> {
  const { data } = await api.get<Category[]>('/categories', userHeaders(userId));
  return data;
}

export async function createCategory(userId: string, payload: CreateCategoryPayload): Promise<Category> {
  const { data } = await api.post<Category>('/categories', payload, userHeaders(userId));
  return data;
}

export async function fetchExpenses(userId: string): Promise<Expense[]> {
  const { data } = await api.get<Expense[]>('/expenses', userHeaders(userId));
  return data;
}

export async function createExpense(userId: string, payload: CreateExpensePayload): Promise<Expense> {
  const { data } = await api.post<Expense>('/expenses', payload, userHeaders(userId));
  return data;
}

export async function deleteExpense(userId: string, expenseId: string): Promise<void> {
  await api.delete(`/expenses/${expenseId}`, userHeaders(userId));
}

export async function fetchAnalytics(
  userId: string,
  range: 'daily' | 'monthly' | 'yearly'
): Promise<Analytics> {
  const { data } = await api.get<Analytics>(`/analytics?range=${range}`, userHeaders(userId));
  return data;
}
