package com.budgetapp.model.response;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

public class AnalyticsResponse {
    private String range;
    private BigDecimal totalSpend;
    private Map<String, BigDecimal> totalsByCategory;
    private List<TrendPoint> trend;

    public AnalyticsResponse() {
    }

    public AnalyticsResponse(String range, BigDecimal totalSpend, Map<String, BigDecimal> totalsByCategory, List<TrendPoint> trend) {
        this.range = range;
        this.totalSpend = totalSpend;
        this.totalsByCategory = totalsByCategory;
        this.trend = trend;
    }

    public String getRange() {
        return range;
    }

    public void setRange(String range) {
        this.range = range;
    }

    public BigDecimal getTotalSpend() {
        return totalSpend;
    }

    public void setTotalSpend(BigDecimal totalSpend) {
        this.totalSpend = totalSpend;
    }

    public Map<String, BigDecimal> getTotalsByCategory() {
        return totalsByCategory;
    }

    public void setTotalsByCategory(Map<String, BigDecimal> totalsByCategory) {
        this.totalsByCategory = totalsByCategory;
    }

    public List<TrendPoint> getTrend() {
        return trend;
    }

    public void setTrend(List<TrendPoint> trend) {
        this.trend = trend;
    }
}
