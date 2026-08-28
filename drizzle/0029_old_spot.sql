ALTER TABLE `companyKnowledgeJobs` ADD `corpusSnapshot` longtext;--> statement-breakpoint
ALTER TABLE `companyKnowledgeJobs` ADD `corpusHash` varchar(64);--> statement-breakpoint
ALTER TABLE `companyKnowledgeJobs` ADD `sourceHashes` json;--> statement-breakpoint
ALTER TABLE `companyKnowledgeJobs` ADD `analysisDraft` longtext;--> statement-breakpoint
ALTER TABLE `companyKnowledgeJobs` ADD `auditDraft` longtext;--> statement-breakpoint
ALTER TABLE `companyKnowledgeJobs` ADD `validatedPack` longtext;--> statement-breakpoint
ALTER TABLE `companyKnowledgeJobs` ADD `temporaryResources` json;--> statement-breakpoint
ALTER TABLE `companyKnowledgeJobs` ADD `analysisCalls` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `companyKnowledgeJobs` ADD `repairCalls` int DEFAULT 0 NOT NULL;