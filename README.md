# 分層工作紙生成

上載工作紙、確認學習目標、選擇程度，再檢查及下載。介面預設繁體中文，可切換英文。你可以處理小一至小六的數學、中文及英文工作紙；英文練習保留英文內容。

## 開啟

直接開啟 [分層工作紙生成](https://cfsthk.github.io/layered-worksheet-generator/)。網頁版支援上載、Qwen 讀取、分層生成及 Word 下載，不需要啟動本機服務。

亦可雙擊 `start.command`，或執行 `./start.command` 開啟 [本機版](http://127.0.0.1:4173/)。本機版使用 Python 3.10+、`requirements.txt` 套件及 Poppler（`pdfinfo`、`pdftoppm`）；macOS 以 `textutil` 轉換舊版 DOC，以 `sips` 轉換 HEIC。

網頁版在瀏覽器準備文件，直接以使用者的金鑰連接官方國際 Qwen 端點。PDF（包括掃描件）逐頁轉成圖片；JPG、JPEG、PNG 直接作為圖片；DOC、DOCX 擷取文字及可讀內嵌圖片，再由 Qwen 整理題目與目標。有圖片時使用所選視覺模型，純文字文件使用所選文字模型。這符合 Qwen 的[多圖片輸入介面](https://www.alibabacloud.com/help/en/model-studio/vision)。

瀏覽器文件工具隨網站發佈，沒有第三方文件轉換服務。API Key 只用於當次模型請求，不包含在程式碼、GitHub 或瀏覽器儲存空間中。網頁版 HEIC 視乎瀏覽器支援，建議使用 JPG／PNG。

## 第一次使用

1. 按「連接 Qwen」，輸入國際區域的 Qwen API Key。Workspace ID 選填。「測試文字模型連線」會作一次小額請求，只驗證文字模型。
2. 上載 DOC、DOCX、PDF、JPG、JPEG 或 PNG。網頁版準備好文件後自動讓 Qwen 讀取；尚未輸入金鑰會先開啟設定，填寫並按「完成」後接續讀取。本機版仍需按「讓 Qwen 讀取工作紙」。
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
- 預設端點：`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`。
- Workspace 端點：`https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`。

程式只使用官方國際端點，不接受自訂主機或重新導向，也不轉到北京或香港。國際 DashScope 網域對應新加坡區域；API Key 必須在同一區域建立。推理範圍及權限由你的 Workspace 決定，請在阿里雲確認設定。[官方端點](https://www.alibabacloud.com/help/en/model-studio/base-url)、[區域及推理範圍](https://www.alibabacloud.com/help/en/model-studio/regions)。

自動切換適用於模型不支援、限流及明確服務錯誤。金鑰錯誤、不完整回覆或不確定是否已收費的網絡逾時會停止該請求。最多同時處理 3 份，部分失敗時保留完成的版本並標示失敗級別。

每次請求前會估算費用，包括可能的後備模型；超過提示門檻便先確認。未知價格的自訂模型須逐次確認。估算不是收費保證或硬性上限。取消可停止後續請求，已送出的請求仍可能計費。價格於 2026-09-06 查核：[模型價格](https://www.alibabacloud.com/help/en/model-studio/model-pricing)。

## 儲存及限制

網頁版的金鑰只在本次分頁記憶體內；重新整理後要再輸入。本機 Python 服務仍只接受本機連線。兩種模式都不把 API Key 寫入檔案或瀏覽器儲存空間。

工作紙庫及非金鑰設定使用該瀏覽器、該網址的 localStorage。清除瀏覽器資料會移除工作紙庫，請下載 Word 留底。網頁版原稿在分頁記憶體內，上載另一份原稿會取代上一份；重新整理後未讀取的原稿須重新上載。本機服務最多保留原稿兩小時。Qwen 收到的內容受供應商資料政策約束。

圖片生成、音訊及影片未接駁；數學圖解由本機繪製。[Qwen-Image API](https://www.alibabacloud.com/help/en/model-studio/qwen-image-api)。

課程和難度尚未校準，亦未測得一分鐘完成率。老師須核對生成內容。

## 驗證

`npm test` 驗證網頁版的資料合約、目標保留、精確分數核對、國際端點、切換、取消及錯誤處理。另已在 Chrome 驗證六種真實檔案格式、PDF 逐頁圖片、輸入金鑰後接續讀取、生成及 Word 下載；模型回覆使用測試資料。

尚未使用使用者的真實 API Key 驗證帳戶模型權限、品質及速度。請在應用程式輸入自己的國際區域金鑰。

## 網頁版開發及發佈

執行 `npm ci`、`npm test`、`npm run build`。`dist` 是可部署的網站；GitHub Actions 在推送 main 後自動建立並發佈至 GitHub Pages。瀏覽器模組在 `browser/`，Python 本機服務保留於根目錄。依賴版本鎖定於 `package-lock.json`。
