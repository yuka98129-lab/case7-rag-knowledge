// PDF から取り出した文字には、見た目は同じでも、コードが違う「部首の文字」が混ざることがある。
// 例: 「成長」の「長」が U+2ED1(⻑)になっていると、「成長」で検索しても見つからない。
// 見つかったものを、ふつうの漢字に直す。

// 「CJK部首補助」の文字のうち、実際に出てきたもの(増えたら足す)
const RADICAL_SUPPLEMENT: Record<string, string> = {
  "⻑": "長", // ⻑
};

export function cleanPdfText(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (RADICAL_SUPPLEMENT[ch]) out += RADICAL_SUPPLEMENT[ch];
    else if (code >= 0x2f00 && code <= 0x2fdf) out += ch.normalize("NFKC"); // 康熙部首は、正規化でふつうの漢字になる
    else out += ch;
  }
  return out;
}
