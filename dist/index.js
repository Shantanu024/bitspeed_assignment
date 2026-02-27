"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const identify_1 = require("./identify");
const db_1 = require("./db");
const app = (0, express_1.default)();
app.use(express_1.default.json());
// ─── POST /identify ──────────────────────────────────────────────────────────
app.post("/identify", async (req, res, next) => {
    try {
        const { email, phoneNumber } = req.body;
        // At least one of email or phoneNumber must be provided
        if (!email && !phoneNumber) {
            res.status(400).json({
                error: "At least one of email or phoneNumber is required.",
            });
            return;
        }
        const contact = await (0, identify_1.identify)(email ?? undefined, phoneNumber !== undefined ? String(phoneNumber) : undefined);
        res.status(200).json({ contact });
    }
    catch (err) {
        next(err);
    }
});
// ─── Health check ────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
    res.json({ status: "ok", message: "Identity Reconciliation API is running" });
});
// ─── Error handler ───────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    console.error("Error:", err.message, err.stack);
    res.status(500).json({ error: "Internal server error" });
});
// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
async function startServer() {
    try {
        // Wait for database to initialize before starting server
        await db_1.dbReady;
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    }
    catch (err) {
        console.error("Failed to start server:", err);
        process.exit(1);
    }
}
startServer();
exports.default = app;
