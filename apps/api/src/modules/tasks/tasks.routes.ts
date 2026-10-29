
import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../auth/require-auth.js";
import { requireOrgMembership } from "../organizations/require-org-membership.js";

type TaskRouteParams = {
  organizationId: string;
  projectId: string;
  taskId?: string;
};

type MembershipContext = {
  id: string;
  role: string;
};

export const tasksRouter = Router({ mergeParams: true });

const taskStatuses = [
  "todo",
  "in_progress",
  "in_review",
  "done"
] as const;

const taskPriorities = [
  "low",
  "medium",
  "high",
  "urgent"
] as const;

const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  status: z.enum(taskStatuses).optional(),
  priority: z.enum(taskPriorities).optional(),
  assigneeMembershipId: z.string().uuid().nullable().optional(),
  dueDate: z.iso.date().nullable().optional()
});

const updateTaskSchema = createTaskSchema.partial();

const deletionRoles = ["owner", "admin", "project_manager"];

// Insert an audit record using the same database connection
// and transaction as the task operation.
async function writeActivityLog(
  client: PoolClient,
  input: {
    organizationId: string;
    actorMembershipId: string;
    projectId: string | null;
    taskId: string | null;
    action: string;
    details: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO activity_logs (
       organization_id,
       actor_membership_id,
       project_id,
       task_id,
       action,
       details
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.organizationId,
      input.actorMembershipId,
      input.projectId,
      input.taskId,
      input.action,
      JSON.stringify(input.details)
    ]
  );
}

