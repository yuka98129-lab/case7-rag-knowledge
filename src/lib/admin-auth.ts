import { timingSafeEqual } from "node:crypto";
import { requireEnv } from "./env";

/** 取り込み・精度測定の画面で入力する合言葉(ADMIN_PASSWORD)が、合っているか確かめる */
export function checkAdminPassword(req: Request): boolean {
  const expected = requireEnv("ADMIN_PASSWORD");
  const given = req.headers.get("x-admin-password") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
