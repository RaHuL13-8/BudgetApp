package com.budgetapp.controller;

import com.budgetapp.model.Category;
import com.budgetapp.model.request.CreateCategoryRequest;
import com.budgetapp.service.CategoryService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/categories")
public class CategoryController {

    private final CategoryService categoryService;

    public CategoryController(CategoryService categoryService) {
        this.categoryService = categoryService;
    }

    @GetMapping
    public List<Category> getCategories(@RequestHeader("X-User-Id") String userId) {
        return categoryService.getCategories(userId);
    }

    @PostMapping
    public Category createCategory(
            @RequestHeader("X-User-Id") String userId,
            @Valid @RequestBody CreateCategoryRequest request
    ) {
        return categoryService.createCustomCategory(userId, request.getName(), request.getColor());
    }
}
