package com.budgetapp.model.response;

import java.math.BigDecimal;

public class TrendPoint {
    private String label;
    private BigDecimal amount;

    public TrendPoint() {
    }

    public TrendPoint(String label, BigDecimal amount) {
        this.label = label;
        this.amount = amount;
    }

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public void setAmount(BigDecimal amount) {
        this.amount = amount;
    }
}
