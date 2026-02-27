# Identity Reconciliation API

A Node.js + TypeScript + Express service that reconciles customer identities across multiple purchases by linking contact records that share an email or phone number.

## Endpoint

`POST /identify`

### Request Body (JSON)

```json
{
  "email": "user@example.com",      // optional
  "phoneNumber": "123456"           // optional
}
```
At least one field is required.

### Response

```json
{
  "contact": {
    "primaryContatctId": 1,
    "emails": ["primary@example.com", "secondary@example.com"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": [23]
  }
}
```

---

## Setup

### Prerequisites
- Node.js v18+
- npm

### Install & Run

```bash
# Install dependencies
npm install

# Development (ts-node)
npm run dev

# Production build
npm run build
npm start
```

The server starts on port `3000` by default. Set the `PORT` environment variable to change it.

---

## Logic Summary

1. **No matching contacts** → Create a new `primary` contact, return it.
2. **Matching contacts, same cluster** → If new email/phone info is in the request, create a `secondary` contact linked to the primary. Return the consolidated cluster.
3. **Matching contacts across two separate clusters** → Merge them: the **oldest** primary stays as `primary`; the newer primary becomes `secondary`. All its secondaries are re-parented. Return the consolidated cluster.

---

## Deployment (Render.com)

1. Push this repo to GitHub.
2. Create a new **Web Service** on [render.com](https://render.com).
3. Set:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
4. Add environment variable `PORT` if needed (Render sets it automatically).
5. Update this README with your live endpoint URL below.

### Live Endpoint
`https://your-app.onrender.com/identify`
