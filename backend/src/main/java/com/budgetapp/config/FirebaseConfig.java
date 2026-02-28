package com.budgetapp.config;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.cloud.FirestoreClient;
import com.google.cloud.firestore.Firestore;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FirebaseConfig {

    @Value("${app.firebase.project-id:}")
    private String projectId;

    @Bean
    public Firestore firestore() {
        try {
            if (FirebaseApp.getApps().isEmpty()) {
                FirebaseOptions.Builder optionsBuilder = FirebaseOptions.builder()
                        .setCredentials(GoogleCredentials.getApplicationDefault());

                if (!projectId.isBlank()) {
                    optionsBuilder.setProjectId(projectId);
                }

                FirebaseApp.initializeApp(optionsBuilder.build());
            }

            return FirestoreClient.getFirestore();
        } catch (IOException exception) {
            throw new IllegalStateException(
                    "Firebase credentials are missing. Set GOOGLE_APPLICATION_CREDENTIALS and FIREBASE_PROJECT_ID.",
                    exception
            );
        }
    }
}
