
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "../db/pool.js";

const PgSession = connectPgSimple(session);

export const sessionMiddleware = session({
  name: "teamflow.sid",
  store: new PgSession({
    pool,
    tableName: "sessions",
    createTableIfMissing: false
  }),
  secret: (() => {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is required");
  return value;
})(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
});
