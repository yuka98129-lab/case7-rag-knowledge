# ナレッジ検索(案件7: 大規模RAG + 部署別アクセス制御 + 監査ログ)

コンサルティング会社の過去の提案書・報告書(PDF)を、**部署ごとの権限つき**で検索し、**出典つき**で要約するWebアプリです。
案件7(模擬案件)として、配布された4つのサンプル文書(戦略・人事・IT・営業)で、取り込み・検索・権限制御・精度測定・監査ログまでを作りました。

> 本番想定は5,000文書ですが、これは学習用に4文書へ縮小した模擬案件です。大規模運用に必要な部分(自動同期など)は「できていないこと」に書いています。

## 動いているもの

公開URL: https://case7-rag-knowledge.vercel.app (ログインには、部署を登録したテスト用ユーザーが必要です。作り方は下の「取り込み手順」)

| 画面 | 内容 |
|---|---|
| `/` | ログインして質問する。答えと、探した章(出典)が出る。**見られるのは、自分の部署の文書だけ** |
| `/admin` | PDFを取り込む(合言葉が必要)。章ごとに切り分けて、数値にして保存する |
| `/eval` | テスト質問12問で、Recall@5・「該当なし」・部署の制限を確かめる |

## 仕組み

```
PDF → 章ごとに切る → 数値にする(OpenAI Embedding) → Supabase(pgvector)に保存
質問 → 数値にする → ログインした人の権限で、近い章を5つ探す(RLS) → 監査ログを保存 → Claude が出典つきで要約
```

- 使っているもの: Next.js 16 / TypeScript / Supabase(Postgres + pgvector + Auth)/ OpenAI(text-embedding-3-small, 1536次元)/ Claude / Vercel
- **質問の検索は、ログインした人の権限で実行**する。管理用の鍵(service_role)は使わない。だから、データベース側の部署の制限(RLS)が、ベクトル検索にもそのまま効く。
- 管理用の鍵(service_role)は、「取り込み」「精度の測定」「監査ログの書き込み」だけに使う(サーバー側のみ。ブラウザには渡さない)。

## 取り込み手順

1. Supabase の SQL Editor で `supabase/schema.sql` を実行する(何度実行しても壊れない)。
2. Authentication → Users でユーザーを作り、`supabase/seed-test-users.sql` のように部署を登録する(`kb_user_departments`)。
3. Vercel に環境変数を登録して公開する(下の「環境変数」)。
4. `/admin` を開き、合言葉(`ADMIN_PASSWORD`)を入れ、PDFを選んで「取り込む」。部署は、PDFの1行目の「部署: ○○」から自動で読む。
5. 同じファイル名を取り込み直すと、古いものを置き換える(二重にならない)。途中で失敗したときは、中途半端に残らないように戻す。

**章の切り分け**: 見出し(「1.」「1-1.」「第1章」)で章に分ける。各チャンクの先頭に、文書名と章の見出しを付けて、何の文書の章か分かるようにしている。
課題の見本にあった「100文字以下の章を捨てる」ルールは、サンプルの短い文書では章の大半が消えるため外した(`minBodyLength` で変えられる)。

## 部署の制限(RLS)の設計

| 表 | 内容 | 一般ユーザーの権限 |
|---|---|---|
| `kb_documents` | 文書(ファイル名・タイトル・部署・機密度 など) | 自分の部署の文書だけ**読める** |
| `kb_chunks` | 章ごとのチャンクと、数値(embedding) | 見てよい文書のチャンクだけ**読める** |
| `kb_user_departments` | 誰がどの部署か | 自分の分だけ**読める** |
| `query_logs` | 監査ログ | **何もできない**(読めない・書けない) |

- 書き込みのポリシーは作らず、一般ユーザーは取り込み・変更・削除ができない(`revoke` + RLS)。
- 検索の関数 `kb_match_chunks` は `security invoker`。呼んだ人の権限で動くので、他部署の章は、近くても返らない。
- `supabase/schema.sql` を、PGlite(Postgres + pgvector)で実際に実行して、部署の制限・書き込みの拒否・ベクトル検索への効き方を、自動テストで確かめている。

## 監査ログ

「誰が・いつ・何を質問して・どのチャンクが参照されたか」を、`query_logs` に残す。

| 列 | 内容 |
|---|---|
| `user_id` | ログインの確認で分かったユーザー(ブラウザから送られた値は使わない)。ユーザーを消しても、ログは残る |
| `user_department` | 質問したときの所属部署 |
| `query` | 質問の文 |
| `retrieved_chunk_ids` | 参照したチャンクのID |
| `channel` | `web` / `slack` |
| `created_at` | 質問した時刻 |

