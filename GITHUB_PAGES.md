# Jacky 貸款利息管理系統

## GitHub Pages 發布

1. 將此專案推送到 GitHub，預設分支使用 `main`。
2. 在儲存庫的 **Settings → Pages → Build and deployment**，將來源選為 **GitHub Actions**。
3. 專案已包含 `.github/workflows/deploy-pages.yml`，往後每次推送到 `main` 都會自動建置與發布。

網站採相對路徑，可發布在使用者頁面或任何專案子路徑。若需手動產生成品，可執行 `npm run build:github`，輸出位於 `github-pages/`。

## Firebase 雲端同步

1. 在 Firebase Console 建立專案與 Web App。
2. 啟用 Authentication 的 Google 登入方式。
3. 建立 Cloud Firestore，並套用根目錄的 `firestore.rules`。
4. 在 Authentication 的「已授權網域」加入 GitHub Pages 網域。
5. 在網站的「設定與備份」貼上 Firebase Web App 設定 JSON，登入 Google 帳號。

Firebase Web App 設定不是密碼；真正的資料保護由 Google 登入與 Firestore 安全規則負責。
