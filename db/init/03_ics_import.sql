-- Canvas calendar feed import (logic/ics_feed.py, logic/ics_sync.py).
--
-- Safe to run more than once, and only ADDS tables: run it against the prod/testing database with
--   psql -U <user> -d tasker -f db/init/03_ics_import.sql
-- On a fresh dev database it runs on its own (docker-entrypoint-initdb.d, after 01_schema.sql).

BEGIN;

-- One row per Canvas feed a user has saved. Removing a feed (by the user, or because Canvas stopped
-- serving it) only sets disabled_at: the tasks it imported stay, and re-adding a feed from the same
-- host brings the row back so nothing is imported twice.
CREATE TABLE IF NOT EXISTS public.ics_feeds (
    id               serial        PRIMARY KEY,
    username         varchar(30)   NOT NULL REFERENCES public.users (username) ON DELETE CASCADE,
    url              text          NOT NULL,     -- secret (it is a login token): never log it; blanked on removal
    host             varchar(255)  NOT NULL,     -- e.g. elearning.utdallas.edu
    tz               varchar(64)   NOT NULL,     -- the user's IANA timezone, e.g. America/Chicago
    created_at       timestamptz   NOT NULL DEFAULT now(),
    next_sync_at     timestamptz   NOT NULL DEFAULT now(),   -- the sync worker picks up feeds whose time has come
    last_hash        char(64),                   -- sha256 of the last body that synced; same body = nothing to do
    last_success_at  timestamptz,
    last_error       varchar(200),
    fail_count       integer       NOT NULL DEFAULT 0,       -- consecutive responses that weren't a calendar (4xx, HTML...)
    sync_stage       varchar(20),                -- during a first import: fetching / naming / importing (the panel's progress bar)
    saved_at         timestamptz,                -- when the user last saved a link (tasks_db.SAVE_COOLDOWN)
    disabled_at      timestamptz,
    disabled_reason  varchar(20)                 -- 'user' (removed it) or 'dead' (Canvas stopped serving it)
);
-- one live feed per user (for now)
CREATE UNIQUE INDEX IF NOT EXISTS ics_feeds_one_live_per_user ON public.ics_feeds (username) WHERE disabled_at IS NULL;
CREATE INDEX IF NOT EXISTS ics_feeds_due ON public.ics_feeds (next_sync_at) WHERE disabled_at IS NULL;
-- a link is one person's Canvas login: one live Tasker account per link
CREATE UNIQUE INDEX IF NOT EXISTS ics_feeds_one_live_url ON public.ics_feeds (url) WHERE disabled_at IS NULL AND url <> '';

-- One row per Canvas assignment that became a task. task_id goes NULL when the user deletes the task:
-- the row stays behind as a marker so that assignment is never imported again.
CREATE TABLE IF NOT EXISTS public.ics_imports (
    id             serial        PRIMARY KEY,
    feed_id        integer       NOT NULL REFERENCES public.ics_feeds (id) ON DELETE CASCADE,
    uid            varchar(200)  NOT NULL,       -- the feed's UID, e.g. event-assignment-345350
    task_id        integer       UNIQUE REFERENCES public.tasks (id) ON DELETE SET NULL,
    canvas_due_at  timestamp     NOT NULL,       -- UTC, same convention as tasks.task_datetime; last value Canvas gave
    canvas_title   varchar(300)  NOT NULL,       -- last title Canvas gave (without the [course] tag)
    canvas_url     varchar(300),                 -- built by us: https://<host>/courses/<id>/assignments/<id>
    course_key     varchar(100),                 -- e.g. "CE 4390/CS 4390"; looks up course_names and ics_course_colors
    synced_name    varchar(150),                 -- the task_name we last wrote; differs from tasks.task_name once the user renames
    name_resolved  boolean       NOT NULL DEFAULT false,   -- synced_name used the course's real name, not its code
    missing_count  integer       NOT NULL DEFAULT 0,       -- consecutive syncs the UID was absent; deleted at 2
    created_at     timestamptz   NOT NULL DEFAULT now(),
    UNIQUE (feed_id, uid)
);

-- Each course's color for one user's feed: picked automatically (logic/colors.py COURSE_ORDER) when the
-- course first shows up, changeable in the Canvas panel. Changing it recolors that course's tasks,
-- except ones the user recolored by hand.
CREATE TABLE IF NOT EXISTS public.ics_course_colors (
    feed_id     integer       NOT NULL REFERENCES public.ics_feeds (id) ON DELETE CASCADE,
    course_key  varchar(100)  NOT NULL,
    color       varchar(10)   NOT NULL,
    PRIMARY KEY (feed_id, course_key)
);

-- Course names, shared by every user on the same Canvas host. Filled in by an LLM with web search.
CREATE TABLE IF NOT EXISTS public.course_names (
    host             varchar(255)  NOT NULL,
    course_key       varchar(100)  NOT NULL,
    official_name    varchar(200),
    short_name       varchar(40),                -- NULL until resolved; tasks show the course code meanwhile
    resolved_at      timestamptz,
    failed_attempts  integer       NOT NULL DEFAULT 0,
    last_attempt_at  timestamptz,
    PRIMARY KEY (host, course_key)
);

-- The sync worker stamps this every loop; the app reads it to tell users when syncing is paused.
CREATE TABLE IF NOT EXISTS public.ics_sync_heartbeat (
    id       smallint     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    beat_at  timestamptz  NOT NULL
);

COMMIT;
