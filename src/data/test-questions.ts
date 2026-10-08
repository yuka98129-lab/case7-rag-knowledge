// 課題で配られた case7-test-questions.csv を、そのまま取り込んだもの(12問)
export type TestQuestion = { no: number; question: string; expected: string; basis: string; kind: string };

export const TEST_QUESTIONS: TestQuestion[] = [
  {
    "no": 1,
    "question": "金融業界向けのDX提案で、ROI試算を含むものはどれですか？",
    "expected": "case7-doc1-strategy-dx-bank",
    "basis": "窓口時間50%削減で年1.2億円削減のROI試算あり",
    "kind": "該当あり(戦略)"
  },
  {
    "no": 2,
    "question": "窓口業務のデジタル化で人件費はどれくらい削減できる見込みですか？",
    "expected": "case7-doc1-strategy-dx-bank",
    "basis": "窓口handling18分→9分で年約1.2億円",
    "kind": "該当あり(戦略)"
  },
  {
    "no": 3,
    "question": "従業員エンゲージメントが最も低下する層はどこですか？",
    "expected": "case7-doc2-hr-engagement-report",
    "basis": "入社3〜5年目の中堅層",
    "kind": "該当あり(人事)"
  },
  {
    "no": 4,
    "question": "キャリア成長に関する課題への提言は何ですか？",
    "expected": "case7-doc2-hr-engagement-report",
    "basis": "キャリアパス可視化・1on1制度化・研修の業務時間内組込み",
    "kind": "該当あり(人事)"
  },
  {
    "no": 5,
    "question": "クラウド移行でインフラ運用コストはどれだけ下がりましたか？",
    "expected": "case7-doc3-it-cloud-migration",
    "basis": "月480万円→310万円(35%削減)",
    "kind": "該当あり(IT)"
  },
  {
    "no": 6,
    "question": "基幹システム移行で使われたデータベースは何ですか？",
    "expected": "case7-doc3-it-cloud-migration",
    "basis": "Aurora PostgreSQL",
    "kind": "該当あり(IT)"
  },
  {
    "no": 7,
    "question": "小売チェーン向けの会員アプリ活性化施策は何ですか？",
    "expected": "case7-doc4-sales-proposal-retail",
    "basis": "パーソナライズドクーポン・レコメンド・再来店キャンペーン",
    "kind": "該当あり(営業)"
  },
  {
    "no": 8,
    "question": "客単価向上の数値目標を教えてください。",
    "expected": "case7-doc4-sales-proposal-retail",
    "basis": "客単価5%向上・再来店率22%→30%",
    "kind": "該当あり(営業)"
  },
  {
    "no": 9,
    "question": "コスト削減効果が記載された案件をすべて挙げてください。",
    "expected": "case7-doc1 / case7-doc3 / case7-doc4",
    "basis": "複数文書にコスト削減効果あり(横断検索)",
    "kind": "該当あり(複数文書)"
  },
  {
    "no": 10,
    "question": "医療業界向けの提案書はありますか？",
    "expected": "（記載なし）",
    "basis": "医療業界の文書は存在しない",
    "kind": "該当なし(ハルシネーション検証)"
  },
  {
    "no": 11,
    "question": "新型コロナ対策の提案内容を教えてください。",
    "expected": "（記載なし）",
    "basis": "該当文書なし",
    "kind": "該当なし(ハルシネーション検証)"
  },
  {
    "no": 12,
    "question": "人事部のメンバーが、IT部のクラウド移行報告書を検索したら見えますか？",
    "expected": "（RLS検証）",
    "basis": "部署別アクセス制御により他部署文書は閲覧不可であるべき",
    "kind": "RLS権限検証"
  }
];
