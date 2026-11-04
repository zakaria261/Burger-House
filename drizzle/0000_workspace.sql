CREATE TABLE `app_state` (
 `mode` text PRIMARY KEY NOT NULL,
 `revision` integer DEFAULT 0 NOT NULL,
 `data` text NOT NULL,
 `token` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clock_attempts` (
 `id` text PRIMARY KEY NOT NULL,
 `count` integer NOT NULL,
 `until` integer NOT NULL
);

--> statement-breakpoint
CREATE TABLE `app_records` (
 `mode` text NOT NULL,
 `kind` text NOT NULL,
 `id` text NOT NULL,
 `data` text NOT NULL,
 PRIMARY KEY (`mode`, `kind`, `id`)
);
