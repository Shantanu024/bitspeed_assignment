import { dbAll, dbGet, dbRun } from "./db";
import { Contact, ConsolidatedContact } from "./types";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getContactById(id: number): Promise<Contact | undefined> {
  return dbGet<Contact>(
    "SELECT * FROM Contact WHERE id = ? AND deletedAt IS NULL",
    [id]
  );
}

async function getPrimaryContact(contact: Contact): Promise<Contact> {
  if (contact.linkPrecedence === "primary") return contact;
  const primary = await getContactById(contact.linkedId!);
  if (!primary) throw new Error(`Primary contact ${contact.linkedId} not found`);
  return primary;
}

/** Fetch all contacts in a cluster (primary + all its secondaries) */
async function getCluster(primaryId: number): Promise<Contact[]> {
  return dbAll<Contact>(
    `SELECT * FROM Contact
     WHERE (id = ? OR linkedId = ?) AND deletedAt IS NULL`,
    [primaryId, primaryId]
  );
}

/** Build the consolidated response from a primary's cluster */
async function buildResponse(primaryId: number): Promise<ConsolidatedContact> {
  const cluster = await getCluster(primaryId);
  const primary = cluster.find((c) => c.id === primaryId)!;
  const secondaries = cluster.filter((c) => c.id !== primaryId);

  const emails: string[] = [];
  const phoneNumbers: string[] = [];

  // Primary values come first
  if (primary.email) emails.push(primary.email);
  if (primary.phoneNumber) phoneNumbers.push(primary.phoneNumber);

  for (const sec of secondaries) {
    if (sec.email && !emails.includes(sec.email)) emails.push(sec.email);
    if (sec.phoneNumber && !phoneNumbers.includes(sec.phoneNumber))
      phoneNumbers.push(sec.phoneNumber);
  }

  return {
    primaryContatctId: primaryId,
    emails,
    phoneNumbers,
    secondaryContactIds: secondaries.map((s) => s.id),
  };
}

// ─── Main identify function ──────────────────────────────────────────────────

export async function identify(
  email?: string,
  phoneNumber?: string
): Promise<ConsolidatedContact> {
  const now = new Date().toISOString();

  // 1. Find all contacts matching either email or phoneNumber
  let conditions: string[] = [];
  let params: (string | undefined)[] = [];

  if (email) {
    conditions.push("email = ?");
    params.push(email);
  }
  if (phoneNumber) {
    conditions.push("phoneNumber = ?");
    params.push(phoneNumber);
  }

  const whereClause = conditions.join(" OR ");
  const directMatches = await dbAll<Contact>(
    `SELECT * FROM Contact WHERE (${whereClause}) AND deletedAt IS NULL`,
    params.filter((p) => p !== undefined) as string[]
  );

  // 2. No matches → brand new primary contact
  if (directMatches.length === 0) {
    const result = await dbRun(
      `INSERT INTO Contact (phoneNumber, email, linkedId, linkPrecedence, createdAt, updatedAt)
       VALUES (?, ?, NULL, 'primary', ?, ?)`,
      [phoneNumber ?? null, email ?? null, now, now]
    );
    return buildResponse(result.lastID);
  }

  // 3. Collect all unique primaries across matched contacts
  const primaryMap = new Map<number, Contact>();

  for (const contact of directMatches) {
    const primary = await getPrimaryContact(contact);
    primaryMap.set(primary.id, primary);
  }

  // 4. If multiple primaries exist → merge into the oldest one
  let truePrimary: Contact;

  if (primaryMap.size > 1) {
    const sortedPrimaries = Array.from(primaryMap.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    truePrimary = sortedPrimaries[0];

    // Demote all other primaries to secondary under truePrimary
    for (let i = 1; i < sortedPrimaries.length; i++) {
      const toMerge = sortedPrimaries[i];

      // Update the old primary itself
      await dbRun(
        `UPDATE Contact SET linkedId = ?, linkPrecedence = 'secondary', updatedAt = ? WHERE id = ?`,
        [truePrimary.id, now, toMerge.id]
      );

      // Re-parent all its secondaries to truePrimary
      await dbRun(
        `UPDATE Contact SET linkedId = ?, updatedAt = ? WHERE linkedId = ? AND deletedAt IS NULL`,
        [truePrimary.id, now, toMerge.id]
      );
    }
  } else {
    truePrimary = Array.from(primaryMap.values())[0];
  }

  // 5. Check if the incoming request has new information not yet in the cluster
  const cluster = await getCluster(truePrimary.id);
  const existingEmails = new Set(cluster.map((c) => c.email).filter(Boolean));
  const existingPhones = new Set(
    cluster.map((c) => c.phoneNumber).filter(Boolean)
  );

  const isNewEmail = email && !existingEmails.has(email);
  const isNewPhone = phoneNumber && !existingPhones.has(phoneNumber);

  if (isNewEmail || isNewPhone) {
    // Create a new secondary contact with the new info
    await dbRun(
      `INSERT INTO Contact (phoneNumber, email, linkedId, linkPrecedence, createdAt, updatedAt)
       VALUES (?, ?, ?, 'secondary', ?, ?)`,
      [phoneNumber ?? null, email ?? null, truePrimary.id, now, now]
    );
  }

  return buildResponse(truePrimary.id);
}
