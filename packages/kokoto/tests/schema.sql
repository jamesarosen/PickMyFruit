CREATE TABLE `_dc_workflow` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`queue` text,
	`input` text NOT NULL,
	`output` text,
	`error` text,
	`attempts` integer NOT NULL DEFAULT 0,
	`max_attempts` integer NOT NULL DEFAULT 3,
	`executor_id` text,
	`scheduled_for` integer NOT NULL DEFAULT 0,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`idempotency_key` text,
	`cancel_requested_at` integer,
	`protocol_version` integer NOT NULL DEFAULT 1,
	CONSTRAINT `dc_workflow_input_json` CHECK (json_valid(`input`)),
	CONSTRAINT `dc_workflow_input_size` CHECK (length(cast(`input` as blob)) <= 1000000),
	CONSTRAINT `dc_workflow_output_json` CHECK (`output` IS NULL OR json_valid(`output`)),
	CONSTRAINT `dc_workflow_output_size` CHECK (
		`output` IS NULL OR length(cast(`output` as blob)) <= 1000000
	),
	CONSTRAINT `dc_workflow_error_json` CHECK (`error` IS NULL OR json_valid(`error`)),
	CONSTRAINT `dc_workflow_error_size` CHECK (
		`error` IS NULL OR length(cast(`error` as blob)) <= 1000000
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dc_workflow_idempotency_key_unique` ON `_dc_workflow` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `dc_workflow_status_scheduled_created_idx` ON `_dc_workflow` (
	`status`,
	`scheduled_for`,
	`created_at`
);
--> statement-breakpoint
CREATE INDEX `dc_workflow_queue_status_scheduled_idx` ON `_dc_workflow` (`queue`, `status`, `scheduled_for`);
--> statement-breakpoint
CREATE INDEX `dc_workflow_name_status_idx` ON `_dc_workflow` (`name`, `status`);
--> statement-breakpoint
CREATE INDEX `dc_workflow_executor_status_idx` ON `_dc_workflow` (`executor_id`, `status`);
--> statement-breakpoint
CREATE TABLE `_dc_step` (
	`workflow_id` text NOT NULL,
	`step_id` text NOT NULL,
	`status` text NOT NULL,
	`output` text,
	`error` text,
	`attempts` integer NOT NULL DEFAULT 0,
	`created_at` integer NOT NULL,
	`ended_at` integer,
	PRIMARY KEY (`workflow_id`, `step_id`),
	FOREIGN KEY (`workflow_id`) REFERENCES `_dc_workflow` (`id`) ON DELETE CASCADE,
	CONSTRAINT `dc_step_output_json` CHECK (`output` IS NULL OR json_valid(`output`)),
	CONSTRAINT `dc_step_output_size` CHECK (
		`output` IS NULL OR length(cast(`output` as blob)) <= 1000000
	),
	CONSTRAINT `dc_step_error_json` CHECK (`error` IS NULL OR json_valid(`error`)),
	CONSTRAINT `dc_step_error_size` CHECK (
		`error` IS NULL OR length(cast(`error` as blob)) <= 1000000
	)
);
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
