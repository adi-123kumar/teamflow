
import type { Request, Response, NextFunction } from "express";
import { pool } from "../../db/pool.js";

const validRoles = [
  "owner",
  "admin",
  "project_manager",
  "member"
] as const;

export type OrganizationRole = (typeof validRoles)[number];

export async function requireOrgMembership(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const organizationId = req.params.organizationId;
  const userId = req.session.userId;

  if (!userId) {
    res.status(401).json({
      error: "UNAUTHENTICATED"
    });
    return;
  }

  if (!organizationId) {
    res.status(400).json({
      error: "ORGANIZATION_ID_REQUIRED"
    });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, role
       FROM memberships
       WHERE organization_id = $1
         AND user_id = $2`,
      [organizationId, userId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({
        error: "ORGANIZATION_NOT_FOUND",
        message: "Organization not found."
      });
      return;
    }

    const membership = result.rows[0];

    if (
      !validRoles.includes(membership.role as OrganizationRole)
    ) {
      res.status(403).json({
        error: "INVALID_ORGANIZATION_ROLE"
      });
      return;
    }

    res.locals.membership = {
      id: membership.id as string,
      role: membership.role as OrganizationRole
    };

    next();
  } catch (error) {
    next(error);
  }
}
