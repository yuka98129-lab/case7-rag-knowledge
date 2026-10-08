import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chunkPages, parseMetaLine } from "../src/lib/ingestion/chunker";
import { extractPages } from "../src/lib/ingestion/pdf";

const load = async (name: string) => extractPages(readFileSync(`tests/fixtures/${name}`));

const FILES = [
  ["case7-doc1-strategy-dx-bank.pdf", "戦略"],
  ["case7-doc2-hr-engagement-report.pdf", "人事"],
  ["case7-doc3-it-cloud-migration.pdf", "IT"],
  ["case7-doc4-sales-proposal-retail.pdf", "営業"],
] as const;

describe("parseMetaLine", () => {
  it("部署・客先・作成年・機密度を読み取る", () => {
    expect(parseMetaLine("部署: 戦略 / 客先: 地方銀行A / 作成: 2024年 / 機密度: 社外秘")).toEqual({
      department: "戦略",
      client: "地方銀行A",
      createdYear: "2024年",
      confidentiality: "社外秘",
    });
  });
  it("見つからない項目は null", () => {
    expect(parseMetaLine("部署: IT").client).toBeNull();
  });
});

describe("サンプルPDF 4つの切り分け", () => {
  it.each(FILES)("%s は、部署=%s で、5つの章に切れる", async (file, dept) => {
    const { meta, chunks } = chunkPages(await load(file));
    expect(meta.department).toBe(dept);
    expect(chunks).toHaveLength(5);
    expect(chunks.map((c) => c.sectionTitle.match(/^\d+/)?.[0])).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("注意書き(サンプル文書です)と、メタ情報の行は、本文に入らない", async () => {
    for (const [file] of FILES) {
      const { chunks } = chunkPages(await load(file));
      for (const c of chunks) {
        expect(c.content).not.toContain("サンプル文書です");
        expect(c.content).not.toContain("機密度:");
      }
    }
  });

  it("各チャンクの先頭に、文書名と章の見出しが付く", async () => {
    const { chunks } = chunkPages(await load("case7-doc1-strategy-dx-bank.pdf"));
    expect(chunks[3].content.startsWith("銀行A向け DX 推進提案書（サマリ版）\n4. ROI 試算\n")).toBe(true);
    expect(chunks[3].content).toContain("1.2億円");
  });

  it("ページ番号が入る", async () => {
    const { chunks } = chunkPages(await load("case7-doc2-hr-engagement-report.pdf"));
    expect(chunks.every((c) => c.pageStart === 1 && c.pageEnd === 1)).toBe(true);
  });
});

describe("課題の見本コードの「100文字以下は捨てる」ルール", () => {
  it("サンプルに当てはめると、20章のほとんどが捨てられてしまう(だから既定では捨てない)", async () => {
    let total = 0;
    let kept = 0;
    for (const [file] of FILES) {
      const pages = await load(file);
      total += chunkPages(pages).chunks.length;
      // 見本は「本文」だけで判定する。見出しと文書名を足す前の長さに近づけるため、少し大きめの 100 を使う
      kept += chunkPages(pages, { minBodyLength: 100 }).chunks.length;
    }
    expect(total).toBe(20);
    expect(kept).toBeLessThan(total / 2);
  });
});

describe("複数ページ・見出しなどの形", () => {
  it("章が次のページにまたがると、ページ範囲が広がる", () => {
    const pages = [
      "提案書\n部署: IT\n1. 概要\nはじまり",
      "つづき\n2. 次の章\n本文",
    ];
    const { chunks } = chunkPages(pages);
    expect(chunks[0]).toMatchObject({ sectionTitle: "1. 概要", pageStart: 1, pageEnd: 2 });
    expect(chunks[1]).toMatchObject({ sectionTitle: "2. 次の章", pageStart: 2, pageEnd: 2 });
  });

  it("「第1章」「1-1.」も見出しとして扱う", () => {
    const { chunks } = chunkPages(["題名\n第1章 はじめに\n本文A\n1-1. 小見出し\n本文B"]);
    expect(chunks.map((c) => c.sectionTitle)).toEqual(["第1章 はじめに", "1-1. 小見出し"]);
  });

  it("見出しがない文書は、チャンクが0件になる(取り込み側でエラーにする)", () => {
    expect(chunkPages(["題名\nただの文章"]).chunks).toEqual([]);
  });

  it("本文が空の章は捨てる", () => {
    const { chunks } = chunkPages(["題名\n1. 空の章\n2. 本文あり\nあります"]);
    expect(chunks.map((c) => c.sectionTitle)).toEqual(["2. 本文あり"]);
  });
});

import { cleanPdfText } from "../src/lib/ingestion/clean";

describe("cleanPdfText(PDFから出てくる部首の文字を、ふつうの漢字に直す)", () => {
  it("U+2ED1 の「⻑」を「長」にする", () => {
    expect(cleanPdfText("成⻑の実感")).toBe("成長の実感");
  });
  it("ふつうの文章は、そのまま", () => {
    expect(cleanPdfText("窓口18分→9分（50%削減）")).toBe("窓口18分→9分（50%削減）");
  });
  it("サンプルPDFに、部首の文字が残っていない", async () => {
    for (const [file] of FILES) {
      const text = (await load(file)).join("\n");
      expect(/[⺀-⿟]/.test(text)).toBe(false);
    }
  });
});
