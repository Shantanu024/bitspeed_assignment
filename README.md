# Identity Reconciliation API

A Node.js + TypeScript + Express service that reconciles customer identities across multiple purchases by linking contact records that share an email or phone number.

🔗 **Live Endpoint:** https://bitspeed-assignment-5jrz.onrender.com

---

## API Endpoints

### Health Check - `GET /`

Check if the API is running and healthy.

**Request:**
```
GET /
```

**Response:**
```json
{
  "status": "ok",
  "message": "Identity Reconciliation API is running"
}
```

---

### Identify & Reconcile - `POST /identify`

Find or create a customer identity by email and/or phone number. If matching contacts exist, they get linked into a consolidated cluster.

### Request Body (JSON)

```json
{
  "email": "user@example.com",      
  "phoneNumber": "+1234567890"      
}
```

> **Note:** You must provide at least one of `email` or `phoneNumber` (or both).

### Response

On success, you get back a consolidated contact object with all linked identities:

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["primary@example.com", "secondary@example.com"],
    "phoneNumbers": ["+1234567890"],
    "secondaryContactIds": [23, 45]
  }
}
```

- **primaryContactId** - The main contact ID representing this identity
- **emails** - All unique emails across the cluster
- **phoneNumbers** - All unique phone numbers across the cluster
- **secondaryContactIds** - Any linked secondary contact IDs

---

## Quick Start 🚀

### Prerequisites
- Node.js v18 or higher
- npm (comes with Node.js)
- PostgreSQL database (for persistence)

### Local Development

```bash
# Install dependencies
npm install

# Set up environment variables
# Create a .env file with your PostgreSQL connection string:
# DATABASE_URL=postgresql://user:password@localhost:5432/identity_db
# NODE_ENV=development

# Run in development mode (with hot reload)
npm run dev
```

### Production Build

```bash
# Compile TypeScript to JavaScript
npm install && npm run build

# Start the production server
npm start
```

The server starts on **port 3000** by default. You can change it by setting the `PORT` environment variable.

---

## How It Works 🧠

The API uses a simple algorithm to consolidate customer identities:

1. **Brand New Customer?** → Create a new `primary` contact and return it.

2. **Existing Match** → If we find a contact with the same email or phone:
   - If they're in the same cluster, check for new information
   - If we have new email/phone, create a `secondary` contact linked to the primary
   - Return the complete consolidated cluster

3. **Multiple Clusters?** → Merge them intelligently:
   - The **oldest primary** remains the primary contact
   - Newer primaries become `secondary` contacts
   - All their linked secondaries get re-parented to the main primary
   - Return the consolidated cluster

**Result:** No matter how a customer contacts you, you can always identify them uniquely!

---

## Tech Stack 🛠️

- **Runtime:** Node.js
- **Language:** TypeScript
- **Framework:** Express.js
- **Database:** PostgreSQL with node-postgres (pg)
- **Port:** 3000 (configurable)
