# 智能勤務表（duty-roster）

消防分隊每日勤務表的自動編排工具。讀進當天的排班區，已排好的格子不動，一鍵補上值班、救護、休息的空缺，並符合所有限制式。

規則清單見雲端「勤務表自動編排_規劃備忘」Excel 檔（C01～C20）。

## 網頁版（`docs/`）
用瀏覽器打開就能用，排班計算在自己的電腦上進行，勤務表檔案不會上傳。

使用方式：
1. 在 Excel 照平常按「編排勤務日期」，預排好外勤後存檔。
2. 打開網頁，選擇這個 xlsm 檔。
3. 按「一鍵補空缺」，確認結果與檢查訊息。
4. 按「複製結果」，回到 Excel 排班區點 B3，按 Ctrl+V 貼上。

網頁由 GitHub Pages 從 `main` 分支的 `docs/` 資料夾發布。

## 開發
- `docs/lib/roster.js`：讀 xlsm（月班表、存檔區、救護訓練、排班區）
- `docs/lib/solver.js`：補空缺的模型（HiGHS 整數規劃）
- `docs/lib/check.js`：檢查限制式
- `tools/backtest.mjs`：用歷史資料回測

```
npm install
npm run backtest -- 9月.xlsm 10月.xlsm
```

`prototype/` 是第一版 Python 原型（OR-Tools），結果與網頁版相同，留作參考。

## 注意
勤務表 xlsm 檔含同仁姓名，**不要上傳到這個 repository**（`.gitignore` 已排除 `.xlsm`、`.xlsx`）。
