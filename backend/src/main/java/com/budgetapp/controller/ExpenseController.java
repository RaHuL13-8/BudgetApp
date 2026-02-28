package com.budgetapp.controller;

import com.budgetapp.model.Expense;
import com.budgetapp.model.request.CreateExpenseRequest;
import com.budgetapp.model.response.AnalyticsResponse;
import com.budgetapp.service.ExpenseService;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class ExpenseController {

    private final ExpenseService expenseService;

    public ExpenseController(ExpenseService expenseService) {
        this.expenseService = expenseService;
    }

    @GetMapping("/expenses")
    public List<Expense> getExpenses(
            @RequestHeader("X-User-Id") String userId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to
    ) {
        return expenseService.getExpenses(userId, from, to);
    }

    @PostMapping("/expenses")
    public Expense createExpense(
            @RequestHeader("X-User-Id") String userId,
            @Valid @RequestBody CreateExpenseRequest request
    ) {
        return expenseService.createExpense(userId, request);
    }

    @DeleteMapping("/expenses/{expenseId}")
    public ResponseEntity<Void> deleteExpense(
            @RequestHeader("X-User-Id") String userId,
            @PathVariable String expenseId
    ) {
        expenseService.deleteExpense(userId, expenseId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/analytics")
    public AnalyticsResponse getAnalytics(
            @RequestHeader("X-User-Id") String userId,
            @RequestParam(defaultValue = "monthly") String range
    ) {
        return expenseService.getAnalytics(userId, range);
    }
}
