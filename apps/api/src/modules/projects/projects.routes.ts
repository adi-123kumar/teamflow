import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../auth/require-auth.js";
import { requireOrgMembership } from "../organizations/require-org-membership.js";
type OrganizationParams = {
  organizationId: string;
};

type ProjectParams = OrganizationParams & {
  projectId: string;
};
export const projectsRouter = Router({ mergeParams: true });

const projectSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(5000).nullable().optional()
});

const editableRoles = ["owner", "admin", "project_manager"];

projectsRouter.use(requireAuth);
projectsRouter.use(requireOrgMembership);

projectsRouter.get<OrganizationParams>(
  "/",
  async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT id, organization_id, name, description,
                status, created_at, updated_at
         FROM projects
         WHERE organization_id = $1
         ORDER BY created_at DESC`,
        [req.params.organizationId]
      );

      res.status(200).json({ projects: result.rows });
    } catch (error) {
      next(error);
    }
  }
);

projectsRouter.post<OrganizationParams>(
  "/",
  async (req, res, next) => {
  const membership = res.locals.membership as {
    id: string;
    role: string;
  };

  if (!editableRoles.includes(membership.role)) {
    res.status(403).json({
      error: "FORBIDDEN",
      message: "You cannot create projects in this organization."
    });
    return;
  }

  const parsed = projectSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "INVALID_INPUT",
      message: "Provide a valid project name and description."
    });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO projects
         (organization_id, name, description, created_by_membership_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, organization_id, name, description,
                 status, created_at, updated_at`,
      [
        req.params.organizationId,
        parsed.data.name,
        parsed.data.description ?? null,
        membership.id
      ]
    );

    res.status(201).json({ project: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

projectsRouter.patch<ProjectParams>(
  "/:projectId",
  async (req, res, next) => {
  const membership = res.locals.membership as {
    id: string;
    role: string;
  };

  if (!editableRoles.includes(membership.role)) {
    res.status(403).json({
      error: "FORBIDDEN",
      message: "You cannot edit projects."
    });
    return;
  }

  const parsed = projectSchema.partial().safeParse(req.body);

  if (
    !parsed.success ||
    Object.keys(parsed.data ?? {}).length === 0
  ) {
    res.status(400).json({
      error: "INVALID_INPUT",
      message: "Provide at least one valid project field."
    });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE projects
       SET name = COALESCE($1, name),
           description = CASE
             WHEN $2::boolean THEN $3::text
             ELSE description
           END,
           updated_at = NOW()
       WHERE id = $4 AND organization_id = $5
       RETURNING id, organization_id, name, description,
                 status, created_at, updated_at`,
      [
        parsed.data.name ?? null,
        Object.hasOwn(parsed.data, "description"),
        parsed.data.description ?? null,
        req.params.projectId,
        req.params.organizationId
      ]
    );

    if (result.rowCount === 0) {
      res.status(404).json({
        error: "PROJECT_NOT_FOUND"
      });
      return;
    }

    res.status(200).json({ project: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

projectsRouter.post<ProjectParams>(
  "/:projectId/archive",
  async (req, res, next) => {
      const membership = res.locals.membership as {
    id: string;
    role: string;
  };

  if (!editableRoles.includes(membership.role)) {
    res.status(403).json({
      error: "FORBIDDEN",
      message: "You cannot archive projects."
    });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE projects
       SET status = 'archived', updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING id, name, status`,
      [req.params.projectId, req.params.organizationId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: "PROJECT_NOT_FOUND" });
      return;
    }

    res.status(200).json({ project: result.rows[0] });
  } catch (error) {
    next(error);
  }
});
