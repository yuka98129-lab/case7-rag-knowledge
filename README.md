# ナレッジ検索(案件7: 大規模RAG + 部署別アクセス制御)

過去の提案書・報告書(PDF)を、**部署ごとの権限つき**で検索して、**出典つき**で要約するアプリです。
案件7(模擬案件)の学習用で、サンプルの4文書(戦略・人事・IT・営業)で、取り込み・権限制御・精度測定の流れを試せます。

## できること

| 画面 | 内容 |
|---|---|
| `/` | ログインして、質問する。答えと、探した章(出典)が出る。見られるのは、自分の部署の文書だけ |
| `/admin` | PDFを取り込む(合言葉が必要)。章ごとに切り分けて、数値にして、保存する |
| `/eval` | テスト質問12問で、Recall@5・「該当なし」・部署の制限を確かめる |

## 仕組み

```
PDF → 章ごとに切る(chunker) → 数値にする(OpenAI Embedding) → Supabase(pgvector)に保存
質問 → 数値にする → ログインした人の権限で、近い章を5つ探す(RLS) → Claude が出典つきで要約
```

- **部署の制限(RLS)**: データベース側で、見てよい行だけを返す。ベクトル検索にもそのまま効く。
  質問の検索は「ログインした人の権限」で実行し、管理用の鍵(service_role)は使わない。
- **管理用の鍵(service_role)** は、取り込みと精度の測定にだけ使う(サーバー側のみ。ブラウザには渡さない)。
- **切り分け**: 見出し(「1.」「1-1.」「第1章」)で章に分ける。各チャンクの先頭に、文書名と章の見出しを付ける。
  課題の見本にあった「100文字以下の章を捨てる」ルールは、サンプルの短い文書では章の大半が消えるため、外している。

## 環境変数

`.env.example` を参照。Vercel の Environment Variables に登録して、再公開(Redeploy)する。

| 名前 | 内容 | ブラウザに渡る? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseのURL | はい |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 公開用のキー(anon / publishable) | はい |
| `SUPABASE_SERVICE_ROLE_KEY` | 管理用の鍵(service_role / secret) | **いいえ(絶対に NEXT_PUBLIC_ を付けない)** |
| `OPENAI_API_KEY` | Embedding用 | いいえ |
| `ANTHROPIC_API_KEY` | 要約用(Claude) | いいえ |
| `ADMIN_PASSWORD` | 取り込み・精度測定の画面の合言葉 | いいえ |
| `ANTHROPIC_MODEL` | (任意)Claude のモデル名。既定は `claude-sonnet-4-6` | いいえ |

## データベース

`supabase/schema.sql` を、SupabaseのSQL Editorで実行する(何度実行しても壊れない)。
テスト用のユーザーを部署に登録するSQLは `supabase/seed-test-users.sql`。

## テスト

```
npm install
npm test
```

- 章の切り分け(実際のサンプルPDFで)
- 取り込み(偽のデータベースと偽のEmbeddingで。失敗したときに、中途半端に残らないこと)
- 部署の制限(PGlite = Postgres + pgvector で、schema.sql を実際に実行して確認)
- Embedding・プロンプト・精度の計算・合言葉の確認

## 本番に近づけるときの注意

- **Embedding を外部に送ってよいか**: 本番の文書を外部のAPI(OpenAIなど)に送る前に、クライアントの情シスの許可を取る。
  許可されたサービス(AWS Bedrock など)に切り替える場合は、`src/lib/embed.ts` を差し替え、SQL の `vector(1536)` の次元数も合わせる。
- 文書が増えたら、検索の索引(hnsw)とフィルタの相性(部署で絞ると件数が減る問題)を、実データで確認する。
- 役職ごとの制御、PowerPoint対応、SharePointとの月次同期は、Phase 2。
