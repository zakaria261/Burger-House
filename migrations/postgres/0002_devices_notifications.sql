-- Persistent device credentials are stored as hashes, and revoked at explicit sign-out.
CREATE TABLE device_sessions (
  id uuid PRIMARY KEY,
  secret_hash text NOT NULL,
  user_id text NOT NULL,
  email text NOT NULL,
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX device_sessions_email ON device_sessions(email);
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES device_sessions(id),
  owner_email text NOT NULL,
  endpoint text UNIQUE NOT NULL,
  keys jsonb NOT NULL,
  events jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE push_deliveries (
  id uuid PRIMARY KEY,
  event_id text NOT NULL,
  subscription_id uuid NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  failed_at timestamptz,
  UNIQUE(event_id,subscription_id)
);
CREATE INDEX push_deliveries_pending ON push_deliveries(available_at) WHERE delivered_at IS NULL AND failed_at IS NULL;
