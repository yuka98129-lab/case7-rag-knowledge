// セクション(章)単位のチャンキング。PDFのページごとの文字列を受け取り、章ごとに切り分ける。
// ここは「文字列を切るだけ」の純粋な関数にして、PDFの読み込みとは分けている(テストしやすくするため)。

export type DocMeta = {
  /** 文書のタイトル(1行目) */
  title: string;
  /** 部署(戦略/業務/IT/人事/営業/管理)。メタ情報の行から読み取る */
  department: string | null;
  client: string | null;
  createdYear: string | null;
  confidentiality: string | null;
};

export type Chunk = {
  sectionTitle: string;
  /** 検索と要約に使う本文。文書名と章の見出しを先頭に付ける(章だけだと何の文書か分からなくなるため) */
  content: string;
  pageStart: number;
  pageEnd: number;
};

export type ChunkResult = { meta: DocMeta; chunks: Chunk[] };

export type ChunkOptions = {
  /** これより短い本文の章は捨てる。サンプルが短いため、既定は 0(捨てない)。本番の長い文書では 100 前後を検討 */
  minBodyLength?: number;
};

// 見出しの目印: 「1.」「1-1.」「第1章」で始まる行
const HEADING = /^(\d+-\d+\.|\d+\.|第\d+章)\s*\S/;

// 取り込み用サンプルであることを示す注意書きの行(本文に含めない)
const NOTICE = /サンプル文書です/;

const META_LABELS: Record<string, keyof Omit<DocMeta, "title">> = {
  部署: "department",
  客先: "client",
  作成: "createdYear",
  機密度: "confidentiality",
};

/** 「部署: 戦略 / 客先: 地方銀行A / 作成: 2024年 / 機密度: 社外秘」の行を読む */
export function parseMetaLine(line: string): Omit<DocMeta, "title"> {
  const meta = { department: null, client: null, createdYear: null, confidentiality: null } as Omit<
    DocMeta,
    "title"
  >;
  for (const part of line.split("/")) {
    const m = part.trim().match(/^(部署|客先|作成|機密度)\s*[:：]\s*(.+)$/);
    if (m) meta[META_LABELS[m[1]]] = m[2].trim();
  }
  return meta;
}

const isMetaLine = (line: string) => /^部署\s*[:：]/.test(line.trim());

export function chunkPages(pages: string[], options: ChunkOptions = {}): ChunkResult {
  const minBodyLength = options.minBodyLength ?? 0;

  // 全ページの行を、ページ番号つきで並べる
  const lines: { text: string; page: number }[] = [];
  pages.forEach((pageText, i) => {
    for (const raw of pageText.split("\n")) {
      const text = raw.trim();
      if (text) lines.push({ text, page: i + 1 });
    }
  });

  const title = lines[0]?.text ?? "";
  let metaFields: Omit<DocMeta, "title"> = {
    department: null,
    client: null,
    createdYear: null,
    confidentiality: null,
  };

  type Draft = { heading: string; body: string[]; pageStart: number; pageEnd: number };
  const drafts: Draft[] = [];
  let current: Draft | null = null;

  for (let i = 1; i < lines.length; i++) {
    const { text, page } = lines[i];
    if (isMetaLine(text) && !current) {
      metaFields = parseMetaLine(text);
      continue;
    }
    if (NOTICE.test(text) && !current) continue;

    if (HEADING.test(text)) {
      current = { heading: text, body: [], pageStart: page, pageEnd: page };
      drafts.push(current);
    } else if (current) {
      current.body.push(text);
      current.pageEnd = page;
    }
  }

  const meta: DocMeta = { title, ...metaFields };

  const chunks: Chunk[] = drafts
    .map((d) => ({ ...d, bodyText: d.body.join("\n") }))
    .filter((d) => d.bodyText.length > 0 && d.bodyText.length >= minBodyLength)
    .map((d) => ({
      sectionTitle: d.heading,
      content: `${title}\n${d.heading}\n${d.bodyText}`,
      pageStart: d.pageStart,
      pageEnd: d.pageEnd,
    }));

  return { meta, chunks };
}
