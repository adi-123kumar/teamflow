
import "./config/env.js";
import express from "express";
import { pool } from "./db/pool.js";
import { sessionMiddleware } from "./config/session.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { organizationsRouter } from "./modules/organizations/organizations.routes.js";
import { projectsRouter } from "./modules/projects/projects.routes.js";
import { tasksRouter } from "./modules/tasks/tasks.routes.js";
import { activityRouter } from "./modules/activity/activity.routes.js";
const app = express();
const port = Number(process.env.PORT ?? 3000);

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.use(sessionMiddleware);

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/organizations", organizationsRouter);

app.use(
  "/api/v1/organizations/:organizationId",
  activityRouter
);
app.use(
  "/api/v1/organizations/:organizationId/projects",
  projectsRouter
);
app.use(
  "/api/v1/organizations/:organizationId/projects/:projectId/tasks",
  tasksRouter
);

app.get("/health/live", (_req, res) => {
    res.status(200).json({
        status: "alive"
    });
});

app.get("/health/ready", async (_req, res) => {
    try {
        await pool.query("SELECT 1");

        res.status(200).json({
            status: "ready",
            database: "connected"
        });
    } catch (error) {
        console.error("Database readiness check failed:", error);

        res.status(503).json({
            status: "not_ready",
            database: "disconnected"
        });
    }
});

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("Unhandled request error:", error);

    if (res.headersSent) return;

    res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred."
    });
  }
);

const server = app.listen(port, () => {
    console.log(`TeamFlow API listening on port ${port}`);
});

function shutdown() {
    server.close(() => {
        void pool.end().finally(() => {
            process.exit(0);
        });
    });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
