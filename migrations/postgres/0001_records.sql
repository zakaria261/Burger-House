CREATE TABLE app_state (
  mode text PRIMARY KEY CHECK (mode = 'live'),
  revision integer NOT NULL DEFAULT 0,
  data jsonb NOT NULL,
  token uuid NOT NULL
);
CREATE TABLE app_records (
  mode text NOT NULL REFERENCES app_state(mode),
  kind text NOT NULL CHECK (kind IN ('entries', 'employees', 'shifts', 'notes', 'audit')),
  id text NOT NULL,
  data jsonb NOT NULL,
  recorded_order bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY (mode, kind, id)
);
CREATE INDEX app_records_read_order ON app_records(mode, recorded_order);
CREATE TABLE clock_attempts (
  id text PRIMARY KEY,
  count integer NOT NULL,
  until bigint NOT NULL
);
