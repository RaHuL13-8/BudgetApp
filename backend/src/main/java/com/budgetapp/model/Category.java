package com.budgetapp.model;

public class Category {
    private String id;
    private String name;
    private String color;
    private boolean predefined;

    public Category() {
    }

    public Category(String id, String name, String color, boolean predefined) {
        this.id = id;
        this.name = name;
        this.color = color;
        this.predefined = predefined;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getColor() {
        return color;
    }

    public void setColor(String color) {
        this.color = color;
    }

    public boolean isPredefined() {
        return predefined;
    }

    public void setPredefined(boolean predefined) {
        this.predefined = predefined;
    }
}