- 検索のあと、**回答を作る前**にログを保存する。**保存できなければ、回答は返さない**(ログに残らない回答を出さないため)。
- 一般ユーザーは、自分のログも含めて、読むことも書くこともできない(盗み見・書き換えの防止)。

## ガバナンス手順(機密文書の扱い)

### ① 機密扱いにしたい(見られる部署を絞る)

Supabase の SQL Editor で、文書の部署を、限られた部署(例: `管理`)に変える。

```sql
update kb_documents set department = '管理' where filename = '対象のファイル名.pdf';
```

→ `管理` の部署に入っている人だけが、検索できる。変更は、すぐに検索に反映される。

### ② 完全に削除したい

1. 文書を削除する(チャンクも一緒に消える)。

   ```sql
   delete from kb_documents where filename = '対象のファイル名.pdf';
   ```

2. 元のファイル(共有フォルダやSharePoint)からも削除する。
3. 監査ログの `retrieved_chunk_ids` から、削除したチャンクのIDを消す(redact)。**削除する前に、IDを控えておく**。

   ```sql
   select id from kb_chunks where document_id = (select id from kb_documents where filename = '対象のファイル名.pdf');
   -- 控えたIDごとに:
   update query_logs
      set retrieved_chunk_ids = array_remove(retrieved_chunk_ids, '<チャンクのID>'::uuid)
    where '<チャンクのID>'::uuid = any(retrieved_chunk_ids);
   ```

### ③ 監査ログを確認する

```sql
-- 誰が・いつ・何を質問したか(新しい順)
select created_at, user_department, query, channel from query_logs order by created_at desc limit 100;

-- 月次集計(部署ごとの件数)
select coalesce(user_department, '(不明)') as 部署, count(*) as 件数
  from query_logs
 where created_at >= date_trunc('month', now())
 group by 1 order by 2 desc;
```

## 環境変数

`.env.example` を参照。Vercel の Environment Variables に登録して、再公開(Redeploy)する。

| 名前 | 内容 | ブラウザに渡る? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseのURL(`https://xxxx.supabase.co`。末尾に `/rest/v1/` などを付けない) | はい |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 公開用のキー(anon / publishable) | はい |
| `SUPABASE_SERVICE_ROLE_KEY` | 管理用の鍵(service_role / secret) | **いいえ(絶対に NEXT_PUBLIC_ を付けない)** |
| `OPENAI_API_KEY` | Embedding用 | いいえ |
| `ANTHROPIC_API_KEY` | 要約用(Claude) | いいえ |
| `ADMIN_PASSWORD` | 取り込み・精度測定の画面の合言葉 | いいえ |
| `ANTHROPIC_MODEL` | (任意)Claude のモデル名。既定は `claude-sonnet-4-6` | いいえ |

## 精度の結果(`/eval`、テスト質問12問)

| 項目 | 結果 |
|---|---|
| Recall@5(検索の質問9問) | **100%(9 / 9問)** 合格ライン80%以上 |
| 「該当なし」の質問 | 2 / 2問で、でっち上げずに「該当なし」と答えた |
| 部署の制限 | 効いている(人事のユーザーには、人事の文書だけ) |

## テスト

```
npm install
npm test
```

- 章の切り分け(実際のサンプルPDFで)
- 取り込み(偽のデータベースと偽のEmbeddingで。失敗したときに、中途半端に残らないこと)
- 部署の制限と監査ログ(PGlite で schema.sql を実際に実行して確認)
- Embedding・プロンプト・精度の計算・合言葉・監査ログの書き込み

## できていないこと(Phase 2)

- **Slackボット**: 3秒以内に「考え中」と返し、あとから答えを投稿する仕組み(非同期処理)が必要。未実装。
- **SharePoint の月次同期(Cron)**: 未実装。今は、管理画面から手動で取り込む。
- **PowerPoint / Word**: 未対応(PDFのみ)。
- **役職ごとの制御、月次レポートの自動送信**: 未実装(集計のSQLは上にある)。
- 文書が増えたら、検索の索引(hnsw)と、部署で絞るときの相性(絞ると件数が減る問題)を、実データで確認する。

## 本番に近づけるときの注意

- **Embedding を外部に送ってよいか**: 本番の文書を外部のAPI(OpenAIなど)に送る前に、クライアントの情シスの許可を取る。許可されたサービス(AWS Bedrock など)に切り替える場合は、`src/lib/embed.ts` を差し替え、SQL の `vector(1536)` の次元数も合わせる。
