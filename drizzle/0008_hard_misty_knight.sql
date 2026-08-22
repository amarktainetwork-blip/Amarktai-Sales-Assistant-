ALTER TABLE `actionProposals` ADD `executionClaimId` varchar(64);--> statement-breakpoint
ALTER TABLE `actionProposals` ADD `executionClaimedAt` timestamp;--> statement-breakpoint
CREATE INDEX `actionProposals_claim_expiry_idx` ON `actionProposals` (`state`,`executionClaimedAt`);