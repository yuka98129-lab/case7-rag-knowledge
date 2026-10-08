/** 設定の漏れ。画面に出すメッセージを、そのまま持つ */
export class ConfigError extends Error {}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new ConfigError(`環境変数 ${name} が設定されていません。Vercel の Environment Variables に登録して、再公開(Redeploy)してください。`);
  return value;
}
