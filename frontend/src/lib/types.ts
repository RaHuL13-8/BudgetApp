export type Category = {
  id: string;
  name: string;
  color: string;
  predefined: boolean;
};

export type Expense = {
  id: string;
  userId: string;
  description: string;
  categoryId: string;
  categoryName: string;
  amount: number;
  date: string;
  createdAt: string;
};

export type TrendPoint = {
  label: string;
  amount: number;
};

export type Analytics = {
  range: 'daily' | 'monthly' | 'yearly';
  totalSpend: number;
  totalsByCategory: Record<string, number>;
  trend: TrendPoint[];
};

export type CreateExpensePayload = {
  amount: number;
  categoryId: string;
  date: string;
  description?: string;
};

export type CreateCategoryPayload = {
  name: string;
  color: string;
};
