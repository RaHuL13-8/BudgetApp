import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  addFriendByUsername,
  createCategory,
  createExpense,
  createUser,
  deleteExpense,
  ensureUserProfile,
  fetchCategories,
  fetchExpenses,
  fetchFriendInsights,
  getUserByUsername,
  removeFriend,
  searchUsers
} from './lib/api';
import type { Category, Expense, FriendInsight, UserSearchResult } from './lib/types';

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2
});

const USER_STORAGE_KEY = 'budget-user-id';
const DEFAULT_USERNAME = 'demo_user_1';
const FRIEND_SERIES_COLORS = ['#22C55E', '#38BDF8', '#F59E0B', '#A78BFA', '#FB7185', '#14B8A6', '#F97316'];

type MobileTab = 'add' | 'trends' | 'recent' | 'friends';
type FriendPreset = 'all' | 'month' | 'quarter' | 'ytd' | 'custom';

const todayISO = () => new Date().toISOString().slice(0, 10);

function monthName(monthCode: string): string {
  const month = Number(monthCode);
  if (!month || month < 1 || month > 12) {
    return monthCode;
  }
  return new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(2024, month - 1, 1));
}

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function rangeWindowStart(range: 'daily' | 'monthly' | 'yearly', endDate: Date): Date {
  if (range === 'daily') {
    const start = new Date(endDate);
    start.setDate(endDate.getDate() - 29);
    return start;
  }

  if (range === 'yearly') {
    return new Date(endDate.getFullYear() - 4, 0, 1);
  }

  return new Date(endDate.getFullYear(), endDate.getMonth() - 11, 1);
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

function filterExpensesByPresetRange(expenses: Expense[], range: 'daily' | 'monthly' | 'yearly'): Expense[] {
  const endDate = new Date();
  const startDate = rangeWindowStart(range, endDate);

  return expenses.filter((expense) => {
    const expenseDate = parseIsoDate(expense.date);
    return expenseDate >= startDate && expenseDate <= endDate;
  });
}

function buildTrendData(
  expenses: Expense[],
  range: 'daily' | 'monthly' | 'yearly',
  selectedCategoryId: string,
  startDate: string,
  endDate: string
): Array<{ label: string; amount: number }> {
  const now = new Date();
  const keyTotals = new Map<string, { label: string; amount: number }>();
  const pad = (value: number) => String(value).padStart(2, '0');
  const toDateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit' });
  const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' });

  const filteredExpenses =
    selectedCategoryId === 'all'
      ? expenses
      : expenses.filter((expense) => expense.categoryId === selectedCategoryId);

  const normalizedEnd = endDate
    ? parseIsoDate(endDate)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let normalizedStart: Date;

  if (startDate) {
    normalizedStart = parseIsoDate(startDate);
  } else {
    normalizedStart = rangeWindowStart(range, normalizedEnd);
  }

  if (normalizedStart > normalizedEnd) {
    return [];
  }

  if (range === 'daily') {
    const cursor = new Date(normalizedStart);
    while (cursor <= normalizedEnd) {
      const key = toDateKey(cursor);
      keyTotals.set(key, { label: dayFmt.format(cursor), amount: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
  } else if (range === 'yearly') {
    for (let year = normalizedStart.getFullYear(); year <= normalizedEnd.getFullYear(); year += 1) {
      const key = String(year);
      keyTotals.set(key, { label: key, amount: 0 });
    }
  } else {
    const cursor = new Date(normalizedStart.getFullYear(), normalizedStart.getMonth(), 1);
    const endMonth = new Date(normalizedEnd.getFullYear(), normalizedEnd.getMonth(), 1);

    while (cursor <= endMonth) {
      const key = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`;
      keyTotals.set(key, { label: monthFmt.format(cursor), amount: 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  for (const expense of filteredExpenses) {
    const expenseDate = parseIsoDate(expense.date);
    if (expenseDate < normalizedStart || expenseDate > normalizedEnd) {
      continue;
    }

    let key: string;
    if (range === 'daily') {
      key = expense.date;
    } else if (range === 'yearly') {
      key = expense.date.slice(0, 4);
    } else {
      key = expense.date.slice(0, 7);
    }

    const bucket = keyTotals.get(key);
    if (!bucket) {
      continue;
    }

    bucket.amount += Number(expense.amount);
    keyTotals.set(key, bucket);
  }

  return Array.from(keyTotals.values());
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    if (error.message === 'USERNAME_EXISTS') {
      return 'Username already exists. Choose a different username.';
    }
    return error.message;
  }
  return fallback;
}

export default function App() {
  const [userId, setUserId] = useState(() => localStorage.getItem(USER_STORAGE_KEY) ?? DEFAULT_USERNAME);
  const [userName, setUserName] = useState(userId);
  const [draftSwitchUsername, setDraftSwitchUsername] = useState(userId);
  const [draftCreateUsername, setDraftCreateUsername] = useState('');

  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [friendInsights, setFriendInsights] = useState<FriendInsight[]>([]);

  const [range, setRange] = useState<'daily' | 'monthly' | 'yearly'>('monthly');
  const [trendCategoryId, setTrendCategoryId] = useState('all');
  const [mobileTab, setMobileTab] = useState<MobileTab>('add');
  const [mobileTrendView, setMobileTrendView] = useState<'trend' | 'split'>('trend');
  const [recentPage, setRecentPage] = useState(1);

  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isTrendFilterModalOpen, setIsTrendFilterModalOpen] = useState(false);
  const [isRecentFilterModalOpen, setIsRecentFilterModalOpen] = useState(false);
  const [isQuickSelectModalOpen, setIsQuickSelectModalOpen] = useState(false);
  const [isFriendFilterModalOpen, setIsFriendFilterModalOpen] = useState(false);

  const [quickCategoryIds, setQuickCategoryIds] = useState<string[]>([]);
  const [draftQuickCategoryIds, setDraftQuickCategoryIds] = useState<string[]>([]);

  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayISO());
  const [description, setDescription] = useState('');

  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('#0EA5E9');

  const [selectedExpenseYear, setSelectedExpenseYear] = useState('all');
  const [selectedExpenseMonth, setSelectedExpenseMonth] = useState('all');
  const [recentStartDate, setRecentStartDate] = useState('');
  const [recentEndDate, setRecentEndDate] = useState('');
  const [trendStartDate, setTrendStartDate] = useState('');
  const [trendEndDate, setTrendEndDate] = useState('');

  const [friendSearchTerm, setFriendSearchTerm] = useState('');
  const [friendSearchResults, setFriendSearchResults] = useState<UserSearchResult[]>([]);
  const [friendFilterPreset, setFriendFilterPreset] = useState<FriendPreset>('all');
  const [friendFilterYear, setFriendFilterYear] = useState('all');
  const [friendFilterMonth, setFriendFilterMonth] = useState('all');
  const [friendFilterStartDate, setFriendFilterStartDate] = useState('');
  const [friendFilterEndDate, setFriendFilterEndDate] = useState('');
  const [includeMeInFriendComparison, setIncludeMeInFriendComparison] = useState(true);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchingFriends, setSearchingFriends] = useState(false);
  const [managingProfile, setManagingProfile] = useState(false);
  const [addingFriendUsername, setAddingFriendUsername] = useState('');
  const [removingFriendId, setRemovingFriendId] = useState('');
  const [deletingExpenseId, setDeletingExpenseId] = useState('');
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const profile = await ensureUserProfile(userId);

      if (profile.id !== userId) {
        setUserId(profile.id);
        return;
      }

      const [categoryData, expenseData, friendData] = await Promise.all([
        fetchCategories(profile.id),
        fetchExpenses(profile.id),
        fetchFriendInsights(profile.id)
      ]);

      setUserName(profile.username);
      setCategories(categoryData);
      setExpenses(expenseData);
      setFriendInsights(friendData);
      setCategoryId((current) => {
        if (categoryData.length === 0) {
          return '';
        }

        if (current && categoryData.some((category) => category.id === current)) {
          return current;
        }

        return categoryData[0].id;
      });
    } catch (requestError) {
      setError(readErrorMessage(requestError, 'Failed to load budget data from Firebase.'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    localStorage.setItem(USER_STORAGE_KEY, userId);
    setDraftSwitchUsername(userId);
    setSelectedExpenseYear('all');
    setSelectedExpenseMonth('all');
    setRecentStartDate('');
    setRecentEndDate('');
    setTrendStartDate('');
    setTrendEndDate('');
    setTrendCategoryId('all');
    setFriendSearchTerm('');
    setFriendSearchResults([]);
    setFriendFilterPreset('all');
    setFriendFilterYear('all');
    setFriendFilterMonth('all');
    setFriendFilterStartDate('');
    setFriendFilterEndDate('');
    setIncludeMeInFriendComparison(true);
    setIsTrendFilterModalOpen(false);
    setIsRecentFilterModalOpen(false);
    setIsQuickSelectModalOpen(false);
    setIsFriendFilterModalOpen(false);
    setShowCategoryForm(false);

    try {
      const rawQuickCategories = localStorage.getItem(`budget-quick-categories-${userId}`);
      if (!rawQuickCategories) {
        setQuickCategoryIds([]);
      } else {
        const parsed = JSON.parse(rawQuickCategories);
        if (Array.isArray(parsed)) {
          setQuickCategoryIds(parsed.filter((value): value is string => typeof value === 'string'));
        } else {
          setQuickCategoryIds([]);
        }
      }
    } catch {
      setQuickCategoryIds([]);
    }
  }, [userId]);

  useEffect(() => {
    localStorage.setItem(`budget-quick-categories-${userId}`, JSON.stringify(quickCategoryIds));
  }, [quickCategoryIds, userId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const rangeExpenses = useMemo(() => filterExpensesByPresetRange(expenses, range), [expenses, range]);

  const totalThisRange = useMemo(
    () => rangeExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0),
    [rangeExpenses]
  );

  const pieData = useMemo(() => {
    const totalsByCategory = new Map<string, number>();
    for (const expense of rangeExpenses) {
      totalsByCategory.set(
        expense.categoryName,
        (totalsByCategory.get(expense.categoryName) ?? 0) + Number(expense.amount)
      );
    }

    const colorByName = new Map(categories.map((category) => [category.name, category.color]));

    return Array.from(totalsByCategory.entries())
      .map(([name, value]) => ({
        name,
        value,
        color: colorByName.get(name) ?? '#64748B'
      }))
      .sort((left, right) => right.value - left.value);
  }, [categories, rangeExpenses]);

  const isTrendRangeInvalid = Boolean(trendStartDate && trendEndDate && trendStartDate > trendEndDate);

  const trendData = useMemo(() => {
    if (isTrendRangeInvalid) {
      return [];
    }
    return buildTrendData(expenses, range, trendCategoryId, trendStartDate, trendEndDate);
  }, [expenses, range, trendCategoryId, trendStartDate, trendEndDate, isTrendRangeInvalid]);

  const selectedTrendCategoryName = useMemo(() => {
    if (trendCategoryId === 'all') {
      return 'All categories';
    }

    return categories.find((category) => category.id === trendCategoryId)?.name ?? 'All categories';
  }, [categories, trendCategoryId]);

  const quickCategories = useMemo(() => {
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const selected = quickCategoryIds
      .map((categoryIdValue) => categoryById.get(categoryIdValue))
      .filter((category): category is Category => Boolean(category));

    return selected.length > 0 ? selected : categories.slice(0, 8);
  }, [categories, quickCategoryIds]);

  const expenseYears = useMemo(() => {
    const years = new Set(expenses.map((expense) => expense.date.slice(0, 4)));
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [expenses]);

  const expenseMonths = useMemo(() => {
    const months = new Set(
      expenses
        .filter((expense) => selectedExpenseYear === 'all' || expense.date.startsWith(selectedExpenseYear))
        .map((expense) => expense.date.slice(5, 7))
    );

    return Array.from(months).sort((a, b) => a.localeCompare(b));
  }, [expenses, selectedExpenseYear]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter((expense) => {
      const year = expense.date.slice(0, 4);
      const month = expense.date.slice(5, 7);
      const yearMatch = selectedExpenseYear === 'all' || year === selectedExpenseYear;
      const monthMatch = selectedExpenseMonth === 'all' || month === selectedExpenseMonth;
      const startMatch = !recentStartDate || expense.date >= recentStartDate;
      const endMatch = !recentEndDate || expense.date <= recentEndDate;
      return yearMatch && monthMatch && startMatch && endMatch;
    });
  }, [expenses, selectedExpenseYear, selectedExpenseMonth, recentStartDate, recentEndDate]);

  const isRecentRangeInvalid = Boolean(recentStartDate && recentEndDate && recentStartDate > recentEndDate);
  const recentPageSize = 4;
  const totalRecentPages = Math.max(1, Math.ceil(filteredExpenses.length / recentPageSize));

  const paginatedRecentExpenses = useMemo(() => {
    const from = (recentPage - 1) * recentPageSize;
    const to = from + recentPageSize;
    return filteredExpenses.slice(from, to);
  }, [filteredExpenses, recentPage]);

  const friendIdSet = useMemo(() => {
    const insight = friendInsights.find((item) => item.isCurrentUser);
    return new Set(insight?.user.friends ?? []);
  }, [friendInsights]);

  const friendOnlyInsights = useMemo(() => friendInsights.filter((item) => !item.isCurrentUser), [friendInsights]);

  const friendAllExpenses = useMemo(
    () => friendInsights.flatMap((item) => item.expenses),
    [friendInsights]
  );

  const friendExpenseYears = useMemo(() => {
    const years = new Set(friendAllExpenses.map((expense) => expense.date.slice(0, 4)));
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [friendAllExpenses]);

  const friendExpenseMonths = useMemo(() => {
    const months = new Set(
      friendAllExpenses
        .filter((expense) => friendFilterYear === 'all' || expense.date.startsWith(friendFilterYear))
        .map((expense) => expense.date.slice(5, 7))
    );
    return Array.from(months).sort((a, b) => a.localeCompare(b));
  }, [friendAllExpenses, friendFilterYear]);

  const isFriendRangeInvalid = Boolean(
    friendFilterStartDate && friendFilterEndDate && friendFilterStartDate > friendFilterEndDate
  );

  const filteredFriendInsights = useMemo(() => {
    if (isFriendRangeInvalid) {
      return [];
    }

    return friendInsights.map((item) => {
      const filteredExpenses = item.expenses.filter((expense) => {
        const year = expense.date.slice(0, 4);
        const month = expense.date.slice(5, 7);
        const yearMatch = friendFilterYear === 'all' || year === friendFilterYear;
        const monthMatch = friendFilterMonth === 'all' || month === friendFilterMonth;
        const startMatch = !friendFilterStartDate || expense.date >= friendFilterStartDate;
        const endMatch = !friendFilterEndDate || expense.date <= friendFilterEndDate;
        return yearMatch && monthMatch && startMatch && endMatch;
      });

      return {
        ...item,
        expenses: filteredExpenses,
        totalSpend: filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0),
        topCategory: summarizeTopCategory(filteredExpenses),
        recentExpenses: filteredExpenses.slice(0, 4)
      };
    });
  }, [
    friendInsights,
    friendFilterYear,
    friendFilterMonth,
    friendFilterStartDate,
    friendFilterEndDate,
    isFriendRangeInvalid
  ]);

  const friendInsightsForComparison = useMemo(
    () => filteredFriendInsights.filter((item) => includeMeInFriendComparison || !item.isCurrentUser),
    [filteredFriendInsights, includeMeInFriendComparison]
  );

  const friendComparisonData = useMemo(
    () =>
      friendInsightsForComparison.map((item) => ({
        name: item.isCurrentUser ? `${item.user.username} (You)` : item.user.username,
        amount: Number(item.totalSpend.toFixed(2))
      })),
    [friendInsightsForComparison]
  );

  const friendSeries = useMemo(
    () =>
      friendInsightsForComparison.map((item, index) => ({
        key: item.user.id,
        label: item.isCurrentUser ? `${item.user.username} (You)` : item.user.username,
        color: FRIEND_SERIES_COLORS[index % FRIEND_SERIES_COLORS.length]
      })),
    [friendInsightsForComparison]
  );

  const friendCategoryComparisonData = useMemo(() => {
    if (friendInsightsForComparison.length <= 1) {
      return [];
    }

    const categoryTotals = new Map<string, number>();
    const byUser = new Map<string, Map<string, number>>();

    for (const item of friendInsightsForComparison) {
      const userMap = new Map<string, number>();
      for (const expense of item.expenses) {
        userMap.set(expense.categoryName, (userMap.get(expense.categoryName) ?? 0) + expense.amount);
      }
      byUser.set(item.user.id, userMap);
      for (const [category, amount] of userMap.entries()) {
        categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + amount);
      }
    }

    const topCategories = Array.from(categoryTotals.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([category]) => category);

    return topCategories.map((category) => {
      const row: Record<string, string | number> = { category };
      for (const series of friendSeries) {
        row[series.key] = Number((byUser.get(series.key)?.get(category) ?? 0).toFixed(2));
      }
      return row;
    });
  }, [friendInsightsForComparison, friendSeries]);

  const filteredFriendOnlyInsights = useMemo(
    () => filteredFriendInsights.filter((item) => !item.isCurrentUser),
    [filteredFriendInsights]
  );

  const friendHighlights = useMemo(() => {
    if (friendInsightsForComparison.length === 0) {
      return null;
    }

    const highestSpender = [...friendInsightsForComparison].sort((a, b) => b.totalSpend - a.totalSpend)[0];
    const mostActive = [...friendInsightsForComparison].sort((a, b) => b.expenses.length - a.expenses.length)[0];
    const topCategoryTotals = new Map<string, number>();

    for (const item of friendInsightsForComparison) {
      for (const expense of item.expenses) {
        topCategoryTotals.set(
          expense.categoryName,
          (topCategoryTotals.get(expense.categoryName) ?? 0) + expense.amount
        );
      }
    }

    const topCategoryEntry = Array.from(topCategoryTotals.entries()).sort((a, b) => b[1] - a[1])[0] ?? null;

    return {
      highestSpender,
      mostActive,
      topCategoryEntry
    };
  }, [friendInsightsForComparison]);

  const friendFilterSummary = useMemo(() => {
    const segments: string[] = [];
    segments.push(friendFilterPreset === 'custom' ? 'Custom range' : friendFilterPreset.toUpperCase());
    if (friendFilterYear !== 'all') {
      segments.push(friendFilterYear);
    }
    if (friendFilterMonth !== 'all') {
      segments.push(monthName(friendFilterMonth));
    }
    if (friendFilterStartDate || friendFilterEndDate) {
      segments.push(`${friendFilterStartDate || '...'} to ${friendFilterEndDate || '...'}`);
    }
    segments.push(includeMeInFriendComparison ? 'Including me' : 'Friends only');
    return segments.join(' • ');
  }, [
    friendFilterPreset,
    friendFilterYear,
    friendFilterMonth,
    friendFilterStartDate,
    friendFilterEndDate,
    includeMeInFriendComparison
  ]);

  useEffect(() => {
    if (selectedExpenseYear !== 'all' && !expenseYears.includes(selectedExpenseYear)) {
      setSelectedExpenseYear('all');
    }
  }, [expenseYears, selectedExpenseYear]);

  useEffect(() => {
    if (selectedExpenseMonth !== 'all' && !expenseMonths.includes(selectedExpenseMonth)) {
      setSelectedExpenseMonth('all');
    }
  }, [expenseMonths, selectedExpenseMonth]);

  useEffect(() => {
    if (friendFilterYear !== 'all' && !friendExpenseYears.includes(friendFilterYear)) {
      setFriendFilterYear('all');
    }
  }, [friendExpenseYears, friendFilterYear]);

  useEffect(() => {
    if (friendFilterMonth !== 'all' && !friendExpenseMonths.includes(friendFilterMonth)) {
      setFriendFilterMonth('all');
    }
  }, [friendExpenseMonths, friendFilterMonth]);

  useEffect(() => {
    if (trendCategoryId !== 'all' && !categories.some((category) => category.id === trendCategoryId)) {
      setTrendCategoryId('all');
    }
  }, [categories, trendCategoryId]);

  useEffect(() => {
    setQuickCategoryIds((previous) => {
      const filtered = previous.filter((id) => categories.some((category) => category.id === id));
      return filtered.length === previous.length ? previous : filtered;
    });
  }, [categories]);

  useEffect(() => {
    setMobileTrendView('trend');
  }, [range, trendCategoryId, trendStartDate, trendEndDate]);

  useEffect(() => {
    setRecentPage(1);
  }, [filteredExpenses.length, selectedExpenseYear, selectedExpenseMonth, recentStartDate, recentEndDate]);

  useEffect(() => {
    if (recentPage > totalRecentPages) {
      setRecentPage(totalRecentPages);
    }
  }, [recentPage, totalRecentPages]);

  useEffect(() => {
    const anyModalOpen =
      isUserModalOpen ||
      isTrendFilterModalOpen ||
      isRecentFilterModalOpen ||
      isQuickSelectModalOpen ||
      isFriendFilterModalOpen ||
      showCategoryForm;

    if (!anyModalOpen) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsUserModalOpen(false);
        setIsTrendFilterModalOpen(false);
        setIsRecentFilterModalOpen(false);
        setIsQuickSelectModalOpen(false);
        setIsFriendFilterModalOpen(false);
        setShowCategoryForm(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isUserModalOpen,
    isTrendFilterModalOpen,
    isRecentFilterModalOpen,
    isQuickSelectModalOpen,
    isFriendFilterModalOpen,
    showCategoryForm
  ]);

  function openQuickSelectModal() {
    setDraftQuickCategoryIds(
      quickCategoryIds.length > 0 ? quickCategoryIds : categories.slice(0, 8).map((category) => category.id)
    );
    setIsQuickSelectModalOpen(true);
  }

  function toggleDraftQuickCategory(categoryIdValue: string) {
    setDraftQuickCategoryIds((current) => {
      if (current.includes(categoryIdValue)) {
        return current.filter((id) => id !== categoryIdValue);
      }

      if (current.length >= 8) {
        return current;
      }

      return [...current, categoryIdValue];
    });
  }

  function saveQuickSelectCategories() {
    setQuickCategoryIds(draftQuickCategoryIds);
    setIsQuickSelectModalOpen(false);
  }

  async function onAddExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAmount = Number(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || !categoryId) {
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await createExpense(userId, {
        amount: parsedAmount,
        categoryId,
        date: expenseDate,
        description: description.trim()
      });

      setAmount('');
      setDescription('');
      await loadData();
    } catch (requestError) {
      setError(readErrorMessage(requestError, 'Failed to add expense.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function onAddCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!newCategoryName.trim()) {
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const created = await createCategory(userId, {
        name: newCategoryName.trim(),
        color: newCategoryColor
      });

      setCategories((previous) => [...previous, created].sort((a, b) => a.name.localeCompare(b.name)));
      setCategoryId(created.id);
      setNewCategoryName('');
      setShowCategoryForm(false);
    } catch (requestError) {
      setError(readErrorMessage(requestError, 'Failed to create category.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function onDeleteExpense(expenseId: string) {
    if (!window.confirm('Delete this expense permanently?')) {
      return;
    }

    setDeletingExpenseId(expenseId);
    setError('');

    try {
      await deleteExpense(userId, expenseId);
      await loadData();
    } catch (requestError) {
      setError(readErrorMessage(requestError, 'Failed to delete expense.'));
    } finally {
      setDeletingExpenseId('');
    }
  }

  async function onSwitchExistingUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setManagingProfile(true);
    setError('');

    try {
      const existing = await getUserByUsername(draftSwitchUsername);
      if (!existing) {
        throw new Error('Username not found. Create it first.');
      }

      setUserId(existing.id);
      setDraftCreateUsername('');
      setIsUserModalOpen(false);
    } catch (requestError) {
      setError(readErrorMessage(requestError, 'Failed to switch user.'));
    } finally {
      setManagingProfile(false);
    }
  }

  async function onCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setManagingProfile(true);
    setError('');

    try {
      const created = await createUser(draftCreateUsername);
      setUserId(created.id);
      setDraftSwitchUsername(created.username);
      setDraftCreateUsername('');
      setIsUserModalOpen(false);
    } catch (requestError) {
      setError(readErrorMessage(requestError, 'Failed to create user.'));
    } finally {
      setManagingProfile(false);
    }
  }

  async function onSearchFriends(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!friendSearchTerm.trim()) {
      setFriendSearchResults([]);
      return;
    }

    setSearchingFriends(true);
    setError('');

    try {
      const results = await searchUsers(friendSearchTerm, userId);
      setFriendSearchResults(results);
    } catch (requestError) {
      setError(readErrorMessage(requestError, 'Failed to search usernames.'));
    } finally {
      setSearchingFriends(false);
    }
  }

  async function onAddFriend(username: string) {
    setAddingFriendUsername(username);
    setError('');

    try {
      await addFriendByUsername(userId, username);
      setFriendSearchResults((previous) => previous.filter((item) => item.username !== username));
      await loadData();
    } catch (requestError) {
      setError(readErrorMessage(requestError, 'Failed to add friend.'));
    } finally {
      setAddingFriendUsername('');
    }
  }

  async function onRemoveFriend(friendId: string) {
    setRemovingFriendId(friendId);
    setError('');

    try {
      await removeFriend(userId, friendId);
      await loadData();
    } catch (requestError) {
      setError(readErrorMessage(requestError, 'Failed to remove friend.'));
    } finally {
      setRemovingFriendId('');
    }
  }

  function applyFriendPreset(preset: FriendPreset) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    setFriendFilterPreset(preset);

    if (preset === 'all') {
      setFriendFilterYear('all');
      setFriendFilterMonth('all');
      setFriendFilterStartDate('');
      setFriendFilterEndDate('');
      return;
    }

    let start: Date;
    if (preset === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (preset === 'quarter') {
      start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    } else {
      start = new Date(now.getFullYear(), 0, 1);
    }

    setFriendFilterStartDate(start.toISOString().slice(0, 10));
    setFriendFilterEndDate(today);
  }

  return (
    <main className="page-shell">
      <div className="bg-orb bg-orb-top" />
      <div className="bg-orb bg-orb-bottom" />

      <section className="hero-card glass">
        <div>
          <p className="eyebrow app-title">BudgetPulse</p>
          <p className="hero-quote">Track today so tomorrow feels lighter.</p>
          <p className="hero-user">@{userName}</p>
        </div>
        <button
          type="button"
          className="profile-btn"
          onClick={() => {
            setDraftSwitchUsername(userName);
            setDraftCreateUsername('');
            setIsUserModalOpen(true);
          }}
          aria-label="Open profile and user switch"
          title={`Current user: ${userName}`}
        >
          <span>{userName.trim().charAt(0).toUpperCase() || 'U'}</span>
        </button>
      </section>

      {isUserModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsUserModalOpen(false)}>
          <div className="modal-card glass profile-modal-card" onClick={(event) => event.stopPropagation()}>
            <h3>Profile</h3>
            <p>Current username: @{userName}</p>

            <form className="user-switcher" onSubmit={onSwitchExistingUser}>
              <label htmlFor="switchUser">Switch to existing username</label>
              <input
                id="switchUser"
                value={draftSwitchUsername}
                onChange={(event) => setDraftSwitchUsername(event.target.value)}
                placeholder="e.g. rahul_13"
              />
              <button type="submit" className="secondary" disabled={managingProfile}>
                {managingProfile ? 'Switching...' : 'Switch User'}
              </button>
            </form>

            <form className="user-switcher" onSubmit={onCreateUser}>
              <label htmlFor="createUser">Create new username</label>
              <input
                id="createUser"
                value={draftCreateUsername}
                onChange={(event) => setDraftCreateUsername(event.target.value)}
                placeholder="3-24 chars: letters, numbers, _, -"
              />
              <button type="submit" className="primary" disabled={managingProfile}>
                {managingProfile ? 'Creating...' : 'Create User'}
              </button>
            </form>

            <section className="profile-friends-block">
              <div className="profile-friends-head">
                <h4>Manage Friends</h4>
                <p>Search and add, or remove existing friends.</p>
              </div>
              <form className="profile-friend-search" onSubmit={onSearchFriends}>
                <input
                  value={friendSearchTerm}
                  onChange={(event) => setFriendSearchTerm(event.target.value)}
                  placeholder="Search username to add friend"
                />
                <button type="submit" className="secondary" disabled={searchingFriends}>
                  {searchingFriends ? 'Searching...' : 'Search'}
                </button>
              </form>

              {friendSearchResults.length > 0 ? (
                <ul className="friend-search-results profile-search-results">
                  {friendSearchResults.map((item) => {
                    const alreadyAdded = friendIdSet.has(item.id);

                    return (
                      <li key={item.id}>
                        <span>@{item.username}</span>
                        <button
                          type="button"
                          className="primary"
                          disabled={alreadyAdded || addingFriendUsername === item.username}
                          onClick={() => onAddFriend(item.username)}
                        >
                          {alreadyAdded
                            ? 'Added'
                            : addingFriendUsername === item.username
                              ? 'Adding...'
                              : 'Add'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {friendOnlyInsights.length > 0 ? (
                <div className="friend-chip-row profile-friend-chip-row">
                  {friendOnlyInsights.map((item) => (
                    <div key={item.user.id} className="friend-chip">
                      <span>@{item.user.username}</span>
                      <button
                        type="button"
                        className="danger-btn"
                        onClick={() => onRemoveFriend(item.user.id)}
                        disabled={removingFriendId === item.user.id}
                      >
                        {removingFriendId === item.user.id ? '...' : 'Remove'}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No friends added yet.</p>
              )}
            </section>

            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setIsUserModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isTrendFilterModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsTrendFilterModalOpen(false)}>
          <div className="modal-card glass filter-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Trend Filters</h3>
            <div className="range-switch">
              {(['daily', 'monthly', 'yearly'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={range === key ? 'range-btn active' : 'range-btn'}
                  onClick={() => setRange(key)}
                >
                  {key}
                </button>
              ))}
            </div>
            <div className="modal-filter-grid">
              <label htmlFor="trendCategory">Category</label>
              <select
                id="trendCategory"
                value={trendCategoryId}
                onChange={(event) => setTrendCategoryId(event.target.value)}
              >
                <option value="all">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <label htmlFor="trendStartDate">Start Date</label>
              <input
                id="trendStartDate"
                type="date"
                value={trendStartDate}
                onChange={(event) => setTrendStartDate(event.target.value)}
              />
              <label htmlFor="trendEndDate">End Date</label>
              <input
                id="trendEndDate"
                type="date"
                value={trendEndDate}
                onChange={(event) => setTrendEndDate(event.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setRange('monthly');
                  setTrendCategoryId('all');
                  setTrendStartDate('');
                  setTrendEndDate('');
                }}
              >
                Reset
              </button>
              <button type="button" className="primary" onClick={() => setIsTrendFilterModalOpen(false)}>
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isRecentFilterModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsRecentFilterModalOpen(false)}>
          <div className="modal-card glass filter-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Recent Filters</h3>
            <div className="modal-filter-grid">
              <label htmlFor="expenseYearFilter">Year</label>
              <select
                id="expenseYearFilter"
                value={selectedExpenseYear}
                onChange={(event) => setSelectedExpenseYear(event.target.value)}
              >
                <option value="all">All years</option>
                {expenseYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
              <label htmlFor="expenseMonthFilter">Month</label>
              <select
                id="expenseMonthFilter"
                value={selectedExpenseMonth}
                onChange={(event) => setSelectedExpenseMonth(event.target.value)}
              >
                <option value="all">All months</option>
                {expenseMonths.map((month) => (
                  <option key={month} value={month}>
                    {monthName(month)}
                  </option>
                ))}
              </select>
              <label htmlFor="recentStartDate">Start Date</label>
              <input
                id="recentStartDate"
                type="date"
                value={recentStartDate}
                onChange={(event) => setRecentStartDate(event.target.value)}
              />
              <label htmlFor="recentEndDate">End Date</label>
              <input
                id="recentEndDate"
                type="date"
                value={recentEndDate}
                onChange={(event) => setRecentEndDate(event.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setSelectedExpenseYear('all');
                  setSelectedExpenseMonth('all');
                  setRecentStartDate('');
                  setRecentEndDate('');
                }}
              >
                Reset
              </button>
              <button type="button" className="primary" onClick={() => setIsRecentFilterModalOpen(false)}>
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isFriendFilterModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsFriendFilterModalOpen(false)}>
          <div className="modal-card glass filter-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Friend Comparison Filters</h3>
            <div className="friend-preset-row">
              <button
                type="button"
                className={friendFilterPreset === 'all' ? 'range-btn active' : 'range-btn'}
                onClick={() => applyFriendPreset('all')}
              >
                All Time
              </button>
              <button
                type="button"
                className={friendFilterPreset === 'month' ? 'range-btn active' : 'range-btn'}
                onClick={() => applyFriendPreset('month')}
              >
                This Month
              </button>
              <button
                type="button"
                className={friendFilterPreset === 'quarter' ? 'range-btn active' : 'range-btn'}
                onClick={() => applyFriendPreset('quarter')}
              >
                Last 3 Months
              </button>
              <button
                type="button"
                className={friendFilterPreset === 'ytd' ? 'range-btn active' : 'range-btn'}
                onClick={() => applyFriendPreset('ytd')}
              >
                YTD
              </button>
            </div>
            <div className="modal-filter-grid friend-filter-grid">
              <label htmlFor="friendYearFilter">Year</label>
              <select
                id="friendYearFilter"
                value={friendFilterYear}
                onChange={(event) => {
                  setFriendFilterPreset('custom');
                  setFriendFilterYear(event.target.value);
                }}
              >
                <option value="all">All years</option>
                {friendExpenseYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>

              <label htmlFor="friendMonthFilter">Month</label>
              <select
                id="friendMonthFilter"
                value={friendFilterMonth}
                onChange={(event) => {
                  setFriendFilterPreset('custom');
                  setFriendFilterMonth(event.target.value);
                }}
              >
                <option value="all">All months</option>
                {friendExpenseMonths.map((month) => (
                  <option key={month} value={month}>
                    {monthName(month)}
                  </option>
                ))}
              </select>

              <label htmlFor="friendStartDate">Start Date</label>
              <input
                id="friendStartDate"
                type="date"
                value={friendFilterStartDate}
                onChange={(event) => {
                  setFriendFilterPreset('custom');
                  setFriendFilterStartDate(event.target.value);
                }}
              />

              <label htmlFor="friendEndDate">End Date</label>
              <input
                id="friendEndDate"
                type="date"
                value={friendFilterEndDate}
                onChange={(event) => {
                  setFriendFilterPreset('custom');
                  setFriendFilterEndDate(event.target.value);
                }}
              />
            </div>

            <label className="friend-include-toggle">
              <input
                type="checkbox"
                checked={includeMeInFriendComparison}
                onChange={(event) => setIncludeMeInFriendComparison(event.target.checked)}
              />
              Include my profile in comparisons
            </label>

            {isFriendRangeInvalid ? (
              <p className="muted">Start date must be on or before end date.</p>
            ) : null}

            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setFriendFilterPreset('all');
                  setFriendFilterYear('all');
                  setFriendFilterMonth('all');
                  setFriendFilterStartDate('');
                  setFriendFilterEndDate('');
                  setIncludeMeInFriendComparison(true);
                }}
              >
                Reset
              </button>
              <button type="button" className="primary" onClick={() => setIsFriendFilterModalOpen(false)}>
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isQuickSelectModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsQuickSelectModalOpen(false)}>
          <div className="modal-card glass filter-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Quick Select Categories</h3>
            <p>Choose up to 8 categories for quick chips.</p>
            <div className="quick-category-grid">
              {categories.map((category) => {
                const checked = draftQuickCategoryIds.includes(category.id);
                const disabled = !checked && draftQuickCategoryIds.length >= 8;

                return (
                  <label
                    key={category.id}
                    className={disabled ? 'quick-category-item disabled' : 'quick-category-item'}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleDraftQuickCategory(category.id)}
                    />
                    <span className="quick-category-dot" style={{ backgroundColor: category.color }} />
                    <span>{category.name}</span>
                  </label>
                );
              })}
            </div>
            <p className="quick-category-count">{draftQuickCategoryIds.length}/8 selected</p>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setIsQuickSelectModalOpen(false)}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={saveQuickSelectCategories}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCategoryForm ? (
        <div className="modal-backdrop" onClick={() => setShowCategoryForm(false)}>
          <div className="modal-card glass filter-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Create Custom Category</h3>
            <p>Add a custom category for faster expense tracking.</p>
            <form className="category-modal-form" onSubmit={onAddCategory}>
              <label htmlFor="customCategoryName">Category name</label>
              <input
                id="customCategoryName"
                placeholder="e.g. Subscriptions"
                maxLength={30}
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                autoFocus
              />
              <label htmlFor="customCategoryColor">Category color</label>
              <div className="category-color-row">
                <input
                  id="customCategoryColor"
                  type="color"
                  value={newCategoryColor}
                  onChange={(event) => setNewCategoryColor(event.target.value)}
                />
                <span>{newCategoryColor.toUpperCase()}</span>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary" onClick={() => setShowCategoryForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary" disabled={submitting}>
                  {submitting ? 'Adding...' : 'Add Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {error ? <p className="error-banner">{error}</p> : null}

      <section className="metrics-grid">
        <article className="metric-card glass">
          <p>Spend ({range})</p>
          <h2>{currency.format(totalThisRange)}</h2>
        </article>
        <article className="metric-card glass">
          <p>Tracked Expenses</p>
          <h2>{expenses.length}</h2>
        </article>
        <article className="metric-card glass">
          <p>Friends Connected</p>
          <h2>{friendOnlyInsights.length}</h2>
        </article>
      </section>

      <nav className="mobile-tabs glass" aria-label="Mobile sections">
        <button
          type="button"
          className={mobileTab === 'add' ? 'mobile-tab-btn active' : 'mobile-tab-btn'}
          onClick={() => setMobileTab('add')}
        >
          Add
        </button>
        <button
          type="button"
          className={mobileTab === 'trends' ? 'mobile-tab-btn active' : 'mobile-tab-btn'}
          onClick={() => setMobileTab('trends')}
        >
          Trends
        </button>
        <button
          type="button"
          className={mobileTab === 'recent' ? 'mobile-tab-btn active' : 'mobile-tab-btn'}
          onClick={() => setMobileTab('recent')}
        >
          Recent
        </button>
        <button
          type="button"
          className={mobileTab === 'friends' ? 'mobile-tab-btn active' : 'mobile-tab-btn'}
          onClick={() => setMobileTab('friends')}
        >
          Friends
        </button>
      </nav>

      <div className="mobile-main">
        <section className="content-grid">
          <article
            className={mobileTab === 'add' ? 'panel glass mobile-panel-add is-active' : 'panel glass mobile-panel-add'}
          >
            <div className="panel-head">
              <h3>Add Expense</h3>
              <span>Every entry sharpens your money decisions.</span>
            </div>

            <form className="expense-form" onSubmit={onAddExpense}>
              <label>
                Amount (INR)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="42.50"
                />
              </label>

              <label>
                Date
                <input
                  type="date"
                  required
                  value={expenseDate}
                  onChange={(event) => setExpenseDate(event.target.value)}
                />
              </label>

              <label>
                Category
                <select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="chips-row">
                <div className="chips">
                  {quickCategories.map((category) => (
                    <button
                      type="button"
                      className={category.id === categoryId ? 'chip active' : 'chip'}
                      key={category.id}
                      style={{ borderColor: category.color }}
                      onClick={() => setCategoryId(category.id)}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="quick-chip-edit-btn"
                  onClick={openQuickSelectModal}
                  aria-label="Edit quick select categories"
                  title="Edit quick select categories"
                >
                  ✎
                </button>
              </div>

              <label>
                Notes (optional)
                <input
                  value={description}
                  maxLength={120}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Dinner with team"
                />
              </label>

              <button className="primary" type="submit" disabled={submitting || loading || categories.length === 0}>
                {submitting ? 'Saving...' : 'Add Expense'}
              </button>
            </form>

            <div className="custom-category">
              <button type="button" className="secondary" onClick={() => setShowCategoryForm(true)}>
                Create Custom Category
              </button>
            </div>
          </article>

          <article
            className={
              mobileTab === 'trends'
                ? 'panel glass wide-panel mobile-panel-trends is-active'
                : 'panel glass wide-panel mobile-panel-trends'
            }
          >
            <div className="panel-head">
              <h3>Insights & Trends</h3>
              <button
                type="button"
                className="secondary filter-trigger-btn"
                onClick={() => setIsTrendFilterModalOpen(true)}
              >
                Filters
              </button>
            </div>

            <div className="mobile-trend-switch">
              <button
                type="button"
                className={mobileTrendView === 'trend' ? 'range-btn active' : 'range-btn'}
                onClick={() => setMobileTrendView('trend')}
              >
                Trend
              </button>
              <button
                type="button"
                className={mobileTrendView === 'split' ? 'range-btn active' : 'range-btn'}
                onClick={() => setMobileTrendView('split')}
              >
                Category Split
              </button>
            </div>

            <div className="chart-grid">
              <div
                className={
                  mobileTrendView === 'trend' ? 'chart-wrap mobile-chart-trend is-active' : 'chart-wrap mobile-chart-trend'
                }
              >
                <h4>Spending Trend</h4>
                <p className="muted trend-note">{selectedTrendCategoryName}</p>
                <div className="chart-box">
                  {isTrendRangeInvalid ? (
                    <p className="muted">Trend start date must be on or before end date.</p>
                  ) : loading ? (
                    <p className="muted">Loading trend...</p>
                  ) : trendData.length === 0 ? (
                    <p className="muted">No trend data for selected filters.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={250}>
                      <AreaChart data={trendData}>
                        <defs>
                          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0EA5E9" stopOpacity={0.7} />
                            <stop offset="95%" stopColor="#0EA5E9" stopOpacity={0.1} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.2)" />
                        <XAxis dataKey="label" tick={{ fill: '#CBD5E1', fontSize: 11 }} />
                        <YAxis tick={{ fill: '#CBD5E1', fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{
                            background: '#0f172a',
                            border: '1px solid rgba(148, 163, 184, 0.2)',
                            borderRadius: '10px'
                          }}
                          formatter={(value: number) => currency.format(value)}
                        />
                        <Area
                          type="monotone"
                          dataKey="amount"
                          stroke="#38BDF8"
                          fillOpacity={1}
                          fill="url(#trendFill)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div
                className={
                  mobileTrendView === 'split' ? 'chart-wrap mobile-chart-split is-active' : 'chart-wrap mobile-chart-split'
                }
              >
                <h4>Category Split ({range})</h4>
                <div className="chart-box">
                  {pieData.length === 0 ? (
                    <p className="muted">Add expenses to unlock category split.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={56} outerRadius={90}>
                          {pieData.map((item) => (
                            <Cell key={item.name} fill={item.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => currency.format(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="legend">
                  {pieData.map((item) => (
                    <div className="legend-item" key={item.name}>
                      <span style={{ backgroundColor: item.color }} />
                      <p>
                        {item.name} <strong>{currency.format(item.value)}</strong>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </article>
        </section>

        <section
          className={
            mobileTab === 'recent' ? 'panel glass mobile-panel-recent is-active' : 'panel glass mobile-panel-recent'
          }
        >
          <div className="panel-head recent-head">
            <div>
              <h3>Recent Expenses</h3>
              <span>Newest first</span>
            </div>
            <button
              type="button"
              className="secondary filter-trigger-btn"
              onClick={() => setIsRecentFilterModalOpen(true)}
            >
              Filters
            </button>
          </div>

          {expenses.length === 0 ? (
            <p className="muted">No expenses yet for this user. Add your first one above.</p>
          ) : isRecentRangeInvalid ? (
            <p className="muted">Recent start date must be on or before end date.</p>
          ) : filteredExpenses.length === 0 ? (
            <p className="muted">No expenses found for the selected year/month/date filters.</p>
          ) : (
            <>
              <ul className="expense-list">
                {paginatedRecentExpenses.map((expense) => (
                  <li key={expense.id} className="expense-item">
                    <div>
                      <p className="expense-title">{expense.description || expense.categoryName}</p>
                      <p className="expense-meta">
                        {expense.categoryName} • {expense.date}
                      </p>
                    </div>
                    <div className="expense-actions">
                      <strong>{currency.format(expense.amount)}</strong>
                      <button
                        type="button"
                        className="danger-btn"
                        onClick={() => onDeleteExpense(expense.id)}
                        disabled={deletingExpenseId === expense.id}
                      >
                        {deletingExpenseId === expense.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {totalRecentPages > 1 ? (
                <div className="recent-pagination">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setRecentPage((page) => Math.max(1, page - 1))}
                    disabled={recentPage === 1}
                  >
                    Previous
                  </button>
                  <p>
                    Page {recentPage} of {totalRecentPages}
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setRecentPage((page) => Math.min(totalRecentPages, page + 1))}
                    disabled={recentPage === totalRecentPages}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>

        <section
          className={
            mobileTab === 'friends'
              ? 'panel glass mobile-panel-friends is-active'
              : 'panel glass mobile-panel-friends'
          }
        >
          <div className="panel-head friends-head">
            <div>
              <h3>Friends Comparison</h3>
              <span>Compare spend, categories, and patterns with filters.</span>
            </div>
            <button
              type="button"
              className="secondary filter-trigger-btn"
              onClick={() => setIsFriendFilterModalOpen(true)}
            >
              Filters
            </button>
          </div>

          <p className="muted friend-filter-summary">{friendFilterSummary}</p>
          {friendOnlyInsights.length === 0 ? (
            <p className="muted">Add friends from Profile to unlock comparison insights.</p>
          ) : null}

          {friendHighlights ? (
            <div className="friend-highlight-grid">
              <article className="friend-highlight-card">
                <p>Highest Spender</p>
                <h5>
                  {friendHighlights.highestSpender.isCurrentUser
                    ? `${friendHighlights.highestSpender.user.username} (You)`
                    : friendHighlights.highestSpender.user.username}
                </h5>
                <strong>{currency.format(friendHighlights.highestSpender.totalSpend)}</strong>
              </article>
              <article className="friend-highlight-card">
                <p>Most Active</p>
                <h5>
                  {friendHighlights.mostActive.isCurrentUser
                    ? `${friendHighlights.mostActive.user.username} (You)`
                    : friendHighlights.mostActive.user.username}
                </h5>
                <strong>{friendHighlights.mostActive.expenses.length} expenses</strong>
              </article>
              <article className="friend-highlight-card">
                <p>Top Shared Category</p>
                <h5>{friendHighlights.topCategoryEntry?.[0] ?? 'No category yet'}</h5>
                <strong>
                  {friendHighlights.topCategoryEntry
                    ? currency.format(friendHighlights.topCategoryEntry[1])
                    : '$0.00'}
                </strong>
              </article>
            </div>
          ) : null}

          <div className="friend-section">
            <h4>Overall Spend Comparison</h4>
            <div className="chart-box friend-chart-box">
              {isFriendRangeInvalid ? (
                <p className="muted">Fix the date range to view comparison charts.</p>
              ) : friendComparisonData.length <= 1 ? (
                <p className="muted">Add at least one friend (or include yourself) to compare overall spend.</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={friendComparisonData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.2)" />
                    <XAxis dataKey="name" tick={{ fill: '#CBD5E1', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#CBD5E1', fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => currency.format(value)} />
                    <Bar dataKey="amount" fill="#22C55E" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="friend-section">
            <h4>Category-Wise Spend Comparison</h4>
            <div className="chart-box friend-chart-box">
              {isFriendRangeInvalid ? (
                <p className="muted">Fix the date range to view category-wise comparison.</p>
              ) : friendCategoryComparisonData.length === 0 ? (
                <p className="muted">Need at least two profiles with expenses in selected filters.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={friendCategoryComparisonData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.2)" />
                    <XAxis dataKey="category" tick={{ fill: '#CBD5E1', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#CBD5E1', fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => currency.format(value)} />
                    {friendSeries.map((series) => (
                      <Bar key={series.key} dataKey={series.key} name={series.label} fill={series.color} radius={[4, 4, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="friend-section">
            <h4>Top Category Per Person</h4>
            {friendInsightsForComparison.length === 0 ? (
              <p className="muted">No profiles available in current comparison scope.</p>
            ) : (
              <ul className="friend-top-list">
                {friendInsightsForComparison.map((item) => (
                  <li key={item.user.id}>
                    <p>{item.isCurrentUser ? `${item.user.username} (You)` : item.user.username}</p>
                    <p>
                      {item.topCategory
                        ? `${item.topCategory.name} • ${currency.format(item.topCategory.amount)}`
                        : 'No spending yet'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="friend-section">
            <h4>Recent Friend Expenses</h4>
            {isFriendRangeInvalid ? (
              <p className="muted">Fix the date range to view friend recents.</p>
            ) : filteredFriendOnlyInsights.length === 0 ? (
              <p className="muted">No friend expenses found for selected filters.</p>
            ) : (
              <div className="friend-recents-grid">
                {filteredFriendOnlyInsights.map((item) => (
                  <article key={item.user.id} className="friend-recent-card">
                    <h5>@{item.user.username}</h5>
                    {item.recentExpenses.length === 0 ? (
                      <p className="muted">No expenses yet.</p>
                    ) : (
                      <ul>
                        {item.recentExpenses.map((expense) => (
                          <li key={expense.id}>
                            <span>{expense.description || expense.categoryName}</span>
                            <strong>{currency.format(expense.amount)}</strong>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
