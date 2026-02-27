import { dbAll, dbGet, dbRun } from "./db";
import { Contact, ConsolidatedContact } from "./types";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getContactById(id: number): Promise<Contact | undefined> {
  return dbGet<Contact>(
    "SELECT * FROM Contact WHERE id = $1 AND deletedAt IS NULL",
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
     WHERE (id = $1 OR linkedId = $2) AND deletedAt IS NULL`,
    [primaryId, primaryId]
  );
}

/** Build the consolidated response from a primary's cluster */
async function buildResponse(primaryId: number): Promise<ConsolidatedContact> {
  console.log("buildResponse called with primaryId:", primaryId, "type:", typeof primaryId);
  
  if (!primaryId || primaryId <= 0) {
    throw new Error(`Invalid primaryId: ${primaryId}`);
  }
  
  const cluster = await getCluster(primaryId);
  console.log(`Cluster for primaryId ${primaryId}:`, cluster.length, "contacts");
  
  if (!cluster || cluster.length === 0) {
    throw new Error(`No contacts found in cluster for primaryId: ${primaryId}`);
  }
  
  const primary = cluster.find((c) => c.id === primaryId);
  console.log(`Found primary?`, !!primary, primary);
  
  if (!primary) {
    throw new Error(`Primary contact with id ${primaryId} not found in cluster. Cluster ids: ${cluster.map(c => c.id).join(", ")}`);
  }
  
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
    primaryContactId: primaryId,
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

  // Validate input
  if (!email && !phoneNumber) {
    throw new Error("At least one of email or phoneNumber is required.");
  }

  // 1. Find all contacts matching either email or phoneNumber
  let conditions: string[] = [];
  let params: any[] = [];
  let paramIndex = 1;

  if (email) {
    conditions.push(`email = $${paramIndex++}`);
    params.push(email);
  }
  if (phoneNumber) {
    conditions.push(`phoneNumber = $${paramIndex++}`);
    params.push(phoneNumber);
  }

  if (conditions.length === 0) {
    throw new Error("At least one of email or phoneNumber must be provided.");
  }

  const whereClause = conditions.join(" OR ");
  const directMatches = await dbAll<Contact>(
    `SELECT * FROM Contact WHERE (${whereClause}) AND deletedAt IS NULL`,
    params
  );

  // 2. No matches → brand new primary contact
  if (directMatches.length === 0) {
    console.log("Creating new primary contact with email:", email, "phone:", phoneNumber);
    const result = await dbRun(
      `INSERT INTO Contact (phoneNumber, email, linkedId, linkPrecedence, createdAt, updatedAt)
       VALUES ($1, $2, NULL, 'primary', $3, $4)
       RETURNING id`,
      [phoneNumber ?? null, email ?? null, now, now]
    );
    
    console.log("Insert result:", result);
    
    if (!result.lastID || result.lastID === 0) {
      throw new Error(`Failed to create new contact. Got lastID: ${result.lastID}. Full result: ${JSON.stringify(result)}`);
    }
    
    console.log("Created new primary contact with id:", result.lastID);
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
        `UPDATE Contact SET linkedId = $1, linkPrecedence = 'secondary', updatedAt = $2 WHERE id = $3`,
        [truePrimary.id, now, toMerge.id]
      );

      // Re-parent all its secondaries to truePrimary
      await dbRun(
        `UPDATE Contact SET linkedId = $1, updatedAt = $2 WHERE linkedId = $3 AND deletedAt IS NULL`,
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
       VALUES ($1, $2, $3, 'secondary', $4, $5)`,
      [phoneNumber ?? null, email ?? null, truePrimary.id, now, now]
    );
  }

  return buildResponse(truePrimary.id);
}
