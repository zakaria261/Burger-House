-- Inventory items and their movements are stored as individual records, like entries and shifts.
ALTER TABLE app_records DROP CONSTRAINT IF EXISTS app_records_kind_check;
ALTER TABLE app_records ADD CONSTRAINT app_records_kind_check
  CHECK (kind IN ('entries', 'employees', 'shifts', 'notes', 'audit', 'stock', 'stockMoves'));
