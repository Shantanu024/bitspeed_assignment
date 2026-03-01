import express, { Request, Response, NextFunction } from "express";
import { identify } from "./identify";
import { dbReady } from "./db";

const app = express();

/**
 * Security and performance configuration
 */
app.use(express.json({ limit: "10kb" })); // Limit payload to 10KB
app.set("trust proxy", 1); // Trust reverse proxy (for getting client IP)

/**
 * In-memory rate limiter: 100 requests per minute per IP
 * Stores request timestamps for each IP address
 */
const requestCounts = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute in milliseconds
const RATE_LIMIT_MAX_REQUESTS = 100; // Maximum requests per window

/**
 * Express middleware for rate limiting
 */
function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || "unknown";
  const now = Date.now();
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, []);
  }
  
  const times = requestCounts.get(ip)!;
  // Filter out old timestamps outside the window
  const recentRequests = times.filter(t => now - t < RATE_LIMIT_WINDOW);
  
  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ error: "Too many requests. Please try again later." });
  }
  
  recentRequests.push(now);
  requestCounts.set(ip, recentRequests);
  
  res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS);
  res.setHeader("X-RateLimit-Remaining", RATE_LIMIT_MAX_REQUESTS - recentRequests.length);
  
  next();
}

app.use(rateLimit);

/**
 * Add security headers to all responses
 */
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

/**
 * POST /identify - Identify or reconcile contacts
 * @param {string} email - Optional email address
 * @param {string} phoneNumber - Optional phone number
 * @returns {object} Consolidated contact information with primary ID and linked contacts
 */
app.post("/identify", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { email?: unknown; phoneNumber?: unknown };
    
    // Validate request body is a proper object
    if (!body || typeof body !== "object") {
      return res.status(400).json({
        error: "Invalid request body",
      });
    }
    
    const email = body.email !== undefined ? String(body.email).trim() : undefined;
    const phoneNumber = body.phoneNumber !== undefined ? String(body.phoneNumber).trim() : undefined;

    // At least one of email or phoneNumber must be provided
    if (!email && !phoneNumber) {
      return res.status(400).json({
        error: "At least one of email or phoneNumber is required.",
      });
    }

    const contact = await identify(email || undefined, phoneNumber || undefined);

    res.status(200).json({ contact });
  } catch (err) {
    next(err);
  }
});

/**
 * GET / - Health check endpoint
 */
app.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", message: "Identity Reconciliation API is running" });
});

/**
 * 404 handler for undefined routes
 */
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

/**
 * Global error handler for unhandled exceptions
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Error:", err.message);
  
  // Determine status code based on error message
  let statusCode = 500;
  let message = "Internal server error";
  
  if (err.message.includes("Invalid")) {
    statusCode = 400;
    message = err.message;
  } else if (err.message.includes("Not found")) {
    statusCode = 404;
    message = err.message;
  }
  
  res.status(statusCode).json({ error: message });
});

/**
 * Start the Express server
 */
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Wait for database to initialize before starting server
    await dbReady;
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

startServer();

export default app;
