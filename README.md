# 智能勤務表（duyty-roster）

消防分隊每日勤務表的自動編排工具。目標：讀進當天的排班區，已排好的格子不動，一鍵補上值班、救護、休息的空缺，並符合所有限制式。

規則清單見雲端「勤務表自動編排_規劃備忘」Excel 檔（C01～C20）。

## 目前進度
- `prototype/`：第 2 步的 Python 原型與 9～10 月回測報告（`prototype/回測報告.md`）。
- 第 3 步（網頁）尚未開始。

## 執行原型
```
pip install -r requirements.txt
cd prototype
python run.py 9月.xlsm 10月.xlsm      # 每天的回測明細
python verify.py 9月.xlsm 10月.xlsm   # 統計程式補的格子有沒有違規
```

## 注意
勤務表 xlsm 檔含同仁姓名，**不要上傳到這個 repository**（`.gitignore` 已排除 `.xlsm`、`.xlsx`）。
