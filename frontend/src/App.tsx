import { FormEvent, TouchEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  fetchGlobalSubcategories,
  getUserByUsername,
  removeFriend,
  searchUsers
} from './lib/api';
import type { Category, Expense, FriendInsight, Subcategory, UserSearchResult } from './lib/types';

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
const MOBILE_TAB_ORDER: MobileTab[] = ['add', 'trends', 'recent', 'friends'];

const todayISO = () => new Date().toISOString().slice(0, 10);

function toLocalISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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

function normalizeSubcategory(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function withHexAlpha(color: string, alpha: string): string {
  const normalized = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return `${normalized}${alpha}`;
  }
  return normalized;
}

function subcategoryColor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360;
  }
  return `hsl(${hash} 72% 52%)`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function colorToHsl(color: string): { h: number; s: number; l: number } | null {
  const normalized = color.trim();
  const hex = /^#([0-9a-fA-F]{6})$/.exec(normalized);
  if (!hex) {
    return null;
  }

  const value = hex[1];
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;

  const cMax = Math.max(r, g, b);
  const cMin = Math.min(r, g, b);
  const delta = cMax - cMin;
  const lightness = (cMax + cMin) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l: Math.round(lightness * 100) };
  }

  let hue = 0;
  if (cMax === r) {
    hue = ((g - b) / delta) % 6;
  } else if (cMax === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  hue *= 60;
  if (hue < 0) {
    hue += 360;
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  return {
    h: Math.round(hue),
    s: Math.round(saturation * 100),
    l: Math.round(lightness * 100)
  };
}

function subcategoryColorFromCategory(categoryColor: string | undefined, key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 37 + key.charCodeAt(index)) % 997;
  }

  const base = categoryColor ? colorToHsl(categoryColor) : null;
  if (!base) {
    return subcategoryColor(key);
  }

  // Keep outer-ring colors related to parent category, but lighter with stronger variation.
  const hueShift = (hash % 37) - 18;
  const saturationShift = ((hash >> 2) % 25) - 12;
  const lightnessShift = ((hash >> 4) % 15) - 7;

  const hue = (base.h + hueShift + 360) % 360;
  const saturation = clamp(base.s + saturationShift, 28, 96);
  const liftedLightnessTarget = clamp(base.l + 9 + lightnessShift, 20, 92);
  const guaranteedLighterThanBase = clamp(base.l + 4, 20, 92);
  const lightness = Math.max(liftedLightnessTarget, guaranteedLighterThanBase);

  return `hsl(${Math.round(hue)} ${saturation}% ${lightness}%)`;
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

function getDefaultTrendDateRange(range: 'daily' | 'monthly' | 'yearly'): { start: string; end: string } {
  const endDate = new Date();
  const startDate = rangeWindowStart(range, endDate);

  return {
    start: toLocalISODate(startDate),
    end: toLocalISODate(endDate)
  };
}

