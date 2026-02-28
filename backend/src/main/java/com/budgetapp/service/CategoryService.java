package com.budgetapp.service;

import com.budgetapp.model.Category;
import com.google.api.core.ApiFuture;
import com.google.cloud.firestore.CollectionReference;
import com.google.cloud.firestore.DocumentReference;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.QueryDocumentSnapshot;
import com.google.cloud.firestore.QuerySnapshot;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class CategoryService {

    private static final List<Category> PREDEFINED_CATEGORIES = List.of(
            new Category("food", "Food", "#F97316", true),
            new Category("travel", "Travel", "#38BDF8", true),
            new Category("shopping", "Shopping", "#D946EF", true),
            new Category("rent", "Rent", "#F43F5E", true),
            new Category("utilities", "Utilities", "#22C55E", true),
            new Category("health", "Health", "#10B981", true),
            new Category("education", "Education", "#8B5CF6", true),
            new Category("entertainment", "Entertainment", "#EAB308", true),
            new Category("misc", "Misc", "#64748B", true)
    );

    private final Firestore firestore;

    public CategoryService(Firestore firestore) {
        this.firestore = firestore;
    }

    public List<Category> getCategories(String userId) {
        List<Category> merged = new ArrayList<>(PREDEFINED_CATEGORIES);
        merged.addAll(getCustomCategories(userId));
        return merged;
    }

    public Optional<Category> getCategoryById(String userId, String categoryId) {
        return getCategories(userId)
                .stream()
                .filter(category -> category.getId().equals(categoryId))
                .findFirst();
    }

    public Category createCustomCategory(String userId, String name, String color) {
        String trimmedName = name.trim();

        boolean duplicate = getCategories(userId)
                .stream()
                .anyMatch(category -> category.getName().toLowerCase(Locale.ROOT)
                        .equals(trimmedName.toLowerCase(Locale.ROOT)));

        if (duplicate) {
            throw new IllegalArgumentException("Category with the same name already exists.");
        }

        String id = UUID.randomUUID().toString();
        String normalizedColor = color == null || color.isBlank() ? "#0EA5E9" : color;

        Map<String, Object> payload = new HashMap<>();
        payload.put("name", trimmedName);
        payload.put("color", normalizedColor);
        payload.put("predefined", false);
        payload.put("createdAt", Instant.now().toString());

        try {
            DocumentReference ref = firestore.collection("users")
                    .document(userId)
                    .collection("categories")
                    .document(id);
            ref.set(payload).get();
            return new Category(id, trimmedName, normalizedColor, false);
        } catch (Exception exception) {
            throw new IllegalStateException("Failed to create category.", exception);
        }
    }

    private List<Category> getCustomCategories(String userId) {
        try {
            CollectionReference collection = firestore.collection("users")
                    .document(userId)
                    .collection("categories");

            ApiFuture<QuerySnapshot> future = collection.get();
            List<QueryDocumentSnapshot> docs = future.get().getDocuments();

            List<Category> custom = new ArrayList<>();
            for (QueryDocumentSnapshot doc : docs) {
                Map<String, Object> data = doc.getData();
                if (data == null) {
                    continue;
                }

                custom.add(new Category(
                        doc.getId(),
                        String.valueOf(data.getOrDefault("name", "Unnamed")),
                        String.valueOf(data.getOrDefault("color", "#0EA5E9")),
                        Boolean.parseBoolean(String.valueOf(data.getOrDefault("predefined", false)))
                ));
            }

            return custom;
        } catch (Exception exception) {
            throw new IllegalStateException("Failed to fetch categories.", exception);
        }
    }

    public Map<String, Category> categoryMap(String userId) {
        Map<String, Category> map = new LinkedHashMap<>();
        for (Category category : getCategories(userId)) {
            map.put(category.getId(), category);
        }
        return map;
    }
}
