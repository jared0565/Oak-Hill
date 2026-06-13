-- Migration 0001: party slots and bookings for the real-time booking system

CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,                 -- ISO date, YYYY-MM-DD
  start_time TEXT NOT NULL,           -- HH:MM (24h)
  end_time TEXT NOT NULL,             -- HH:MM (24h)
  label TEXT NOT NULL DEFAULT 'Party slot',
  status TEXT NOT NULL DEFAULT 'available',  -- available | held | booked | closed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_slots_date ON slots(date);
CREATE INDEX IF NOT EXISTS idx_slots_status ON slots(status);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id INTEGER NOT NULL,
  ref TEXT NOT NULL UNIQUE,           -- short human-friendly reference
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  children INTEGER,
  child_age TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (slot_id) REFERENCES slots(id)
);
CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(slot_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
