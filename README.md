# 分層工作紙生成：本機工作紙工具

上載工作紙、確認學習目標、選擇程度，再檢查及下載。介面預設繁體中文，可切換英文。你可以處理小一至小六的數學、中文及英文工作紙；英文練習保留英文內容。

## 開啟

雙擊 `start.command`，或在這個資料夾執行 `./start.command`。然後開啟 [本機應用程式](http://127.0.0.1:4173/)。保留終端機視窗；按 Ctrl+C 結束服務。

不要使用 `python -m http.server` 或直接開啟 HTML，這些方式不會啟動文件處理及 Qwen 接駁。這部 Mac 已備有需要的執行環境；另一部電腦需要 Python 3.10+、`requirements.txt` 的套件及 Poppler（`pdfinfo`、`pdftoppm`）。HEIC 使用 macOS 的 `sips`。

這個公開版本是本機工具：文件讀取、Word 匯出及 Qwen 接駁由 `serve.py` 提供。GitHub Pages 只能顯示靜態介面，不能代替這個本機服務；請勿把 API Key 放入程式碼或公開檔案。

GitHub Pages 靜態示範：[分層工作紙生成](https://cfsthk.github.io/layered-worksheet-generator/)。示範工作紙可在瀏覽器中預覽；上載、Qwen 連線及 Word 匯出請依照上面的本機步驟執行。

## 第一次使用

1. 按「連接 Qwen」，輸入香港區域的 API Key。Workspace ID 選填。「測試文字模型連線」會作一次小額請求，只驗證文字模型。
2. 上載 PDF、DOCX、JPG、PNG 或 HEIC。本機先擷取及預覽；按「讓 Qwen 讀取工作紙」才把內容傳送至 Qwen。
3. 確認年級、科目及目標。用「檢查內容」修正誤讀。「其他選項」可填主題、摘要、原稿程度及選擇延伸題。
4. 選擇程度。共有 7 級，原稿預設第 4 級，第 7 級最難；初選 1、4、7。「微調」提供可編輯的程度設定。
5. 檢查各版本及答案，可修改文字、重做單題或對照原稿。勾選已檢查後，下載 Word 或透過列印視窗儲存 PDF。

沒有金鑰時，按「先試試示範工作紙」。示範使用預先編寫的小四分數題目，不會呼叫 Qwen，也能匯出 Word。

## 工作紙與匯出

主要題目沿用原稿的次序、題型及確認的目標。較低程度加入解釋和步驟；較高程度增加同一目標內的計算或思考。延伸目標只放在另外標示的延伸題。

原稿可以沒有答案。Qwen 在製作版本時補寫答案及解說，老師仍須核對。程式檢查題目 ID、數量、順序及目標文字，並用精確算術核對指定格式的兩分數比較，不能驗證所有內容的正確性。

Word 支援目前工作紙、答案，或兩者一起下載。A4 模板使用黑色標題、可編輯文字及原生 Word 分數公式；分數條圖是內嵌圖片。修改題目後須重新檢查，匯出時會移除舊圖解、提示及解說。請同步修改答案。

上限：每檔 15 MB；PDF 1–8 頁；Word 最多 8 張可讀內嵌圖片；擷取文字 60,000 字；整理後 60 題。Word 浮動圖形、自動編號及複雜表格可能需要修正，遇到遺漏可先另存 PDF。程式不保留原稿排版。

## Qwen、區域及費用

文字和視覺理解共用一個金鑰。在「模型與連線設定」可使用自動選擇，或指定 Model ID。

- 文字：`qwen3.7-plus`，後備 `qwen3.6-plus`、`qwen-plus`。
- 視覺：`qwen3-vl-plus`，後備 `qwen3-vl-plus-2025-12-19`。
- 預設端點：`https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1`。
- Workspace 端點：`https://{WorkspaceId}.cn-hongkong.maas.aliyuncs.com/compatible-mode/v1`。

程式只使用官方香港端點，不接受自訂主機或重新導向，也不轉到北京或新加坡。推理範圍及權限由你的 Workspace 決定，請在阿里雲確認設定。[官方端點](https://www.alibabacloud.com/help/en/model-studio/base-url)、[區域及推理範圍](https://www.alibabacloud.com/help/en/model-studio/regions)。

自動切換適用於模型不支援、限流及明確服務錯誤。金鑰錯誤、不完整回覆或不確定是否已收費的網絡逾時會停止該請求。最多同時處理 3 份，部分失敗時保留完成的版本並標示失敗級別。

每次請求前會估算費用，包括可能的後備模型；超過提示門檻便先確認。未知價格的自訂模型須逐次確認。估算不是收費保證或硬性上限。取消可停止後續請求，已送出的請求仍可能計費。價格於 2026-09-06 查核：[模型價格](https://www.alibabacloud.com/help/en/model-studio/model-pricing)。

## 儲存及限制

程式只接受本機連線，不把 API Key 寫入檔案或瀏覽器儲存空間；重新整理後要再輸入。沒有 Keychain 整合。

工作紙庫及非金鑰設定使用該瀏覽器、該網址的 localStorage。清除瀏覽器資料會移除工作紙庫，請下載 Word 留底。上載內容在本機服務記憶體最多保留兩小時；重啟後，尚未完成 Qwen 讀取的檔案須重新上載。Qwen 收到的內容受供應商資料政策約束。

圖片生成、音訊及影片未接駁。官方 Qwen-Image 文件目前沒有列出香港端點，因此此版本不作跨區接駁；數學圖解由本機繪製。[Qwen-Image API](https://www.alibabacloud.com/help/en/model-studio/qwen-image-api)。

課程和難度尚未校準，亦未測得一分鐘完成率。老師須核對生成內容。

## 驗證

21 項後端測試及 41 項瀏覽器檢查通過，包括真實本機上載、費用確認、Word 下載、編輯、儲存、取消及部分失敗。模型回覆使用獨立測試資料，沒有發出 Qwen 請求。開發用 QA 腳本及頁面圖不包含在應用程式發佈檔案內。

尚未使用真實 API Key 驗證帳戶連線、模型權限、品質及速度。請在應用程式輸入金鑰作下一步測試，不必貼到對話中。介面備份在 `work/design-v1-backup` 和 `work/design-v2-backup`。
