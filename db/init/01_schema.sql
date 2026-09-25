-- NLP_Tasker database schema.
-- Reverse-engineered from the production pg_dump (PostgreSQL 16.9, 2026-09-24).
-- Runs automatically on first start of an empty Postgres container
-- (mounted into /docker-entrypoint-initdb.d).
--
-- Left out on purpose: tasks_backup and tasks_testing. They exist in prod
-- but nothing in logic/ reads or writes them.

BEGIN;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE public.users (
    username  varchar(30)  PRIMARY KEY,
    pwhash    varchar(300),                -- werkzeug generate_password_hash()
    email     varchar(80)
);

-- signups waiting for admin approval
CREATE TABLE public.pendingapprovals (
    id             serial        PRIMARY KEY,
    username       varchar(50)   NOT NULL,
    email          varchar(255),
    password_hash  text          NOT NULL
);
CREATE UNIQUE INDEX pendingapprovals_username_idx ON public.pendingapprovals (username);

CREATE TABLE public.password_reset_tokens (
    token       varchar(64)  PRIMARY KEY,
    username    varchar(30)  NOT NULL REFERENCES public.users (username) ON DELETE CASCADE,
    created_at  timestamp    NOT NULL DEFAULT now(),
    used        boolean      NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
CREATE TABLE public.tasks (
    id                serial        PRIMARY KEY,
    username          varchar(30)   REFERENCES public.users (username) ON DELETE CASCADE,
    task_name         varchar(150)  NOT NULL,
    task_time         time,
    task_description  varchar(500),
    due_date          date,
    priority          integer,
    color             varchar(10),
    task_datetime     timestamp,    -- stored as UTC, built from due_date + task_time + client offset
    reminder_display  varchar(10)
);

-- ---------------------------------------------------------------------------
-- push notifications
-- ---------------------------------------------------------------------------
CREATE TABLE public.push_subscriptions (
    id          serial     PRIMARY KEY,
    username    varchar(30) NOT NULL REFERENCES public.users (username) ON DELETE CASCADE,
    endpoint    text        NOT NULL,
    p256dh      text        NOT NULL,
    auth        text        NOT NULL,
    created_at  timestamp   DEFAULT now(),
    UNIQUE (username, endpoint)
);

CREATE TABLE public.notifications (
    id               serial       PRIMARY KEY,
    username         varchar(30)  NOT NULL REFERENCES public.users (username) ON DELETE CASCADE,
    task_id          integer      NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
    notify_at        timestamptz  NOT NULL,
    sent             boolean      DEFAULT false,
    created_at       timestamp    DEFAULT now(),
    early_notify_at  timestamptz,               -- set by trigger below
    early_sent       boolean      DEFAULT false
);
CREATE INDEX idx_notifications_pending       ON public.notifications (notify_at)       WHERE sent = false;
CREATE INDEX idx_notifications_early_pending ON public.notifications (early_notify_at) WHERE early_sent = false;

-- early reminder fires 3h before the task
CREATE FUNCTION public.set_early_notify_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
  DECLARE
    task_dt timestamp;
  BEGIN
    SELECT task_datetime INTO task_dt FROM public.tasks WHERE id = NEW.task_id;
    NEW.early_notify_at := task_dt - interval '3 hours';
    RETURN NEW;
  END;
  $$;

CREATE TRIGGER trg_set_early_notify_at
    BEFORE INSERT OR UPDATE OF notify_at ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION public.set_early_notify_at();

-- debugging view: notification times in Central time
CREATE VIEW public.notifications_local AS
 SELECT id,
    username,
    task_id,
    sent,
    to_char((notify_at AT TIME ZONE 'America/Chicago'), 'MM/DD/YYYY HH:MI AM') AS notify_at_cdt,
    early_sent,
    to_char((early_notify_at AT TIME ZONE 'America/Chicago'), 'MM/DD/YYYY HH:MI AM') AS early_notify_at_cdt
   FROM public.notifications
  ORDER BY notify_at;

-- ---------------------------------------------------------------------------
-- LLM request log (fine-tuning data)
-- ---------------------------------------------------------------------------
CREATE TABLE public.sftdata (
    id                serial          PRIMARY KEY,
    username          varchar(30),
    user_input        varchar(1500),
    api_response      varchar(10000),
    expected_json     varchar(1500),
    user_tz_metadata  varchar(10000)
);

COMMIT;
