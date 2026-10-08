import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { extractPages } from "../src/lib/ingestion/pdf";
import { chunkPages } from "../src/lib/ingestion/chunker";

const dir = process.argv[2] ?? "tests/fixtures";
for (const f of readdirSync(dir).filter((n) => n.endsWith(".pdf")).sort()) {
  const pages = await extractPages(readFileSync(join(dir, f)));
  const { meta, chunks } = chunkPages(pages);
  console.log(`\n■ ${f}  (${pages.length}ページ)`);
  console.log(`  タイトル: ${meta.title} / 部署: ${meta.department} / 客先: ${meta.client} / 作成: ${meta.createdYear} / 機密度: ${meta.confidentiality}`);
  for (const c of chunks) {
    console.log(`  - [p.${c.pageStart}-${c.pageEnd}] ${c.sectionTitle}  (${c.content.length}文字)`);
  }
}