function deriveDateBounds(expenses: Expense[]): { start: string; end: string } {
  if (expenses.length === 0) {
    const today = todayISO();
    return { start: today, end: today };
  }

  let minDate = expenses[0].date;
  let maxDate = expenses[0].date;

  for (const expense of expenses) {
    if (expense.date < minDate) {
      minDate = expense.date;
    }
    if (expense.date > maxDate) {
      maxDate = expense.date;
    }
  }

  return { start: minDate, end: maxDate };
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
  selectedSubcategory: string,
  startDate: string,
  endDate: string
): Array<{ label: string; amount: number }> {
  const now = new Date();
  const keyTotals = new Map<string, { label: string; amount: number }>();
  const pad = (value: number) => String(value).padStart(2, '0');
  const toDateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit' });
  const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' });

  const filteredExpenses = expenses.filter((expense) => {
    const categoryMatch = selectedCategoryId === 'all' || expense.categoryId === selectedCategoryId;
    const subcategoryMatch =
      selectedSubcategory === 'all' ||
      normalizeSubcategory(expense.subcategoryName) === selectedSubcategory;
    return categoryMatch && subcategoryMatch;
  });

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
  const initialTrendDateRange = getDefaultTrendDateRange('monthly');

  const [userId, setUserId] = useState(() => localStorage.getItem(USER_STORAGE_KEY) ?? DEFAULT_USERNAME);
  const [userName, setUserName] = useState(userId);
  const [draftSwitchUsername, setDraftSwitchUsername] = useState(userId);
  const [draftCreateUsername, setDraftCreateUsername] = useState('');

  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [friendInsights, setFriendInsights] = useState<FriendInsight[]>([]);

  const [range, setRange] = useState<'daily' | 'monthly' | 'yearly'>('monthly');
  const [trendCategoryId, setTrendCategoryId] = useState('all');
  const [trendSubcategory, setTrendSubcategory] = useState('all');
  const [trendSubcategoryOptions, setTrendSubcategoryOptions] = useState<Subcategory[]>([]);
  const [mobileTab, setMobileTab] = useState<MobileTab>('add');
  const [mobileTrendView, setMobileTrendView] = useState<'trend' | 'split'>('trend');
  const [mobileFriendView, setMobileFriendView] = useState<'overview' | 'category' | 'recent'>('overview');

  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isTrendFilterModalOpen, setIsTrendFilterModalOpen] = useState(false);
  const [isRecentFilterModalOpen, setIsRecentFilterModalOpen] = useState(false);
  const [isFriendFilterModalOpen, setIsFriendFilterModalOpen] = useState(false);

  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryName, setSubcategoryName] = useState('');
  const [subcategoryOptions, setSubcategoryOptions] = useState<Subcategory[]>([]);
  const [expenseDate, setExpenseDate] = useState(todayISO());
  const [description, setDescription] = useState('');

  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('#0EA5E9');

  const [selectedExpenseYear, setSelectedExpenseYear] = useState('all');
  const [selectedExpenseMonth, setSelectedExpenseMonth] = useState('all');
  const [selectedExpenseCategoryId, setSelectedExpenseCategoryId] = useState('all');
  const [selectedExpenseSubcategory, setSelectedExpenseSubcategory] = useState('all');
  const [recentSubcategoryOptions, setRecentSubcategoryOptions] = useState<Subcategory[]>([]);
  const [recentStartDate, setRecentStartDate] = useState('');
  const [recentEndDate, setRecentEndDate] = useState('');
  const [trendStartDate, setTrendStartDate] = useState(initialTrendDateRange.start);
  const [trendEndDate, setTrendEndDate] = useState(initialTrendDateRange.end);

  const [friendSearchTerm, setFriendSearchTerm] = useState('');
  const [friendSearchResults, setFriendSearchResults] = useState<UserSearchResult[]>([]);
  const [friendFilterPreset, setFriendFilterPreset] = useState<FriendPreset>('all');
  const [friendFilterYear, setFriendFilterYear] = useState('all');
  const [friendFilterMonth, setFriendFilterMonth] = useState('all');
  const [friendFilterCategoryName, setFriendFilterCategoryName] = useState('all');
  const [friendFilterSubcategory, setFriendFilterSubcategory] = useState('all');
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
  const mobileTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const hasTabRefreshInitializedRef = useRef(false);

  const loadData = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
    }
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
      if (!silent) {
        setLoading(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    localStorage.setItem(USER_STORAGE_KEY, userId);
    setDraftSwitchUsername(userId);
    setSelectedExpenseYear('all');
    setSelectedExpenseMonth('all');
    setSelectedExpenseCategoryId('all');
    setSelectedExpenseSubcategory('all');
    setRecentStartDate('');
    setRecentEndDate('');
    const defaultTrendRange = getDefaultTrendDateRange(range);
    setTrendStartDate(defaultTrendRange.start);
    setTrendEndDate(defaultTrendRange.end);
    setTrendCategoryId('all');
    setTrendSubcategory('all');
    setTrendSubcategoryOptions([]);
    setSubcategoryName('');
    setSubcategoryOptions([]);
    setRecentSubcategoryOptions([]);
    setFriendSearchTerm('');
    setFriendSearchResults([]);
    setFriendFilterPreset('all');
    setFriendFilterYear('all');
    setFriendFilterMonth('all');
    setFriendFilterCategoryName('all');
    setFriendFilterSubcategory('all');
    setFriendFilterStartDate('');
    setFriendFilterEndDate('');
    setIncludeMeInFriendComparison(true);
    setIsTrendFilterModalOpen(false);
    setIsRecentFilterModalOpen(false);
    setIsFriendFilterModalOpen(false);
    setShowCategoryForm(false);
  }, [userId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!hasTabRefreshInitializedRef.current) {
      hasTabRefreshInitializedRef.current = true;
      return;
    }

    void loadData({ silent: true });
  }, [mobileTab, loadData]);

  const rangeExpenses = useMemo(() => filterExpensesByPresetRange(expenses, range), [expenses, range]);

  const totalThisRange = useMemo(
    () => rangeExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0),
    [rangeExpenses]
  );

  const isTrendRangeInvalid = Boolean(trendStartDate && trendEndDate && trendStartDate > trendEndDate);

  const trendSplitExpenses = useMemo(() => {
    if (isTrendRangeInvalid) {
      return [] as Expense[];
    }

    const filteredBySelection = expenses.filter((expense) => {
      const categoryMatch = trendCategoryId === 'all' || expense.categoryId === trendCategoryId;
      const subcategoryMatch =
        trendSubcategory === 'all' || normalizeSubcategory(expense.subcategoryName) === trendSubcategory;
      return categoryMatch && subcategoryMatch;
    });

    const now = new Date();
    const normalizedEnd = trendEndDate
      ? parseIsoDate(trendEndDate)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const normalizedStart = trendStartDate
      ? parseIsoDate(trendStartDate)
      : rangeWindowStart(range, normalizedEnd);

    if (normalizedStart > normalizedEnd) {
      return [] as Expense[];
    }

    return filteredBySelection.filter((expense) => {
      const expenseDate = parseIsoDate(expense.date);
      return expenseDate >= normalizedStart && expenseDate <= normalizedEnd;
    });
  }, [
    expenses,
    trendCategoryId,
    trendSubcategory,
    trendStartDate,
    trendEndDate,
    range,
    isTrendRangeInvalid
  ]);

  const pieData = useMemo(() => {
    const totalsByCategory = new Map<string, number>();
    for (const expense of trendSplitExpenses) {
      totalsByCategory.set(
        expense.categoryName,
        (totalsByCategory.get(expense.categoryName) ?? 0) + Number(expense.amount)
      );
    }

    const colorByName = new Map(categories.map((category) => [category.name, category.color]));
    const grandTotal = Array.from(totalsByCategory.values()).reduce((sum, value) => sum + value, 0);

    return Array.from(totalsByCategory.entries())
      .map(([name, value]) => ({
        name,
        value,
        percentage: grandTotal > 0 ? (value / grandTotal) * 100 : 0,
        color: colorByName.get(name) ?? '#64748B'
      }))
      .sort((left, right) => right.value - left.value);
  }, [categories, trendSplitExpenses]);

  const subcategorySplitData = useMemo(() => {
    const categoryColorByName = new Map(categories.map((category) => [category.name, category.color]));
    const categoryTotals = new Map<string, number>();
    const totals = new Map<
      string,
      { name: string; categoryName: string; subcategoryName: string; value: number; color: string }
    >();

    for (const expense of trendSplitExpenses) {
      const subcategory = expense.subcategoryName.trim() || 'Other';
      const category = expense.categoryName;
      const key = `${category}::${normalizeSubcategory(subcategory)}`;
      const existing = totals.get(key);
      const baseColor = categoryColorByName.get(category);
      const color = subcategoryColorFromCategory(baseColor, key);
      categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + Number(expense.amount));

      if (existing) {
        existing.value += Number(expense.amount);
        totals.set(key, existing);
      } else {
        totals.set(key, {
          name: `${category} / ${subcategory}`,
          categoryName: category,
          subcategoryName: subcategory,
          value: Number(expense.amount),
          color
        });
      }
    }

    const grandTotal = Array.from(totals.values()).reduce((sum, item) => sum + item.value, 0);

    return Array.from(totals.values())
      .map((item) => ({
        ...item,
        percentage: grandTotal > 0 ? (item.value / grandTotal) * 100 : 0,
        categoryPercentage:
          (categoryTotals.get(item.categoryName) ?? 0) > 0
            ? (item.value / (categoryTotals.get(item.categoryName) ?? 1)) * 100
            : 0
      }))
      .sort((left, right) => right.value - left.value);
  }, [categories, trendSplitExpenses]);

  const splitLegendGroups = useMemo(() => {
    const subByCategory = new Map<string, typeof subcategorySplitData>();
    for (const sub of subcategorySplitData) {
      const list = subByCategory.get(sub.categoryName) ?? [];
      list.push(sub);
      subByCategory.set(sub.categoryName, list);
    }

    return pieData.map((category) => ({
      ...category,
      subcategories: (subByCategory.get(category.name) ?? []).sort((left, right) => right.value - left.value)
    }));
  }, [pieData, subcategorySplitData]);

  const trendData = useMemo(() => {
    if (isTrendRangeInvalid) {
      return [];
    }
    return buildTrendData(expenses, range, trendCategoryId, trendSubcategory, trendStartDate, trendEndDate);
  }, [
    expenses,
    range,
    trendCategoryId,
    trendSubcategory,
    trendStartDate,
    trendEndDate,
    isTrendRangeInvalid
  ]);

  const selectedTrendCategoryName = useMemo(() => {
    if (trendCategoryId === 'all') {
      return 'All categories';
    }

    return categories.find((category) => category.id === trendCategoryId)?.name ?? 'All categories';
  }, [categories, trendCategoryId]);

  const selectedTrendSubcategoryName = useMemo(() => {
    if (trendSubcategory === 'all') {
      return 'All subcategories';
    }
    return (
      trendSubcategoryOptions.find((item) => item.nameLower === trendSubcategory)?.name ??
      trendSubcategory
    );
  }, [trendSubcategory, trendSubcategoryOptions]);

  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories]
  );

  const quickCategories = useMemo(() => {
    const categoryUsage = new Map<string, number>();

    for (const expense of expenses) {
      categoryUsage.set(expense.categoryId, (categoryUsage.get(expense.categoryId) ?? 0) + 1);
    }

    const byUsageThenName = (left: Category, right: Category) => {
      const usageDiff = (categoryUsage.get(right.id) ?? 0) - (categoryUsage.get(left.id) ?? 0);
      if (usageDiff !== 0) {
        return usageDiff;
      }
      return left.name.localeCompare(right.name);
    };

    return [...categories].sort(byUsageThenName);
  }, [categories, expenses]);

  const sortedSubcategoryOptions = useMemo(() => {
    const subcategoryUsage = new Map<string, number>();

    for (const expense of expenses) {
      if (expense.categoryId !== categoryId) {
        continue;
      }

      const nameLower = normalizeSubcategory(expense.subcategoryName);
      if (!nameLower) {
        continue;
      }

      subcategoryUsage.set(nameLower, (subcategoryUsage.get(nameLower) ?? 0) + 1);
    }

    return [...subcategoryOptions].sort((left, right) => {
      const usageDiff =
        (subcategoryUsage.get(right.nameLower) ?? 0) - (subcategoryUsage.get(left.nameLower) ?? 0);
      if (usageDiff !== 0) {
        return usageDiff;
      }
      return left.name.localeCompare(right.name);
    });
  }, [expenses, categoryId, subcategoryOptions]);

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

  const knownSubcategoryOptionsFromExpenses = useMemo(() => {
    const uniques = new Map<string, string>();
    for (const expense of expenses) {
      const name = expense.subcategoryName.trim();
      if (!name) {
        continue;
      }
      const key = normalizeSubcategory(name);
      if (!uniques.has(key)) {
        uniques.set(key, name);
      }
    }
    return Array.from(uniques.entries())
      .map(([nameLower, name]) => ({ id: nameLower, name, nameLower }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [expenses]);

  const recentBaseExpenses = useMemo(() => {
    return expenses.filter((expense) => {
      const year = expense.date.slice(0, 4);
      const month = expense.date.slice(5, 7);
      const yearMatch = selectedExpenseYear === 'all' || year === selectedExpenseYear;
      const monthMatch = selectedExpenseMonth === 'all' || month === selectedExpenseMonth;
      const categoryMatch =
        selectedExpenseCategoryId === 'all' || expense.categoryId === selectedExpenseCategoryId;
      const subcategoryMatch =
        selectedExpenseSubcategory === 'all' ||
        normalizeSubcategory(expense.subcategoryName) === selectedExpenseSubcategory;
      return yearMatch && monthMatch && categoryMatch && subcategoryMatch;
    });
  }, [
    expenses,
    selectedExpenseYear,
    selectedExpenseMonth,
    selectedExpenseCategoryId,
    selectedExpenseSubcategory
  ]);

  const recentDateBounds = useMemo(() => deriveDateBounds(recentBaseExpenses), [recentBaseExpenses]);
  const effectiveRecentStartDate = recentStartDate || recentDateBounds.start;
  const effectiveRecentEndDate = recentEndDate || recentDateBounds.end;

  const filteredExpenses = useMemo(() => {
    return recentBaseExpenses.filter((expense) => {
      return expense.date >= effectiveRecentStartDate && expense.date <= effectiveRecentEndDate;
    });
  }, [recentBaseExpenses, effectiveRecentStartDate, effectiveRecentEndDate]);

  const isRecentRangeInvalid = Boolean(recentStartDate && recentEndDate && recentStartDate > recentEndDate);
  const recentVisibleExpenses = useMemo(() => {
    return [...filteredExpenses]
      .sort((left, right) => {
        const byDate = right.date.localeCompare(left.date);
        if (byDate !== 0) {
          return byDate;
        }
        return right.createdAt.localeCompare(left.createdAt);
      })
      .slice(0, 50);
  }, [filteredExpenses]);

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

  const friendFilterCategories = useMemo(() => {
    const categoriesSet = new Set(friendAllExpenses.map((expense) => expense.categoryName).filter(Boolean));
    return Array.from(categoriesSet).sort((a, b) => a.localeCompare(b));
  }, [friendAllExpenses]);

  const friendFilterSubcategories = useMemo(() => {
    const uniques = new Map<string, string>();
    for (const expense of friendAllExpenses) {
      if (friendFilterCategoryName !== 'all' && expense.categoryName !== friendFilterCategoryName) {
        continue;
      }
      const subcategory = expense.subcategoryName.trim();
      if (!subcategory) {
        continue;
      }
      const key = normalizeSubcategory(subcategory);
      if (!uniques.has(key)) {
        uniques.set(key, subcategory);
      }
    }
    return Array.from(uniques.entries())
      .map(([nameLower, name]) => ({ nameLower, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [friendAllExpenses, friendFilterCategoryName]);

  const friendBaseExpenses = useMemo(() => {
    return friendAllExpenses.filter((expense) => {
      const year = expense.date.slice(0, 4);
      const month = expense.date.slice(5, 7);
      const yearMatch = friendFilterYear === 'all' || year === friendFilterYear;
      const monthMatch = friendFilterMonth === 'all' || month === friendFilterMonth;
      const categoryMatch =
        friendFilterCategoryName === 'all' || expense.categoryName === friendFilterCategoryName;
      const subcategoryMatch =
        friendFilterSubcategory === 'all' ||
        normalizeSubcategory(expense.subcategoryName) === friendFilterSubcategory;
      return yearMatch && monthMatch && categoryMatch && subcategoryMatch;
    });
  }, [
    friendAllExpenses,
    friendFilterYear,
    friendFilterMonth,
    friendFilterCategoryName,
    friendFilterSubcategory
  ]);

  const friendDateBounds = useMemo(() => deriveDateBounds(friendBaseExpenses), [friendBaseExpenses]);
  const effectiveFriendStartDate = friendFilterStartDate || friendDateBounds.start;
  const effectiveFriendEndDate = friendFilterEndDate || friendDateBounds.end;

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
        const categoryMatch =
          friendFilterCategoryName === 'all' || expense.categoryName === friendFilterCategoryName;
        const subcategoryMatch =
          friendFilterSubcategory === 'all' ||
          normalizeSubcategory(expense.subcategoryName) === friendFilterSubcategory;
        const startMatch = expense.date >= effectiveFriendStartDate;
        const endMatch = expense.date <= effectiveFriendEndDate;
        return yearMatch && monthMatch && categoryMatch && subcategoryMatch && startMatch && endMatch;
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
    friendFilterCategoryName,
    friendFilterSubcategory,
    effectiveFriendStartDate,
    effectiveFriendEndDate,
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

  const friendCombinedExpenses = useMemo(
    () => friendInsightsForComparison.flatMap((item) => item.expenses),
    [friendInsightsForComparison]
  );

  const friendCombinedTotal = useMemo(
    () => friendCombinedExpenses.reduce((sum, expense) => sum + expense.amount, 0),
    [friendCombinedExpenses]
  );

  const friendCombinedCumulativeData = useMemo(() => {
    if (isFriendRangeInvalid || friendCombinedExpenses.length === 0) {
      return [] as Array<{ date: string; label: string; amount: number }>;
    }

    const dailyTotals = new Map<string, number>();
    for (const expense of friendCombinedExpenses) {
      dailyTotals.set(expense.date, (dailyTotals.get(expense.date) ?? 0) + expense.amount);
    }

    const orderedDates = Array.from(dailyTotals.keys()).sort((left, right) => left.localeCompare(right));
    const dateLabelFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
    let runningTotal = 0;

    return orderedDates.map((date) => {
      runningTotal += dailyTotals.get(date) ?? 0;
      return {
        date,
        label: dateLabelFormatter.format(parseIsoDate(date)),
        amount: Number(runningTotal.toFixed(2))
      };
    });
  }, [friendCombinedExpenses, isFriendRangeInvalid]);

  const friendCombinedCategorySplitData = useMemo(() => {
    if (isFriendRangeInvalid || friendCombinedExpenses.length === 0) {
      return [] as Array<{ name: string; value: number; color: string }>;
    }

    const totals = new Map<string, number>();
    for (const expense of friendCombinedExpenses) {
      totals.set(expense.categoryName, (totals.get(expense.categoryName) ?? 0) + expense.amount);
    }

    const colorByCategory = new Map(categories.map((category) => [category.name, category.color]));

    return Array.from(totals.entries())
      .map(([name, value]) => ({
        name,
        value: Number(value.toFixed(2)),
        color: colorByCategory.get(name) ?? subcategoryColor(name)
      }))
      .sort((left, right) => right.value - left.value);
  }, [friendCombinedExpenses, categories, isFriendRangeInvalid]);

  const friendAdvancedInsights = useMemo(() => {
    if (friendInsightsForComparison.length === 0) {
      return null;
    }

    let biggestSingleExpense:
      | { userLabel: string; amount: number; category: string; date: string }
      | null = null;
    let biggestDaySpend:
      | { userLabel: string; amount: number; date: string }
      | null = null;
    let mostDiverse:
      | { userLabel: string; categories: number; total: number }
      | null = null;
    let mostConsistent:
      | { userLabel: string; variation: number; activeDays: number }
      | null = null;
    let momentumLeader:
      | { userLabel: string; amount: number }
      | null = null;

    const momentumEnd = parseIsoDate(effectiveFriendEndDate);
    const momentumStart = new Date(momentumEnd);
    momentumStart.setDate(momentumEnd.getDate() - 29);

    for (const item of friendInsightsForComparison) {
      const userLabel = item.isCurrentUser ? `${item.user.username} (You)` : item.user.username;
      const dailyTotals = new Map<string, number>();
      const categoriesSet = new Set<string>();
      let momentumSpend = 0;

      for (const expense of item.expenses) {
        categoriesSet.add(expense.categoryName);
        dailyTotals.set(expense.date, (dailyTotals.get(expense.date) ?? 0) + expense.amount);

        const expenseDate = parseIsoDate(expense.date);
        if (expenseDate >= momentumStart && expenseDate <= momentumEnd) {
          momentumSpend += expense.amount;
        }

        if (!biggestSingleExpense || expense.amount > biggestSingleExpense.amount) {
          biggestSingleExpense = {
            userLabel,
            amount: expense.amount,
            category: expense.categoryName,
            date: expense.date
          };
        }
      }

      for (const [date, amount] of dailyTotals.entries()) {
        if (!biggestDaySpend || amount > biggestDaySpend.amount) {
          biggestDaySpend = { userLabel, amount, date };
        }
      }

      if (!mostDiverse || categoriesSet.size > mostDiverse.categories) {
        mostDiverse = {
          userLabel,
          categories: categoriesSet.size,
          total: item.totalSpend
        };
      }

      if (!momentumLeader || momentumSpend > momentumLeader.amount) {
        momentumLeader = {
          userLabel,
          amount: momentumSpend
        };
      }

      const dailyValues = Array.from(dailyTotals.values());
      if (dailyValues.length >= 3) {
        const mean = dailyValues.reduce((sum, value) => sum + value, 0) / dailyValues.length;
        if (mean > 0) {
          const variance =
            dailyValues.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / dailyValues.length;
          const stdDev = Math.sqrt(variance);
          const coeffVariation = stdDev / mean;

          if (!mostConsistent || coeffVariation < mostConsistent.variation) {
            mostConsistent = {
              userLabel,
              variation: coeffVariation,
              activeDays: dailyValues.length
            };
          }
        }
      }
    }

    return {
      biggestSingleExpense,
      biggestDaySpend,
      mostDiverse,
      mostConsistent,
      momentumLeader
    };
  }, [friendInsightsForComparison, effectiveFriendEndDate]);

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
    if (friendFilterCategoryName !== 'all') {
      segments.push(friendFilterCategoryName);
    }
    if (friendFilterSubcategory !== 'all') {
      const subcategoryLabel =
        friendFilterSubcategories.find((item) => item.nameLower === friendFilterSubcategory)?.name ??
        friendFilterSubcategory;
      segments.push(subcategoryLabel);
    }
    segments.push(`${effectiveFriendStartDate} to ${effectiveFriendEndDate}`);
    segments.push(includeMeInFriendComparison ? 'Including me' : 'Friends only');
    return segments.join(' • ');
  }, [
    friendFilterPreset,
    friendFilterYear,
    friendFilterMonth,
    friendFilterCategoryName,
    friendFilterSubcategory,
    friendFilterSubcategories,
    effectiveFriendStartDate,
    effectiveFriendEndDate,
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
    if (selectedExpenseCategoryId !== 'all' && !categories.some((category) => category.id === selectedExpenseCategoryId)) {
      setSelectedExpenseCategoryId('all');
    }
  }, [categories, selectedExpenseCategoryId]);

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
    if (
      friendFilterCategoryName !== 'all' &&
      !friendFilterCategories.includes(friendFilterCategoryName)
    ) {
      setFriendFilterCategoryName('all');
    }
  }, [friendFilterCategories, friendFilterCategoryName]);

  useEffect(() => {
    if (
      friendFilterSubcategory !== 'all' &&
      !friendFilterSubcategories.some((item) => item.nameLower === friendFilterSubcategory)
    ) {
      setFriendFilterSubcategory('all');
    }
  }, [friendFilterSubcategories, friendFilterSubcategory]);

  useEffect(() => {
    let cancelled = false;
    const selectedCategoryName = categoryNameById.get(categoryId) ?? '';

    setSubcategoryName('');
    if (!selectedCategoryName) {
      setSubcategoryOptions([]);
      return undefined;
    }

    void fetchGlobalSubcategories(selectedCategoryName)
      .then((items) => {
        if (!cancelled) {
          setSubcategoryOptions(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSubcategoryOptions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [categoryId, categoryNameById]);

  useEffect(() => {
    let cancelled = false;
    const loadTrendSubcategories = async () => {
      if (trendCategoryId === 'all') {
        setTrendSubcategoryOptions(knownSubcategoryOptionsFromExpenses);
        return;
      }

      const categoryName = categoryNameById.get(trendCategoryId) ?? '';
      if (!categoryName) {
        setTrendSubcategoryOptions([]);
        return;
      }

      try {
        const items = await fetchGlobalSubcategories(categoryName);
        if (!cancelled) {
          setTrendSubcategoryOptions(items);
        }
      } catch {
        if (!cancelled) {
          setTrendSubcategoryOptions([]);
        }
      }
    };

    void loadTrendSubcategories();
    return () => {
      cancelled = true;
    };
  }, [trendCategoryId, categoryNameById, knownSubcategoryOptionsFromExpenses]);

  useEffect(() => {
    if (
      trendSubcategory !== 'all' &&
      !trendSubcategoryOptions.some((item) => item.nameLower === trendSubcategory)
    ) {
      setTrendSubcategory('all');
    }
  }, [trendSubcategory, trendSubcategoryOptions]);

  useEffect(() => {
    let cancelled = false;
    const loadRecentSubcategories = async () => {
      if (selectedExpenseCategoryId === 'all') {
        setRecentSubcategoryOptions(knownSubcategoryOptionsFromExpenses);
        return;
      }

      const categoryName = categoryNameById.get(selectedExpenseCategoryId) ?? '';
      if (!categoryName) {
        setRecentSubcategoryOptions([]);
        return;
      }

      try {
        const items = await fetchGlobalSubcategories(categoryName);
        if (!cancelled) {
          setRecentSubcategoryOptions(items);
        }
      } catch {
        if (!cancelled) {
          setRecentSubcategoryOptions([]);
        }
      }
    };

    void loadRecentSubcategories();
    return () => {
      cancelled = true;
    };
  }, [selectedExpenseCategoryId, categoryNameById, knownSubcategoryOptionsFromExpenses]);

  useEffect(() => {
    if (
      selectedExpenseSubcategory !== 'all' &&
      !recentSubcategoryOptions.some((item) => item.nameLower === selectedExpenseSubcategory)
    ) {
      setSelectedExpenseSubcategory('all');
    }
  }, [selectedExpenseSubcategory, recentSubcategoryOptions]);

  useEffect(() => {
    setMobileTrendView('trend');
  }, [range, trendCategoryId, trendSubcategory, trendStartDate, trendEndDate]);

  useEffect(() => {
    const anyModalOpen =
      isUserModalOpen ||
      isTrendFilterModalOpen ||
      isRecentFilterModalOpen ||
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
    isFriendFilterModalOpen,
    showCategoryForm
  ]);

  async function onAddExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAmount = Number(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || !categoryId || !subcategoryName.trim()) {
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await createExpense(userId, {
        amount: parsedAmount,
        categoryId,
        date: expenseDate,
        description: description.trim(),
        subcategoryName: subcategoryName.trim()
      });

      setAmount('');
      setDescription('');
      setSubcategoryName('');
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

  const onMobileTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    if (window.innerWidth > 1024 || event.touches.length !== 1) {
      mobileTouchStartRef.current = null;
      return;
    }

    const touch = event.touches[0];
    mobileTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const onMobileTouchEnd = useCallback((event: TouchEvent<HTMLDivElement>) => {
    if (window.innerWidth > 1024 || event.changedTouches.length !== 1) {
      mobileTouchStartRef.current = null;
      return;
    }

    const start = mobileTouchStartRef.current;
    mobileTouchStartRef.current = null;

    if (!start) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absX < 56 || absX <= absY * 1.25 || absY > 120) {
      return;
    }

    setMobileTab((current) => {
      const currentIndex = MOBILE_TAB_ORDER.indexOf(current);
      if (currentIndex < 0) {
        return current;
      }

      if (deltaX < 0 && currentIndex < MOBILE_TAB_ORDER.length - 1) {
        return MOBILE_TAB_ORDER[currentIndex + 1];
      }

      if (deltaX > 0 && currentIndex > 0) {
        return MOBILE_TAB_ORDER[currentIndex - 1];
      }

      return current;
    });
  }, []);

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
                  onClick={() => {
                    const defaultRange = getDefaultTrendDateRange(key);
                    setRange(key);
                    setTrendStartDate(defaultRange.start);
                    setTrendEndDate(defaultRange.end);
                  }}
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
                onChange={(event) => {
                  setTrendCategoryId(event.target.value);
                  setTrendSubcategory('all');
                }}
              >
                <option value="all">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <label htmlFor="trendSubcategory">Subcategory</label>
              <select
                id="trendSubcategory"
                value={trendSubcategory}
                onChange={(event) => setTrendSubcategory(event.target.value)}
              >
                <option value="all">All subcategories</option>
                {trendSubcategoryOptions.map((subcategory) => (
                  <option key={subcategory.nameLower} value={subcategory.nameLower}>
                    {subcategory.name}
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
                  const defaultRange = getDefaultTrendDateRange('monthly');
                  setRange('monthly');
                  setTrendCategoryId('all');
                  setTrendSubcategory('all');
                  setTrendStartDate(defaultRange.start);
                  setTrendEndDate(defaultRange.end);
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
              <label htmlFor="expenseCategoryFilter">Category</label>
              <select
                id="expenseCategoryFilter"
                value={selectedExpenseCategoryId}
                onChange={(event) => {
                  setSelectedExpenseCategoryId(event.target.value);
                  setSelectedExpenseSubcategory('all');
                }}
              >
                <option value="all">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <label htmlFor="expenseSubcategoryFilter">Subcategory</label>
              <select
                id="expenseSubcategoryFilter"
                value={selectedExpenseSubcategory}
                onChange={(event) => setSelectedExpenseSubcategory(event.target.value)}
              >
                <option value="all">All subcategories</option>
                {recentSubcategoryOptions.map((subcategory) => (
                  <option key={subcategory.nameLower} value={subcategory.nameLower}>
                    {subcategory.name}
                  </option>
                ))}
              </select>
              <label htmlFor="recentStartDate">Start Date</label>
              <input
                id="recentStartDate"
                type="date"
                value={recentStartDate || recentDateBounds.start}
                onChange={(event) => setRecentStartDate(event.target.value)}
              />
              <label htmlFor="recentEndDate">End Date</label>
              <input
                id="recentEndDate"
                type="date"
                value={recentEndDate || recentDateBounds.end}
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
                  setSelectedExpenseCategoryId('all');
                  setSelectedExpenseSubcategory('all');
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

              <label htmlFor="friendCategoryFilter">Category</label>
              <select
                id="friendCategoryFilter"
                value={friendFilterCategoryName}
                onChange={(event) => {
                  setFriendFilterCategoryName(event.target.value);
                  setFriendFilterSubcategory('all');
                }}
              >
                <option value="all">All categories</option>
                {friendFilterCategories.map((categoryName) => (
                  <option key={categoryName} value={categoryName}>
                    {categoryName}
                  </option>
                ))}
              </select>

              <label htmlFor="friendSubcategoryFilter">Subcategory</label>
              <select
                id="friendSubcategoryFilter"
                value={friendFilterSubcategory}
                onChange={(event) => setFriendFilterSubcategory(event.target.value)}
              >
                <option value="all">All subcategories</option>
                {friendFilterSubcategories.map((subcategory) => (
                  <option key={subcategory.nameLower} value={subcategory.nameLower}>
                    {subcategory.name}
                  </option>
                ))}
              </select>

              <label htmlFor="friendStartDate">Start Date</label>
              <input
                id="friendStartDate"
                type="date"
                value={friendFilterStartDate || friendDateBounds.start}
                onChange={(event) => {
                  setFriendFilterPreset('custom');
                  setFriendFilterStartDate(event.target.value);
                }}
              />

              <label htmlFor="friendEndDate">End Date</label>
              <input
                id="friendEndDate"
                type="date"
                value={friendFilterEndDate || friendDateBounds.end}
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
                  setFriendFilterCategoryName('all');
                  setFriendFilterSubcategory('all');
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

      <div
        className={`mobile-main mobile-main-${mobileTab}`}
        onTouchStart={onMobileTouchStart}
        onTouchEnd={onMobileTouchEnd}
      >
        <section className="content-grid">
          <article
            className={mobileTab === 'add' ? 'panel glass mobile-panel-add is-active' : 'panel glass mobile-panel-add'}
          >
            <div className="panel-head">
              <h3>Add Expense</h3>
              <span>Every entry sharpens your money decisions.</span>
            </div>

            <form className="expense-form" onSubmit={onAddExpense}>
              <div className="amount-date-row">
                <label>
                  Amount (INR)
                  <input
                    className="amount-input"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0.00"
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
              </div>

              <p className="picker-label">Category</p>

              <div className="category-scroll-wrap">
                <div className="chips">
                  {quickCategories.map((category) => {
                    const selected = category.id === categoryId;
                    return (
                      <button
                        type="button"
                        className={selected ? 'chip active' : 'chip'}
                        key={category.id}
                        style={{
                          borderColor: category.color,
                          backgroundColor: withHexAlpha(category.color, selected ? 'D9' : '22')
                        }}
                        onClick={() => setCategoryId(category.id)}
                      >
                        {category.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label>
                Subcategory
                <input
                  value={subcategoryName}
                  required
                  maxLength={40}
                  onChange={(event) => setSubcategoryName(event.target.value)}
                  placeholder="e.g. Zomato"
                />
              </label>

              {subcategoryOptions.length > 0 ? (
                <div className="subcategory-scroll-wrap">
                  <div className="subcategory-chips">
                    {sortedSubcategoryOptions.map((subcategory) => {
                      const selected = normalizeSubcategory(subcategoryName) === subcategory.nameLower;
                      const color = subcategoryColor(subcategory.nameLower);
                      return (
                        <button
                          key={subcategory.id}
                          type="button"
                          className={selected ? 'chip subcategory-chip active' : 'chip subcategory-chip'}
                          style={{
                            borderColor: color,
                            backgroundColor: color.replace(')', selected ? ' / 0.72)' : ' / 0.18)')
                          }}
                          onClick={() => setSubcategoryName(subcategory.name)}
                        >
                          {subcategory.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

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
                <p className="muted trend-note">
                  {selectedTrendCategoryName} • {selectedTrendSubcategoryName}
                </p>
                <div className="chart-box">
                  {isTrendRangeInvalid ? (
                    <p className="muted">Trend start date must be on or before end date.</p>
                  ) : loading ? (
                    <p className="muted">Loading trend...</p>
                  ) : trendData.length === 0 ? (
                    <p className="muted">No trend data for selected filters.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
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
                <h4>Category + Subcategory Split ({range})</h4>
                <div className="chart-box">
                  {pieData.length === 0 ? (
                    <p className="muted">Add expenses to unlock category split.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={62}>
                          {pieData.map((item) => (
                            <Cell key={item.name} fill={item.color} />
                          ))}
                        </Pie>
                        {subcategorySplitData.length > 0 ? (
                          <Pie
                            data={subcategorySplitData}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={68}
                            outerRadius={90}
                          >
                            {subcategorySplitData.map((item) => (
                              <Cell key={item.name} fill={item.color} />
                            ))}
                          </Pie>
                        ) : null}
                        <Tooltip
                          formatter={(
                            value: number,
                            _name: string,
                            payload: {
                              payload?: {
                                percentage?: number;
                                categoryPercentage?: number;
                                categoryName?: string;
                                subcategoryName?: string;
                                name?: string;
                              };
                            }
                          ) => {
                            const item = payload?.payload;
                            if (item?.subcategoryName) {
                              return [
                                `${currency.format(value)} (${(item.percentage ?? 0).toFixed(1)}% of total, ${(item.categoryPercentage ?? 0).toFixed(1)}% of ${item.categoryName})`,
                                item.subcategoryName
                              ];
                            }

                            return [
                              `${currency.format(value)} (${(item?.percentage ?? 0).toFixed(1)}% of total)`,
                              item?.name ?? 'Category'
                            ];
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="split-hier-legend">
                  {splitLegendGroups.map((group) => (
                    <div className="split-hier-category" key={group.name}>
                      <div className="legend-item">
                        <span style={{ backgroundColor: group.color }} />
                        <p>
                          {group.name}{' '}
                          <strong>
                            {currency.format(group.value)} ({group.percentage.toFixed(1)}%)
                          </strong>
                        </p>
                      </div>
                      {group.subcategories.length > 0 ? (
                        <div className="split-hier-sub-list">
                          {group.subcategories.map((sub) => (
                            <div className="split-hier-sub-item" key={sub.name}>
                              <span style={{ backgroundColor: sub.color }} />
                              <p>
                                {sub.subcategoryName}{' '}
                                <strong>
                                  {currency.format(sub.value)} ({sub.percentage.toFixed(1)}% total,{' '}
                                  {sub.categoryPercentage.toFixed(1)}% in {group.name})
                                </strong>
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : null}
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
              <ul className="expense-list recent-list-scroll">
                {recentVisibleExpenses.map((expense) => (
                  <li key={expense.id} className="expense-item">
                    <div>
                      <p className="expense-title">{expense.description || expense.categoryName}</p>
                      <p className="expense-meta">
                        {expense.categoryName}
                        {expense.subcategoryName ? ` / ${expense.subcategoryName}` : ''} • {expense.date}
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
              {filteredExpenses.length > recentVisibleExpenses.length ? (
                <p className="recent-limit-note muted">
                  Showing latest {recentVisibleExpenses.length} of {filteredExpenses.length} transactions.
                </p>
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

          <div className="mobile-friend-switch">
            <button
              type="button"
              className={mobileFriendView === 'overview' ? 'range-btn active' : 'range-btn'}
              onClick={() => setMobileFriendView('overview')}
            >
              Overview
            </button>
            <button
              type="button"
              className={mobileFriendView === 'category' ? 'range-btn active' : 'range-btn'}
              onClick={() => setMobileFriendView('category')}
            >
              Category
            </button>
            <button
              type="button"
              className={mobileFriendView === 'recent' ? 'range-btn active' : 'range-btn'}
              onClick={() => setMobileFriendView('recent')}
            >
              Recents
            </button>
          </div>

          <div
            className={
              mobileFriendView === 'overview'
                ? 'mobile-friend-pane mobile-friend-overview is-active'
                : 'mobile-friend-pane mobile-friend-overview'
            }
          >
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
                      : currency.format(0)}
                  </strong>
                </article>
              </div>
            ) : null}

            <div className="friend-section">
              <h4>Combined Spend Trend</h4>
              <div className="friend-combined-summary">
                <p>Total spend together</p>
                <h5>{currency.format(friendCombinedTotal)}</h5>
              </div>
              <p className="muted trend-note">
                Running total over time for all included profiles, with active filters applied.
              </p>
              <div className="chart-box friend-chart-box">
                {isFriendRangeInvalid ? (
                  <p className="muted">Fix the date range to view cumulative trend.</p>
                ) : friendCombinedCumulativeData.length === 0 ? (
                  <p className="muted">No cumulative spend data for selected filters.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={friendCombinedCumulativeData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.2)" />
                      <XAxis dataKey="label" tick={{ fill: '#CBD5E1', fontSize: 11 }} minTickGap={24} />
                      <YAxis tick={{ fill: '#CBD5E1', fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => currency.format(value)} />
                      <Area
                        type="monotone"
                        dataKey="amount"
                        name="Combined cumulative spend"
                        stroke="#38BDF8"
                        fill="#38BDF8"
                        fillOpacity={0.16}
                        strokeWidth={2.2}
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="friend-section">
              <h4>Combined Category Bifurcation</h4>
              <div className="chart-box friend-chart-box">
                {isFriendRangeInvalid ? (
                  <p className="muted">Fix the date range to view category bifurcation.</p>
                ) : friendCombinedCategorySplitData.length === 0 ? (
                  <p className="muted">No category data for selected filters.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={friendCombinedCategorySplitData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={58}
                        outerRadius={88}
                      >
                        {friendCombinedCategorySplitData.map((item) => (
                          <Cell key={item.name} fill={item.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => currency.format(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              {friendCombinedCategorySplitData.length > 0 ? (
                <div className="legend">
                  {friendCombinedCategorySplitData.map((item) => (
                    <div className="legend-item" key={item.name}>
                      <span style={{ backgroundColor: item.color }} />
                      <p>
                        {item.name} <strong>{currency.format(item.value)}</strong>
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {friendAdvancedInsights ? (
              <div className="friend-section">
                <h4>Deeper Insights</h4>
                <div className="friend-highlight-grid friend-advanced-grid">
                  <article className="friend-highlight-card">
                    <p>Biggest Single Expense</p>
                    <h5>{friendAdvancedInsights.biggestSingleExpense?.userLabel ?? 'No data yet'}</h5>
                    <strong>
                      {friendAdvancedInsights.biggestSingleExpense
                        ? `${currency.format(friendAdvancedInsights.biggestSingleExpense.amount)} · ${friendAdvancedInsights.biggestSingleExpense.category}`
                        : '—'}
                    </strong>
                  </article>
                  <article className="friend-highlight-card">
                    <p>Biggest One-Day Spend</p>
                    <h5>{friendAdvancedInsights.biggestDaySpend?.userLabel ?? 'No data yet'}</h5>
                    <strong>
                      {friendAdvancedInsights.biggestDaySpend
                        ? `${currency.format(friendAdvancedInsights.biggestDaySpend.amount)} · ${friendAdvancedInsights.biggestDaySpend.date}`
                        : '—'}
                    </strong>
                  </article>
                  <article className="friend-highlight-card">
                    <p>30-Day Momentum Leader</p>
                    <h5>{friendAdvancedInsights.momentumLeader?.userLabel ?? 'No data yet'}</h5>
                    <strong>
                      {friendAdvancedInsights.momentumLeader
                        ? currency.format(friendAdvancedInsights.momentumLeader.amount)
                        : '—'}
                    </strong>
                  </article>
                  <article className="friend-highlight-card">
                    <p>Most Consistent Daily Spend</p>
                    <h5>{friendAdvancedInsights.mostConsistent?.userLabel ?? 'Insufficient data'}</h5>
                    <strong>
                      {friendAdvancedInsights.mostConsistent
                        ? `${(friendAdvancedInsights.mostConsistent.variation * 100).toFixed(1)}% variation`
                        : 'Need >= 3 active days'}
                    </strong>
                  </article>
                  <article className="friend-highlight-card">
                    <p>Most Diverse Categories</p>
                    <h5>{friendAdvancedInsights.mostDiverse?.userLabel ?? 'No data yet'}</h5>
                    <strong>
                      {friendAdvancedInsights.mostDiverse
                        ? `${friendAdvancedInsights.mostDiverse.categories} categories`
                        : '—'}
                    </strong>
                  </article>
                </div>
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
                  <ResponsiveContainer width="100%" height={220}>
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
          </div>

          <div
            className={
              mobileFriendView === 'category'
                ? 'mobile-friend-pane mobile-friend-category is-active'
                : 'mobile-friend-pane mobile-friend-category'
            }
          >
            <div className="friend-section">
              <h4>Category-Wise Spend Comparison</h4>
              <div className="chart-box friend-chart-box">
                {isFriendRangeInvalid ? (
                  <p className="muted">Fix the date range to view category-wise comparison.</p>
                ) : friendCategoryComparisonData.length === 0 ? (
                  <p className="muted">Need at least two profiles with expenses in selected filters.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={friendCategoryComparisonData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.2)" />
                      <XAxis dataKey="category" tick={{ fill: '#CBD5E1', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#CBD5E1', fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => currency.format(value)} />
                      {friendSeries.map((series) => (
                        <Bar
                          key={series.key}
                          dataKey={series.key}
                          name={series.label}
                          fill={series.color}
                          radius={[4, 4, 0, 0]}
                        />
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
          </div>

          <div
            className={
              mobileFriendView === 'recent'
                ? 'mobile-friend-pane mobile-friend-recent is-active'
                : 'mobile-friend-pane mobile-friend-recent'
            }
          >
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
                              <span>
                                {expense.description || expense.categoryName}
                                {expense.subcategoryName ? ` (${expense.subcategoryName})` : ''}
                              </span>
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
          </div>
        </section>
      </div>
    </main>
  );
}
