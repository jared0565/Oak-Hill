// Contact upsert (uses D1). Dedup key = normalized email (every form requires an email).
import { normalizeEmail, clean } from "./contacts-core.mjs";

export async function upsertContact(db, { email, phone, name }) {
  const nemail = normalizeEmail(email);
  if (!nemail) return null;
  const dphone = clean(phone, 40) || null;   // stored raw for display
  const dname = clean(name, 100) || null;
  await db.prepare(
    `INSERT INTO contacts (email, phone, name) VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       last_seen = datetime('now'),
       name  = COALESCE(contacts.name, excluded.name),
       phone = COALESCE(contacts.phone, excluded.phone)`
  ).bind(nemail, dphone, dname).run();
  const row = await db.prepare("SELECT id FROM contacts WHERE email = ?").bind(nemail).first();
  return row ? row.id : null;
}
