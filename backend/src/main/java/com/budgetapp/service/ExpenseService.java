package com.budgetapp.service;

import com.budgetapp.model.Category;
import com.budgetapp.model.Expense;
import com.budgetapp.model.request.CreateExpenseRequest;
import com.budgetapp.model.response.AnalyticsResponse;
import com.budgetapp.model.response.TrendPoint;
import com.google.api.core.ApiFuture;
import com.google.cloud.firestore.*;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

@Service
public class ExpenseService {

    private final Firestore firestore;
    private final CategoryService categoryService;

    public ExpenseService(Firestore firestore, CategoryService categoryService) {
        this.firestore = firestore;
        this.categoryService = categoryService;
    }

    public Expense createExpense(String userId, CreateExpenseRequest request) {
        Category category = categoryService.getCategoryById(userId, request.getCategoryId())
                .orElseThrow(() -> new IllegalArgumentException("Selected category does not exist."));

        Expense expense = new Expense(
                UUID.randomUUID().toString(),
                userId,
                request.getDescription() == null ? "" : request.getDescription().trim(),
                category.getId(),
                category.getName(),
                request.getAmount(),
                request.getDate(),
                java.time.Instant.now()
        );

        Map<String, Object> payload = new HashMap<>();
        payload.put("id", expense.getId());
        payload.put("userId", expense.getUserId());
        payload.put("description", expense.getDescription());
        payload.put("categoryId", expense.getCategoryId());
        payload.put("categoryName", expense.getCategoryName());
        payload.put("amount", expense.getAmount().toPlainString());
        payload.put("date", expense.getDate().toString());
        payload.put("createdAt", expense.getCreatedAt().toString());

        try {
            DocumentReference doc = firestore.collection("users")
                    .document(userId)
                    .collection("expenses")
                    .document(expense.getId());
            doc.set(payload).get();
            return expense;
        } catch (Exception exception) {
            throw new IllegalStateException("Failed to save expense.", exception);
        }
    }

    public List<Expense> getExpenses(String userId, LocalDate from, LocalDate to) {
        List<Expense> expenses = readAllExpenses(userId);

        return expenses.stream()
                .filter(expense -> from == null || !expense.getDate().isBefore(from))
                .filter(expense -> to == null || !expense.getDate().isAfter(to))
                .sorted(Comparator.comparing(Expense::getDate).reversed())
                .collect(Collectors.toList());
    }

    public void deleteExpense(String userId, String expenseId) {
        try {
            CollectionReference collection = firestore.collection("users")
                    .document(userId)
                    .collection("expenses");

            DocumentReference directRef = collection.document(expenseId);
            DocumentSnapshot directSnapshot = directRef.get().get();
            if (directSnapshot.exists()) {
                directRef.delete().get();
                return;
            }

            // Backward-compatible fallback for records where stored "id" differs from document id.
            List<QueryDocumentSnapshot> matches = collection
                    .whereEqualTo("id", expenseId)
                    .limit(1)
                    .get()
                    .get()
                    .getDocuments();

            if (matches.isEmpty()) {
                throw new NoSuchElementException("Expense not found.");
            }

            matches.get(0).getReference().delete().get();
        } catch (NoSuchElementException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalStateException("Failed to delete expense.", exception);
        }
    }

    public AnalyticsResponse getAnalytics(String userId, String range) {
        String normalizedRange = normalizeRange(range);
        LocalDate today = LocalDate.now();
        LocalDate startDate;

        switch (normalizedRange) {
            case "daily" -> startDate = today.minusDays(29);
            case "yearly" -> startDate = today.minusYears(4).withDayOfYear(1);
            default -> startDate = today.minusMonths(11).withDayOfMonth(1);
        }

        List<Expense> filtered = getExpenses(userId, startDate, today);

        Map<String, BigDecimal> totalsByCategory = new LinkedHashMap<>();
        BigDecimal totalSpend = BigDecimal.ZERO;

        for (Expense expense : filtered) {
            totalSpend = totalSpend.add(expense.getAmount());
            totalsByCategory.merge(expense.getCategoryName(), expense.getAmount(), BigDecimal::add);
        }

        List<TrendPoint> trend = buildTrend(filtered, normalizedRange, today);

        return new AnalyticsResponse(normalizedRange, totalSpend, totalsByCategory, trend);
    }

    private List<Expense> readAllExpenses(String userId) {
        try {
            CollectionReference collection = firestore.collection("users")
                    .document(userId)
                    .collection("expenses");

            ApiFuture<QuerySnapshot> future = collection.orderBy("date", Query.Direction.DESCENDING).get();
            List<QueryDocumentSnapshot> docs = future.get().getDocuments();

            List<Expense> expenses = new ArrayList<>();
            for (DocumentSnapshot doc : docs) {
                Map<String, Object> data = doc.getData();
                if (data == null) {
                    continue;
                }

                expenses.add(new Expense(
                        doc.getId(),
                        String.valueOf(data.getOrDefault("userId", userId)),
                        String.valueOf(data.getOrDefault("description", "")),
                        String.valueOf(data.getOrDefault("categoryId", "misc")),
                        String.valueOf(data.getOrDefault("categoryName", "Misc")),
                        new BigDecimal(String.valueOf(data.getOrDefault("amount", "0"))),
                        LocalDate.parse(String.valueOf(data.getOrDefault("date", LocalDate.now().toString()))),
                        java.time.Instant.parse(String.valueOf(data.getOrDefault("createdAt", java.time.Instant.now().toString())))
                ));
            }

            return expenses;
        } catch (Exception exception) {
            throw new IllegalStateException("Failed to fetch expenses.", exception);
        }
    }

    private List<TrendPoint> buildTrend(List<Expense> expenses, String range, LocalDate today) {
        Map<String, BigDecimal> trendMap = new LinkedHashMap<>();

        if (range.equals("daily")) {
            DateTimeFormatter keyFmt = DateTimeFormatter.ofPattern("MM-dd");
            for (int i = 29; i >= 0; i--) {
                LocalDate day = today.minusDays(i);
                trendMap.put(day.format(keyFmt), BigDecimal.ZERO);
            }

            for (Expense expense : expenses) {
                String key = expense.getDate().format(keyFmt);
                trendMap.merge(key, expense.getAmount(), BigDecimal::add);
            }
        } else if (range.equals("yearly")) {
            for (int i = 4; i >= 0; i--) {
                int year = today.minusYears(i).getYear();
                trendMap.put(String.valueOf(year), BigDecimal.ZERO);
            }

            for (Expense expense : expenses) {
                String key = String.valueOf(expense.getDate().getYear());
                trendMap.merge(key, expense.getAmount(), BigDecimal::add);
            }
        } else {
            DateTimeFormatter keyFmt = DateTimeFormatter.ofPattern("MMM yy");
            YearMonth now = YearMonth.from(today);
            for (int i = 11; i >= 0; i--) {
                YearMonth month = now.minusMonths(i);
                trendMap.put(month.format(keyFmt), BigDecimal.ZERO);
            }

            for (Expense expense : expenses) {
                String key = YearMonth.from(expense.getDate()).format(keyFmt);
                trendMap.merge(key, expense.getAmount(), BigDecimal::add);
            }
        }

        return trendMap.entrySet().stream()
                .map(entry -> new TrendPoint(entry.getKey(), entry.getValue()))
                .collect(Collectors.toList());
    }

    private String normalizeRange(String range) {
        if (range == null) {
            return "monthly";
        }

        return switch (range.toLowerCase()) {
            case "daily", "monthly", "yearly" -> range.toLowerCase();
            default -> "monthly";
        };
    }
}
