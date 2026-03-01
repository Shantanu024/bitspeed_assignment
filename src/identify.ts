import { dbAll, dbGet, dbRun } from "./db";
import { Contact, ConsolidatedContact } from "./types";

/**
 * Input validation configuration and utilities
 */
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const MAX_EMAIL_LENGTH = 255;
const MAX_PHONE_LENGTH = 20;

/**
 * Validate email format and length
 * @throws Error if email is invalid
 */
function validateEmail(email: string): void {
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_REGEX.test(email)) {
    throw new Error("Invalid email format");
  }
}

/**
 * Validate phone number format and length
 * Accepts digits and common formatting characters (spaces, dashes, plus, parentheses)
 * @throws Error if phone is invalid
 */
function validatePhoneNumber(phone: string): void {
  const cleanPhone = phone.replace(/[\s\-\+\(\)]/g, "");
  if (cleanPhone.length === 0 || cleanPhone.length > MAX_PHONE_LENGTH || !/^\d+$/.test(cleanPhone)) {
    throw new Error("Invalid phone number format");
  }
}

/**
 * Helper functions for contact lookup and aggregation
 */

/**
 * Fetch a single contact by ID
 * @param id - Contact ID
 * @returns Contact or undefined if not found
 */
async function getContactById(id: number): Promise<Contact | undefined> {
  return dbGet<Contact>(
    "SELECT * FROM Contact WHERE id = $1 AND deletedAt IS NULL",
    [id]
  );
}

/**
 * Resolve a contact to its primary parent
 * @param contact - Contact to resolve (could be primary or secondary)
 * @returns The primary contact
 * @throws Error if contact is secondary with invalid linkedId or parent not found
 */
async function getPrimaryContact(contact: Contact): Promise<Contact> {
  if (contact.linkPrecedence === "primary") return contact;
  
  if (!contact.linkedId) {
    throw new Error(`Secondary contact ${contact.id} has invalid linkedId`);
  }
  
  const primary = await getContactById(contact.linkedId);
  if (!primary) {
    throw new Error(`Primary contact not found`);
  }
  return primary;
}

/**
 * Fetch all contacts in a cluster (primary + all secondary linked contacts)
 * @param primaryId - ID of the primary contact
 * @returns All contacts in the cluster, ordered by ID
 */
async function getCluster(primaryId: number): Promise<Contact[]> {
  return dbAll<Contact>(
    `SELECT * FROM Contact
     WHERE (id = $1 OR linkedId = $2) AND deletedAt IS NULL
     ORDER BY id ASC`,
    [primaryId, primaryId]
  );
}

/**
 * Build the API response by aggregating all contacts in a cluster
 * @param primaryId - ID of the primary contact
 * @returns Consolidated contact response with unique emails and phones
 * @throws Error if primaryId is invalid or cluster not found
 */
async function buildResponse(primaryId: number): Promise<ConsolidatedContact> {
  if (!primaryId || primaryId <= 0) {
    throw new Error(`Invalid primaryId: ${primaryId}`);
  }
  
  const cluster = await getCluster(primaryId);
  
  if (!cluster || cluster.length === 0) {
    throw new Error(`No contacts found in cluster for primaryId: ${primaryId}`);
  }
  
  const primary = cluster.find((c) => c.id === primaryId);
  if (!primary) {
    throw new Error(`Primary contact with id ${primaryId} not found in cluster`);
  }
  
  const emails: string[] = [];
  const phoneNumbers: string[] = [];
  const secondaryIds: number[] = [];
  
  // Use Set for O(1) lookups
  const emailSet = new Set<string>();
  const phoneSet = new Set<string>();

  // Primary values come first
  if (primary.email) {
    emailSet.add(primary.email);
    emails.push(primary.email);
  }
  if (primary.phoneNumber) {
    phoneSet.add(primary.phoneNumber);
    phoneNumbers.push(primary.phoneNumber);
  }

  // Add secondaries
  for (const contact of cluster) {
    if (contact.id === primaryId) continue;
    
    secondaryIds.push(contact.id);
    
    if (contact.email && !emailSet.has(contact.email)) {
      emailSet.add(contact.email);
      emails.push(contact.email);
    }
    if (contact.phoneNumber && !phoneSet.has(contact.phoneNumber)) {
      phoneSet.add(contact.phoneNumber);
      phoneNumbers.push(contact.phoneNumber);
    }
  }

  return {
    primaryContactId: primaryId,
    emails,
    phoneNumbers,
    secondaryContactIds: secondaryIds,
  };
}

/**
 * Main identity reconciliation function
 * 
 * Algorithm:
 * 1. Find all contacts matching email or phoneNumber
 * 2. If none exist, create new primary contact
 * 3. Collect all unique primaries from matched contacts
 * 4. If multiple primaries exist, merge into the oldest one
 * 5. If new info (email/phone) not in cluster, create secondary contact
 * 
 * @param email - Optional email address
 * @param phoneNumber - Optional phone number
 * @returns Consolidated contact with primary ID and linked contacts
 * @throws Error for invalid input or database errors
 */
export async function identify(
  email?: string,
  phoneNumber?: string
): Promise<ConsolidatedContact> {
  const now = new Date().toISOString();

  // Validate input
  if (!email && !phoneNumber) {
    throw new Error("At least one of email or phoneNumber is required.");
  }

  // Validate individual inputs
  if (email) validateEmail(email);
  if (phoneNumber) validatePhoneNumber(phoneNumber);

  // 1. Build dynamic WHERE clause for matching contacts
  const params: (string | number | null)[] = [];
  const conditions: string[] = [];

  if (email) {
    params.push(email);
    conditions.push(`email = $${params.length}`);
  }
  if (phoneNumber) {
    params.push(phoneNumber);
    conditions.push(`phoneNumber = $${params.length}`);
  }

  const whereClause = conditions.join(" OR ");
  const directMatches = await dbAll<Contact>(
    `SELECT * FROM Contact WHERE (${whereClause}) AND deletedAt IS NULL`,
    params
  );

  // 2. No matches → brand new primary contact
  if (directMatches.length === 0) {
    const result = await dbRun(
      `INSERT INTO Contact (phoneNumber, email, linkedId, linkPrecedence, createdAt, updatedAt)
       VALUES ($1, $2, NULL, 'primary', $3, $4)
       RETURNING id`,
      [phoneNumber ?? null, email ?? null, now, now]
    );
    
    if (!result.lastID || result.lastID === 0) {
      throw new Error(`Failed to create new contact`);
    }
    
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
