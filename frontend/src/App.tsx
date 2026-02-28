import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
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
  createCategory,
  createExpense,
  deleteExpense,
  fetchAnalytics,
  fetchCategories,
  fetchExpenses
} from './lib/api';
import type { Analytics, Category, Expense } from './lib/types';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2
});

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
  } else if (range === 'daily') {
    normalizedStart = new Date(normalizedEnd);
    normalizedStart.setDate(normalizedEnd.getDate() - 29);
  } else if (range === 'yearly') {
    normalizedStart = new Date(normalizedEnd.getFullYear() - 4, 0, 1);
  } else {
    normalizedStart = new Date(normalizedEnd.getFullYear(), normalizedEnd.getMonth() - 11, 1);
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
    if (bucket) {
      bucket.amount += Number(expense.amount);
      keyTotals.set(key, bucket);
    }
  }

  return Array.from(keyTotals.values());
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) {
      return response.data.message;
    }
  }
  return fallback;
}

export default function App() {
  const [userId, setUserId] = useState(() => localStorage.getItem('budget-user-id') ?? 'demo-user-1');
  const [draftUserId, setDraftUserId] = useState(userId);

  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [range, setRange] = useState<'daily' | 'monthly' | 'yearly'>('monthly');
  const [trendCategoryId, setTrendCategoryId] = useState('all');
  const [mobileTab, setMobileTab] = useState<'add' | 'trends' | 'recent'>('add');
  const [mobileTrendView, setMobileTrendView] = useState<'trend' | 'split'>('trend');
  const [recentPage, setRecentPage] = useState(1);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isTrendFilterModalOpen, setIsTrendFilterModalOpen] = useState(false);
  const [isRecentFilterModalOpen, setIsRecentFilterModalOpen] = useState(false);
  const [isQuickSelectModalOpen, setIsQuickSelectModalOpen] = useState(false);
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

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingExpenseId, setDeletingExpenseId] = useState('');
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [categoryData, expenseData, analyticsData] = await Promise.all([
        fetchCategories(userId),
        fetchExpenses(userId),
        fetchAnalytics(userId, range)
      ]);

      setCategories(categoryData);
      setExpenses(expenseData);
      setAnalytics(analyticsData);
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
      setError(readErrorMessage(requestError, 'Failed to load your budget data.'));
    } finally {
      setLoading(false);
    }
  }, [userId, range]);

  useEffect(() => {
    localStorage.setItem('budget-user-id', userId);
    setDraftUserId(userId);
    setSelectedExpenseYear('all');
    setSelectedExpenseMonth('all');
    setRecentStartDate('');
    setRecentEndDate('');
    setTrendStartDate('');
    setTrendEndDate('');
    setTrendCategoryId('all');
    setIsTrendFilterModalOpen(false);
    setIsRecentFilterModalOpen(false);
    setIsQuickSelectModalOpen(false);
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

  const totalThisRange = analytics?.totalSpend ?? 0;

  const pieData = useMemo(() => {
    if (!analytics) {
      return [];
    }

    const colorByName = new Map(categories.map((category) => [category.name, category.color]));

    return Object.entries(analytics.totalsByCategory).map(([name, value]) => ({
      name,
      value,
      color: colorByName.get(name) ?? '#64748B'
    }));
  }, [analytics, categories]);

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
      isUserModalOpen || isTrendFilterModalOpen || isRecentFilterModalOpen || isQuickSelectModalOpen;

    if (!anyModalOpen) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsUserModalOpen(false);
        setIsTrendFilterModalOpen(false);
        setIsRecentFilterModalOpen(false);
        setIsQuickSelectModalOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isUserModalOpen, isTrendFilterModalOpen, isRecentFilterModalOpen, isQuickSelectModalOpen]);

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

      setCategories((prev) => [...prev, created]);
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

  return (
    <main className="page-shell">
      <div className="bg-orb bg-orb-top" />
      <div className="bg-orb bg-orb-bottom" />

      <section className="hero-card glass">
        <p className="eyebrow app-title">BudgetPulse</p>
        <button
          type="button"
          className="profile-btn"
          onClick={() => setIsUserModalOpen(true)}
          aria-label="Open profile and switch user"
          title={`Current user: ${userId}`}
        >
          <span>{userId.trim().charAt(0).toUpperCase() || 'U'}</span>
        </button>
      </section>

      {isUserModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsUserModalOpen(false)}>
          <div className="modal-card glass" onClick={(event) => event.stopPropagation()}>
            <h3>Switch User</h3>
            <p>Enter a user ID to load that account.</p>
            <form
              className="user-switcher"
              onSubmit={(event) => {
                event.preventDefault();
                if (draftUserId.trim()) {
                  setUserId(draftUserId.trim());
                  setIsUserModalOpen(false);
                }
              }}
            >
              <label htmlFor="userId">User ID</label>
              <input
                id="userId"
                value={draftUserId}
                onChange={(event) => setDraftUserId(event.target.value)}
                placeholder="e.g. rahul"
                autoFocus
              />
              <div className="modal-actions">
                <button type="button" className="secondary" onClick={() => setIsUserModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary">
                  Switch
                </button>
              </div>
            </form>
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
          <p>Active Categories</p>
          <h2>{categories.length}</h2>
        </article>
      </section>

      <nav className="mobile-tabs glass" aria-label="Mobile sections">
        <button
          type="button"
          className={mobileTab === 'add' ? 'mobile-tab-btn active' : 'mobile-tab-btn'}
          onClick={() => setMobileTab('add')}
        >
          Add Expense
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
      </nav>

      <div className="mobile-main">
        <section className="content-grid">
          <article className={mobileTab === 'add' ? 'panel glass mobile-panel-add is-active' : 'panel glass mobile-panel-add'}>
          <div className="panel-head">
            <h3>Add Expense</h3>
            <span>Track small. Save big.</span>
          </div>

          <form className="expense-form" onSubmit={onAddExpense}>
            <label>
              Amount (USD)
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
              <select
                required
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
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

            <button className="primary" type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Add Expense'}
            </button>
          </form>

          <div className="custom-category">
            <button
              type="button"
              className="secondary"
              onClick={() => setShowCategoryForm((prev) => !prev)}
            >
              {showCategoryForm ? 'Close Custom Category' : 'Create Custom Category'}
            </button>

            {showCategoryForm ? (
              <form className="category-form" onSubmit={onAddCategory}>
                <input
                  placeholder="Category name"
                  maxLength={30}
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                />
                <input
                  type="color"
                  value={newCategoryColor}
                  onChange={(event) => setNewCategoryColor(event.target.value)}
                />
                <button type="submit" className="primary" disabled={submitting}>
                  Add
                </button>
              </form>
            ) : null}
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
            <div className={mobileTrendView === 'trend' ? 'chart-wrap mobile-chart-trend is-active' : 'chart-wrap mobile-chart-trend'}>
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
                  <ResponsiveContainer width="100%" height={260}>
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

            <div className={mobileTrendView === 'split' ? 'chart-wrap mobile-chart-split is-active' : 'chart-wrap mobile-chart-split'}>
              <h4>Category Split</h4>
              <div className="chart-box">
                {pieData.length === 0 ? (
                  <p className="muted">Add expenses to unlock category split.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92}>
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
      </div>
    </main>
  );
}
