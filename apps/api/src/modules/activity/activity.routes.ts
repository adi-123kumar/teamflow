
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../auth/require-auth.js";
import { requireOrgMembership } from "../organizations/require-org-membership.js";

type ActivityParams = {
  organizationId: string;
  projectId?: string;
};

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0)
});

export const activityRouter = Router({ mergeParams: true });

async function getActivityFeed(
  organizationId: string,
  projectId: string | undefined,
  limit: number,
  offset: number
) {
  const values: unknown[] = [organizationId];
  let projectFilter = "";

  if (projectId) {
    values.push(projectId);
    projectFilter = `AND a.project_id = $${values.length}`;
  }

  values.push(limit, offset);

  const limitPosition = values.length - 1;
  const offsetPosition = values.length;

  const result = await pool.query(
    `SELECT
       a.id,
       a.organization_id AS "organizationId",
       a.actor_membership_id AS "actorMembershipId",
       u.full_name AS "actorName",
       a.project_id AS "projectId",
       p.name AS "projectName",
       a.task_id AS "taskId",
       a.action,
       a.details,
       a.created_at AS "createdAt"
     FROM activity_logs a
     JOIN memberships m
       ON m.id = a.actor_membership_id
      AND m.organization_id = a.organization_id
     JOIN users u ON u.id = m.user_id
     LEFT JOIN projects p
       ON p.id = a.project_id
      AND p.organization_id = a.organization_id
     WHERE a.organization_id = $1
       ${projectFilter}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $${limitPosition}
     OFFSET $${offsetPosition}`,
    values
  );

  const countValues: unknown[] = [organizationId];

  let countFilter = "";

  if (projectId) {
    countValues.push(projectId);
    countFilter = "AND project_id = $2";
  }

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM activity_logs
     WHERE organization_id = $1
       ${countFilter}`,
    countValues
  );

  return {
    activities: result.rows,
    pagination: {
      limit,
      offset,
      total: countResult.rows[0].total,
      hasMore:
        offset + result.rows.length < countResult.rows[0].total
    }
  };
}

activityRouter.get(
  "/activity",
  requireAuth,
  requireOrgMembership,
  async (req, res, next) => {
    const parsed = paginationSchema.safeParse(req.query);

    if (!parsed.success) {
      res.status(400).json({
        error: "INVALID_PAGINATION",
        message: "limit must be 1–100 and offset must be non-negative."
      });
      return;
    }

    try {
      const params = req.params as ActivityParams;

      const feed = await getActivityFeed(
        params.organizationId,
        undefined,
        parsed.data.limit,
        parsed.data.offset
      );

      res.status(200).json(feed);
    } catch (error) {
      next(error);
    }
  }
);

activityRouter.get(
  "/projects/:projectId/activity",
  requireAuth,
  requireOrgMembership,
  async (req, res, next) => {
    const parsed = paginationSchema.safeParse(req.query);

    if (!parsed.success) {
      res.status(400).json({
        error: "INVALID_PAGINATION",
        message: "limit must be 1–100 and offset must be non-negative."
      });
      return;
    }

    try {
      const params = req.params as ActivityParams;

      const projectResult = await pool.query(
        `SELECT id
         FROM projects
         WHERE id = $1
           AND organization_id = $2`,
        [params.projectId, params.organizationId]
      );

      if (projectResult.rowCount === 0) {
        res.status(404).json({
          error: "PROJECT_NOT_FOUND",
          message: "Project not found in this organization."
        });
        return;
      }

      const feed = await getActivityFeed(
        params.organizationId,
        params.projectId,
        parsed.data.limit,
        parsed.data.offset
      );

      res.status(200).json(feed);
    } catch (error) {
      next(error);
    }
  }
);