// Shared transaction helper. If either the task operation or its
// activity log fails, neither change is committed.
async function inTransaction<T>(
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const result = await operation(client);

    await client.query("COMMIT");
    transactionStarted = false;

    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original error.
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

tasksRouter.use(requireAuth);
tasksRouter.use(requireOrgMembership);

// GET /organizations/:organizationId/projects/:projectId/tasks
tasksRouter.get<TaskRouteParams>("/", async (req, res, next) => {
  try {
    const project = await pool.query(
      `SELECT id
       FROM projects
       WHERE id = $1 AND organization_id = $2`,
      [req.params.projectId, req.params.organizationId]
    );

    if (project.rowCount === 0) {
      res.status(404).json({ error: "PROJECT_NOT_FOUND" });
      return;
    }

    const result = await pool.query(
      `SELECT t.id, t.organization_id, t.project_id,
              t.title, t.description, t.status, t.priority,
              t.assignee_membership_id, t.due_date,
              t.created_by_membership_id,
              t.created_at, t.updated_at
       FROM tasks t
       WHERE t.organization_id = $1
         AND t.project_id = $2
       ORDER BY t.created_at DESC`,
      [req.params.organizationId, req.params.projectId]
    );

    res.status(200).json({ tasks: result.rows });
  } catch (error) {
    next(error);
  }
});

// POST /organizations/:organizationId/projects/:projectId/tasks
tasksRouter.post<TaskRouteParams>("/", async (req, res, next) => {
  const parsed = createTaskSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "INVALID_INPUT",
      message: "Provide valid task details."
    });
    return;
  }

  try {
    const organizationId = req.params.organizationId;
    const projectId = req.params.projectId;
    const membership = res.locals.membership as MembershipContext;
    const data = parsed.data;

    const project = await pool.query(
      `SELECT id
       FROM projects
       WHERE id = $1 AND organization_id = $2`,
      [projectId, organizationId]
    );

    if (project.rowCount === 0) {
      res.status(404).json({ error: "PROJECT_NOT_FOUND" });
      return;
    }

    if (data.assigneeMembershipId) {
      const assignee = await pool.query(
        `SELECT id
         FROM memberships
         WHERE id = $1 AND organization_id = $2`,
        [data.assigneeMembershipId, organizationId]
      );

      if (assignee.rowCount === 0) {
        res.status(400).json({
          error: "INVALID_ASSIGNEE",
          message: "The assignee must belong to this organization."
        });
        return;
      }
    }

    const task = await inTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO tasks (
           organization_id, project_id, title, description,
           status, priority, assignee_membership_id,
           due_date, created_by_membership_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, organization_id, project_id, title,
                   description, status, priority,
                   assignee_membership_id, due_date,
                   created_by_membership_id,
                   created_at, updated_at`,
        [
          organizationId,
          projectId,
          data.title,
          data.description ?? null,
          data.status ?? "todo",
          data.priority ?? "medium",
          data.assigneeMembershipId ?? null,
          data.dueDate ?? null,
          membership.id
        ]
      );

      const createdTask = result.rows[0];

      await writeActivityLog(client, {
        organizationId,
        actorMembershipId: membership.id,
        projectId,
        taskId: createdTask.id,
        action: "task.created",
        details: {
          title: createdTask.title,
          status: createdTask.status,
          priority: createdTask.priority
        }
      });

      return createdTask;
    });

    res.status(201).json({ task });
  } catch (error) {
    next(error);
  }
});

// PATCH /organizations/:organizationId/projects/:projectId/tasks/:taskId
tasksRouter.patch<TaskRouteParams>(
  "/:taskId",
  async (req, res, next) => {
    const parsed = updateTaskSchema.safeParse(req.body);

    if (
      !parsed.success ||
      Object.keys(parsed.data ?? {}).length === 0
    ) {
      res.status(400).json({
        error: "INVALID_INPUT",
        message: "Provide at least one valid task field."
      });
      return;
    }

    try {
      const organizationId = req.params.organizationId;
      const projectId = req.params.projectId;
      const membership = res.locals.membership as MembershipContext;
      const data = parsed.data;

      if (
        Object.hasOwn(data, "assigneeMembershipId") &&
        data.assigneeMembershipId !== null
      ) {
        const assignee = await pool.query(
          `SELECT id
           FROM memberships
           WHERE id = $1 AND organization_id = $2`,
          [data.assigneeMembershipId, organizationId]
        );

        if (assignee.rowCount === 0) {
          res.status(400).json({
            error: "INVALID_ASSIGNEE",
            message: "The assignee must belong to this organization."
          });
          return;
        }
      }

      const task = await inTransaction(async (client) => {
        const result = await client.query(
          `UPDATE tasks
           SET title = COALESCE($1, title),
               description = CASE
                 WHEN $2::boolean THEN $3::text
                 ELSE description
               END,
               status = COALESCE($4, status),
               priority = COALESCE($5, priority),
               assignee_membership_id = CASE
                 WHEN $6::boolean THEN $7::uuid
                 ELSE assignee_membership_id
               END,
               due_date = CASE
                 WHEN $8::boolean THEN $9::date
                 ELSE due_date
               END,
               updated_at = NOW()
           WHERE id = $10
             AND project_id = $11
             AND organization_id = $12
           RETURNING id, organization_id, project_id, title,
                     description, status, priority,
                     assignee_membership_id, due_date,
                     created_by_membership_id,
                     created_at, updated_at`,
          [
            data.title ?? null,
            Object.hasOwn(data, "description"),
            data.description ?? null,
            data.status ?? null,
            data.priority ?? null,
            Object.hasOwn(data, "assigneeMembershipId"),
            data.assigneeMembershipId ?? null,
            Object.hasOwn(data, "dueDate"),
            data.dueDate ?? null,
            req.params.taskId,
            projectId,
            organizationId
          ]
        );

        if (result.rowCount === 0) {
          return null;
        }

        const updatedTask = result.rows[0];

        await writeActivityLog(client, {
          organizationId,
          actorMembershipId: membership.id,
          projectId,
          taskId: updatedTask.id,
          action: "task.updated",
          details: {
            title: updatedTask.title,
            status: updatedTask.status,
            priority: updatedTask.priority
          }
        });

        return updatedTask;
      });

      if (!task) {
        res.status(404).json({ error: "TASK_NOT_FOUND" });
        return;
      }

      res.status(200).json({ task });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /organizations/:organizationId/projects/:projectId/tasks/:taskId
tasksRouter.delete<TaskRouteParams>(
  "/:taskId",
  async (req, res, next) => {
    const membership = res.locals.membership as MembershipContext;

    if (!deletionRoles.includes(membership.role)) {
      res.status(403).json({
        error: "FORBIDDEN",
        message: "You cannot delete tasks."
      });
      return;
    }

    try {
      const organizationId = req.params.organizationId;
      const projectId = req.params.projectId;

      const deletedTask = await inTransaction(async (client) => {
        const result = await client.query(
          `DELETE FROM tasks
           WHERE id = $1
             AND project_id = $2
             AND organization_id = $3
           RETURNING id, title, status, priority`,
          [req.params.taskId, projectId, organizationId]
        );

        if (result.rowCount === 0) {
          return null;
        }

        const task = result.rows[0];

        await writeActivityLog(client, {
          organizationId,
          actorMembershipId: membership.id,
          projectId,
          // The task is being deleted, so don't retain a task_id
          // that could violate the activity_logs foreign key.
          taskId: null,
          action: "task.deleted",
          details: {
            taskId: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority
          }
        });

        return task;
      });

      if (!deletedTask) {
        res.status(404).json({ error: "TASK_NOT_FOUND" });
        return;
      }

      res.status(200).json({
        message: "Task deleted successfully.",
        taskId: deletedTask.id
      });
    } catch (error) {
      next(error);
    }
  }
);
