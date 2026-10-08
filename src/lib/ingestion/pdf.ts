// PDF からページごとの文字列を取り出す。
// pdf-parse 1.1.1 は、index.js を読み込むとデバッグ用のコードが動くため、lib 側を直接読み込む。
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { cleanPdfText } from "./clean";

type TextItem = { str: string; transform: number[] };

/** 1ページ分のテキストを、行ごとに組み立てる(同じ高さの文字を同じ行にまとめる) */
async function renderPage(pageData: { getTextContent: (o: object) => Promise<{ items: TextItem[] }> }) {
  const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  let lastY: number | undefined;
  let text = "";
  for (const item of content.items) {
    const y = item.transform[5];
    if (lastY === undefined || Math.abs(lastY - y) < 1) text += item.str;
    else text += "\n" + item.str;
    lastY = y;
  }
  return text;
}

export async function extractPages(buffer: Buffer): Promise<string[]> {
  const pages: string[] = [];
  await pdfParse(buffer, {
    pagerender: async (pageData: Parameters<typeof renderPage>[0]) => {
      const t = cleanPdfText(await renderPage(pageData));
      pages.push(t);
      return t;
    },
  });
  return pages;
}
