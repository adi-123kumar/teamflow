
import { Router } from "express";
import argon2 from "argon2";
import { z } from "zod";
import { pool } from "../../db/pool.js";

export const authRouter = Router();

const credentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(12).max(128)
});

function normalizeEmail(email: string) {
  return email.toLowerCase();
}

function regenerateSession(req: Express.Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function saveSession(req: Express.Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

authRouter.post("/register", async (req, res, next) => {
  const parsed = credentialsSchema.extend({
    fullName: z.string().trim().min(2).max(120)
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "INVALID_INPUT",
      message: "Provide a valid name, email, and password of at least 12 characters."
    });
    return;
  }

  try {
    const email = normalizeEmail(parsed.data.email);
    const passwordHash = await argon2.hash(parsed.data.password);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, full_name, created_at`,
      [email, passwordHash, parsed.data.fullName]
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(409).json({
        error: "EMAIL_ALREADY_REGISTERED",
        message: "An account with this email already exists."
      });
      return;
    }

    next(error);
  }
});

authRouter.post("/login", async (req, res, next) => {
  const parsed = credentialsSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "INVALID_INPUT",
      message: "Provide a valid email and password."
    });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, email, full_name, password_hash
       FROM users
       WHERE email = $1`,
      [normalizeEmail(parsed.data.email)]
    );

    const user = result.rows[0];
    const passwordMatches = user
      ? await argon2.verify(user.password_hash, parsed.data.password)
      : false;

    if (!passwordMatches) {
      res.status(401).json({
        error: "INVALID_CREDENTIALS",
        message: "Email or password is incorrect."
      });
      return;
    }

    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name
      }
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", async (req, res, next) => {
  if (!req.session.userId) {
    res.status(401).json({
      error: "UNAUTHENTICATED",
      message: "Please log in."
    });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, email, full_name
       FROM users
       WHERE id = $1`,
      [req.session.userId]
    );

    if (result.rowCount === 0) {
      req.session.destroy(() => { });
      res.status(401).json({
        error: "UNAUTHENTICATED",
        message: "Please log in again."
      });
      return;
    }

    const user = result.rows[0];

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name
      }
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      next(error);
      return;
    }

    res.clearCookie("teamflow.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/"
    });

    res.status(200).json({ message: "Logged out successfully." });
  });
});
