# LoanFlow 貸款利息管理系統

專為循環貸款設計的繁體中文管理介面，預設總額度為 NT$6,920,000、年利率為 3.56%。

## 功能

- 自動編號與記錄每筆領款
- 支援同一筆貸款分次償還本金
- 依領款、還款日期逐日切分本金並計息
- 每月底自動結算當月利息，顯示次月 5 日應繳日
- 歷史資料異動後自動重算各月利息
- JSON 備份／還原與 CSV 匯出
- 本機離線儲存；可選用 Firebase + Google 登入進行跨裝置同步
- 日期固定按台灣時區（Asia/Taipei）判定，避免雲端試算表常見的日期偏移

## 本機開發

```bash
npm install
npm run dev
```

## GitHub Pages

```bash
npm run build:github
```

靜態成品會產生在 `github-pages/`。完整發布與 Firebase 設定步驟請見 [GITHUB_PAGES.md](./GITHUB_PAGES.md)。

## 利息計算慣例

預設採「領款日不計息、翌日起息；還款日仍計息」並以 365 日為年基準。利率、年基準與繳款日都可在網站設定中調整。
