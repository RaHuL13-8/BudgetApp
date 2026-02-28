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

export type UserProfile = {
  id: string;
  username: string;
  usernameLower: string;
  friends: string[];
  createdAt: string;
};

export type UserSearchResult = {
  id: string;
  username: string;
  usernameLower: string;
};

export type FriendInsight = {
  user: UserProfile;
  isCurrentUser: boolean;
  totalSpend: number;
  topCategory: {
    name: string;
    amount: number;
  } | null;
  recentExpenses: Expense[];
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
