"use client";
// ブラウザ側で使う Supabase(ログイン用)。公開用のキー(anon)だけを使う。
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function isConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function getBrowserSupabase(): SupabaseClient {
  if (!client) {
    // NEXT_PUBLIC_ の値は、ビルドの時に埋め込まれる。この書き方のまま(変数に入れ替えない)にする
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");
  }
  return client;
}
