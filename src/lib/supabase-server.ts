// サーバー側(API)で使う Supabase。
//   ・adminClient: 管理用の鍵(service_role)。部署の制限を「無視」できる。取り込みと精度の測定だけに使う
//   ・userClient : ログインした人の権限で動く。部署の制限(RLS)がそのまま効く。質問に使う
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { requireEnv } from "./env";

const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

export function adminClient(): SupabaseClient {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth });
}

export function userClient(accessToken: string): SupabaseClient {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export function bearerToken(req: Request): string | null {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** リクエストのログイン情報を確かめて、その人の権限で動くクライアントを返す。未ログインなら null */
export async function authenticate(req: Request): Promise<{ user: User; client: SupabaseClient } | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const client = userClient(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { user: data.user, client };
}
