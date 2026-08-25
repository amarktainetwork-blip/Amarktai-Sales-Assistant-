ALTER TABLE `connectionSecrets` MODIFY COLUMN `ciphertext` longtext NOT NULL;--> statement-breakpoint
ALTER TABLE `websiteDiscoveries` MODIFY COLUMN `extractedText` longtext;