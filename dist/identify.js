"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identify = identify;
const db_1 = require("./db");
// ─── Helpers ────────────────────────────────────────────────────────────────
async function getContactById(id) {
    return (0, db_1.dbGet)("SELECT * FROM Contact WHERE id = $1 AND deletedAt IS NULL", [id]);
}
async function getPrimaryContact(contact) {
    if (contact.linkPrecedence === "primary")
        return contact;
    if (!contact.linkedId) {
        throw new Error(`Secondary contact ${contact.id} has invalid linkedId`);
    }
    const primary = await getContactById(contact.linkedId);
    if (!primary) {
        throw new Error(`Primary contact not found`);
    }
    return primary;
}
/** Fetch all contacts in a cluster (primary + all its secondaries) */
async function getCluster(primaryId) {
    return (0, db_1.dbAll)(`SELECT * FROM Contact
     WHERE (id = $1 OR linkedId = $2) AND deletedAt IS NULL`, [primaryId, primaryId]);
}
/** Build the consolidated response from a primary's cluster */
async function buildResponse(primaryId) {
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
    const secondaries = cluster.filter((c) => c.id !== primaryId);
    const emails = [];
    const phoneNumbers = [];
    // Primary values come first
    if (primary.email)
        emails.push(primary.email);
    if (primary.phoneNumber)
        phoneNumbers.push(primary.phoneNumber);
    for (const sec of secondaries) {
        if (sec.email && !emails.includes(sec.email))
            emails.push(sec.email);
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
async function identify(email, phoneNumber) {
    const now = new Date().toISOString();
    // Validate input
    if (!email && !phoneNumber) {
        throw new Error("At least one of email or phoneNumber is required.");
    }
    // 1. Find all contacts matching either email or phoneNumber
    let conditions = [];
    let params = [];
    let paramIndex = 1;
    if (email) {
        conditions.push(`email = $${paramIndex++}`);
        params.push(email);
    }
    if (phoneNumber) {
        conditions.push(`phoneNumber = $${paramIndex++}`);
        params.push(phoneNumber);
    }
    const whereClause = conditions.join(" OR ");
    const directMatches = await (0, db_1.dbAll)(`SELECT * FROM Contact WHERE (${whereClause}) AND deletedAt IS NULL`, params);
    // 2. No matches → brand new primary contact
    if (directMatches.length === 0) {
        const result = await (0, db_1.dbRun)(`INSERT INTO Contact (phoneNumber, email, linkedId, linkPrecedence, createdAt, updatedAt)
       VALUES ($1, $2, NULL, 'primary', $3, $4)
       RETURNING id`, [phoneNumber ?? null, email ?? null, now, now]);
        if (!result.lastID || result.lastID === 0) {
            throw new Error(`Failed to create new contact`);
        }
        return buildResponse(result.lastID);
    }
    // 3. Collect all unique primaries across matched contacts
    const primaryMap = new Map();
    for (const contact of directMatches) {
        const primary = await getPrimaryContact(contact);
        primaryMap.set(primary.id, primary);
    }
    // 4. If multiple primaries exist → merge into the oldest one
    let truePrimary;
    if (primaryMap.size > 1) {
        const sortedPrimaries = Array.from(primaryMap.values()).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        truePrimary = sortedPrimaries[0];
        // Demote all other primaries to secondary under truePrimary
        for (let i = 1; i < sortedPrimaries.length; i++) {
            const toMerge = sortedPrimaries[i];
            // Update the old primary itself
            await (0, db_1.dbRun)(`UPDATE Contact SET linkedId = $1, linkPrecedence = 'secondary', updatedAt = $2 WHERE id = $3`, [truePrimary.id, now, toMerge.id]);
            // Re-parent all its secondaries to truePrimary
            await (0, db_1.dbRun)(`UPDATE Contact SET linkedId = $1, updatedAt = $2 WHERE linkedId = $3 AND deletedAt IS NULL`, [truePrimary.id, now, toMerge.id]);
        }
    }
    else {
        truePrimary = Array.from(primaryMap.values())[0];
    }
    // 5. Check if the incoming request has new information not yet in the cluster
    const cluster = await getCluster(truePrimary.id);
    const existingEmails = new Set(cluster.map((c) => c.email).filter(Boolean));
    const existingPhones = new Set(cluster.map((c) => c.phoneNumber).filter(Boolean));
    const isNewEmail = email && !existingEmails.has(email);
    const isNewPhone = phoneNumber && !existingPhones.has(phoneNumber);
    if (isNewEmail || isNewPhone) {
        // Create a new secondary contact with the new info
        await (0, db_1.dbRun)(`INSERT INTO Contact (phoneNumber, email, linkedId, linkPrecedence, createdAt, updatedAt)
       VALUES ($1, $2, $3, 'secondary', $4, $5)`, [phoneNumber ?? null, email ?? null, truePrimary.id, now, now]);
    }
    return buildResponse(truePrimary.id);
}
