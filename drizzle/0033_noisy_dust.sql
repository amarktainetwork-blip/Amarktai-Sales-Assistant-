ALTER TABLE `actionProposals` ADD `governanceState` enum('PROPOSED','READY_FOR_REVIEW','APPROVED','REJECTED','EDITED','EXECUTING','VERIFIED','FAILED','NEEDS_ATTENTION') DEFAULT 'PROPOSED' NOT NULL;--> statement-breakpoint
ALTER TABLE `actionProposals` ADD `reviewedByUserId` int;--> statement-breakpoint
ALTER TABLE `actionProposals` ADD `verifiedAt` timestamp;--> statement-breakpoint
UPDATE `actionProposals`
SET `governanceState` = CASE
	WHEN `state` = 'review_required' THEN 'READY_FOR_REVIEW'
	WHEN `state` = 'approved' AND `executionClaimId` IS NOT NULL THEN 'EXECUTING'
	WHEN `state` = 'approved' THEN 'APPROVED'
	WHEN `state` = 'skipped' THEN 'REJECTED'
	WHEN `state` = 'executed' THEN 'VERIFIED'
	ELSE 'NEEDS_ATTENTION'
END,
`verifiedAt` = CASE WHEN `state` = 'executed' THEN `executedAt` ELSE NULL END;--> statement-breakpoint
ALTER TABLE `actionProposals` ADD CONSTRAINT `actionProposals_reviewedByUserId_users_id_fk` FOREIGN KEY (`reviewedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `actionProposals_governance_state_idx` ON `actionProposals` (`organisationId`,`governanceState`,`createdAt`);
