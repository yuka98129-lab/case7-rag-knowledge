// 監査ログ: 誰が・いつ・何を質問して・どのチャンクが参照されたかを、query_logs に残す。
// 書き込みは、サーバー側の管理用の鍵(service_role)で行う。一般のユーザーは、読むことも書くこともできない。
// user_id は、ログインの確認(getUser)で分かったものだけを使う。ブラウザから送られた値は信用しない。
import type { SupabaseClient } from "@supabase/supabase-js";

export class AuditError extends Error {}

export type QueryLogEntry = {
  userId: string;
  userDepartment: string | null;
  query: string;
  retrievedChunkIds: string[];
  channel: "web" | "slack";
};

export async function writeQueryLog(admin: SupabaseClient, entry: QueryLogEntry): Promise<void> {
  const { error } = await admin.from("query_logs").insert({
    user_id: entry.userId,
    user_department: entry.userDepartment,
    query: entry.query,
    retrieved_chunk_ids: entry.retrievedChunkIds,
    channel: entry.channel,
  });
  if (error) throw new AuditError(`監査ログを保存できなかったため、回答を止めました(${error.message})。`);
}

/** ログインした人の所属部署を、「、」でつないだ文字にする(自分の分だけ読める。RLS) */
export async function departmentsOf(client: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await client.from("kb_user_departments").select("department").eq("user_id", userId);
  if (error) return null;
  const names = (data ?? []).map((r: { department: string }) => r.department).sort();
  return names.length > 0 ? names.join("、") : null;
}
