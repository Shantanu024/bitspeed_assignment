import express, { Request, Response, NextFunction } from "express";
import { identify } from "./identify";
import { IdentifyRequest } from "./types";

const app = express();
app.use(express.json());

// ─── POST /identify ──────────────────────────────────────────────────────────

app.post("/identify", async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log("POST /identify received with body:", req.body);
    const { email, phoneNumber }: IdentifyRequest = req.body;

    // At least one of email or phoneNumber must be provided
    if (!email && !phoneNumber) {
      res.status(400).json({
        error: "At least one of email or phoneNumber is required.",
      });
      return;
    }

    const contact = await identify(
      email ?? undefined,
      phoneNumber !== undefined ? String(phoneNumber) : undefined
    );

    console.log("✅ Identify response:", contact);
    res.status(200).json({ contact });
  } catch (err) {
    console.error("❌ Identify error:", err);
    next(err);
  }
});

// ─── Health check ────────────────────────────────────────────────────────────

app.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", message: "Identity Reconciliation API is running" });
});

// ─── Error handler ───────────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("❌ Error:", err.message, err.stack);
  res.status(500).json({ error: "Internal server error", message: err.message });
});

// ─── Start server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

export default app;
