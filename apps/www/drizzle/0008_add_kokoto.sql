-- Durable workflow runtime (@pickmyfruit/kokoto) — `_dc_*` tables.
-- Canonical DDL lives in `packages/kokoto/src/schema.server.ts` (KOKOTO_DDL).
-- Keep this file and that constant in sync: when one changes, change the other.

CREATE TABLE `_dc_workflow` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL CHECK (`status` IN ('pending', 'running', 'success', 'error', 'cancelled')),
	`queue` text,
	`input` text NOT NULL CHECK (json_valid(`input`) AND length(cast(`input` AS blob)) <= 1000000),
	`output` text CHECK (`output` IS NULL OR (json_valid(`output`) AND length(cast(`output` AS blob)) <= 1000000)),
	`error` text CHECK (`error` IS NULL OR (json_valid(`error`) AND length(cast(`error` AS blob)) <= 1000000)),
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`executor_id` text,
	`scheduled_for` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`idempotency_key` text,
	`cancel_requested_at` integer,
	`claim_expires_at` integer,
	`protocol_version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `_dc_workflow_idempotency_key_unique` ON `_dc_workflow` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `_dc_workflow_status_sched_created_idx` ON `_dc_workflow` (`status`, `scheduled_for`, `created_at`);
--> statement-breakpoint
CREATE INDEX `_dc_workflow_queue_status_sched_idx` ON `_dc_workflow` (`queue`, `status`, `scheduled_for`);
--> statement-breakpoint
CREATE INDEX `_dc_workflow_name_status_idx` ON `_dc_workflow` (`name`, `status`);
--> statement-breakpoint
CREATE INDEX `_dc_workflow_executor_status_idx` ON `_dc_workflow` (`executor_id`, `status`);
--> statement-breakpoint
CREATE INDEX `_dc_workflow_status_claim_expires_idx` ON `_dc_workflow` (`status`, `claim_expires_at`);
--> statement-breakpoint
CREATE TABLE `_dc_step` (
	`workflow_id` text NOT NULL,
	`step_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL CHECK (`status` IN ('success', 'error')),
	`output` text CHECK (`output` IS NULL OR (json_valid(`output`) AND length(cast(`output` AS blob)) <= 1000000)),
	`error` text CHECK (`error` IS NULL OR (json_valid(`error`) AND length(cast(`error` AS blob)) <= 1000000)),
	`attempts` integer DEFAULT 1 NOT NULL,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workflow_id`, `step_id`),
	FOREIGN KEY (`workflow_id`) REFERENCES `_dc_workflow`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `_dc_step_workflow_idx` ON `_dc_step` (`workflow_id`);
--> statement-breakpoint
CREATE TABLE `_dc_executor` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`heartbeat_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `_dc_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `_dc_meta` (`key`, `value`) VALUES ('protocol_version', '1');
