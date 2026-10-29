
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../auth/require-auth.js";

export const organizationsRouter = Router();

organizationsRouter.use(requireAuth);

const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
});

organizationsRouter.post("/", async (req, res, next) => {
  const parsed = createOrganizationSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "INVALID_INPUT",
      message: "Provide a valid organization name and slug."
    });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const organizationResult = await client.query(
      `INSERT INTO organizations (name, slug)
       VALUES ($1, $2)
       RETURNING id, name, slug, created_at`,
      [parsed.data.name, parsed.data.slug]
    );

    const organization = organizationResult.rows[0];

    await client.query(
      `INSERT INTO memberships (organization_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [organization.id, req.session.userId]
    );

    await client.query("COMMIT");

    res.status(201).json({ organization });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(409).json({
        error: "ORGANIZATION_SLUG_TAKEN",
        message: "That organization slug is already in use."
      });
      return;
    }

    next(error);
  } finally {
    client.release();
  }
});

organizationsRouter.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.name, o.slug, m.role, m.joined_at
       FROM organizations o
       JOIN memberships m ON m.organization_id = o.id
       WHERE m.user_id = $1
       ORDER BY o.name ASC`,
      [req.session.userId]
    );

    res.status(200).json({
      organizations: result.rows
    });
  } catch (error) {
    next(error);
  }
});
