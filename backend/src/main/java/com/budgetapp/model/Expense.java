package com.budgetapp.model;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

public class Expense {
    private String id;
    private String userId;
    private String description;
    private String categoryId;
    private String categoryName;
    private BigDecimal amount;
    private LocalDate date;
    private Instant createdAt;

    public Expense() {
    }

    public Expense(
            String id,
            String userId,
            String description,
            String categoryId,
            String categoryName,
            BigDecimal amount,
            LocalDate date,
            Instant createdAt
    ) {
        this.id = id;
        this.userId = userId;
        this.description = description;
        this.categoryId = categoryId;
        this.categoryName = categoryName;
        this.amount = amount;
        this.date = date;
        this.createdAt = createdAt;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getUserId() {
        return userId;
    }

    public void setUserId(String userId) {
        this.userId = userId;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getCategoryId() {
        return categoryId;
    }

    public void setCategoryId(String categoryId) {
        this.categoryId = categoryId;
    }

    public String getCategoryName() {
        return categoryName;
    }

    public void setCategoryName(String categoryName) {
        this.categoryName = categoryName;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public void setAmount(BigDecimal amount) {
        this.amount = amount;
    }

    public LocalDate getDate() {
        return date;
    }

    public void setDate(LocalDate date) {
        this.date = date;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
