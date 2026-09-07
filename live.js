"use strict";
// Integration layer: the original visual demo remains available without a key.
const browserMode = location.protocol !== 'file:' && !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
let browserService;
const live = { available: browserMode, pendingRead: false, document: null, source: null, busy: false, job: null,
  stopped: false, error: "", controller: null, connected: false };
const subjectText = s => ({ maths: "數學", chinese: "中文", english: "英文" }[s] || "數學");

function copyLabel(selector, zh, en) {
  const el = $(selector); if (!el) return;
  el.dataset.zh = zh; el.dataset.en = en; el.textContent = t(zh, en);
}
function installLiveUI() {
  $(".metadata-inline > span:last-child").outerHTML = `<label><select id="subject-select" aria-label="Subject"><option value="maths" data-zh="數學" data-en="Maths">數學</option><option value="chinese" data-zh="中文" data-en="Chinese">中文</option><option value="english" data-zh="英文" data-en="English">英文</option></select></label><span data-zh="繁體中文介面" data-en="Traditional Chinese content">繁體中文介面</span>`;
  $(".file-line").insertAdjacentHTML("beforeend", `<button type="button" class="quiet" id="edit-source-button" data-action="edit-source" hidden data-zh="檢查內容" data-en="Check content">檢查內容</button>`);
  $("#import-notice").insertAdjacentHTML("afterend", `<p id="live-notice" class="import-notice live-notice" role="status" hidden></p>`);
  $(".setup-form .options-body").insertAdjacentHTML("beforeend", `<label class="checkbox-row" id="use-qwen-row"><input type="checkbox" id="use-qwen"/><span data-zh="用 Qwen 製作這份示範（需要金鑰）" data-en="Use Qwen on this sample (requires a key)">用 Qwen 製作這份示範（需要金鑰）</span></label>`);
  $("#download-menu").innerHTML = `<button data-action="word" data-zh="Word · 目前版本" data-en="Word · Current document">Word · 目前版本</button><button data-action="word-both" data-zh="Word · 工作紙及答案" data-en="Word · Worksheet and answers">Word · 工作紙及答案</button><button data-action="print" data-zh="PDF · 目前版本" data-en="PDF · Current document">PDF · 目前版本</button>`;
  $(".review-bar").insertAdjacentHTML("afterend", `<p id="generation-notice" class="import-notice generation-notice" role="status" hidden></p>`);
  $("#settings-dialog .dialog-footer").insertAdjacentHTML("beforebegin", `<div class="connection-test"><button class="quiet" data-action="test-connection" data-zh="測試文字模型連線" data-en="Test language connection">測試文字模型連線</button><p id="connection-result" class="field-note" role="status"></p></div>`);
  document.body.insertAdjacentHTML("beforeend", `<dialog id="source-dialog" class="dialog source-dialog"><div class="dialog-heading"><div><p class="eyebrow" data-zh="讀取內容" data-en="EXTRACTED CONTENT">讀取內容</p><h2 data-zh="檢查原稿的題目" data-en="Check the source questions">檢查原稿的題目</h2></div><button class="icon-button" data-close aria-label="Close">${icon("close")}</button></div><p class="dialog-intro" data-zh="可修正讀取錯誤。這些內容會作為各程度版本的依據。" data-en="Correct reading errors here. These questions are the basis for every level.">可修正讀取錯誤。這些內容會作為各程度版本的依據。</p><div id="source-edit-list"></div><div class="dialog-footer"><span class="field-note" data-zh="修改後需要重新製作版本" data-en="Generate again to use your changes">修改後需要重新製作版本</span><button class="primary" data-action="save-source" data-zh="儲存內容" data-en="Save content">儲存內容</button></div></dialog><dialog id="cost-dialog" class="dialog small-dialog"><div class="dialog-heading"><h2 data-zh="確認這次模型用量" data-en="Confirm model usage">確認這次模型用量</h2><button class="icon-button" data-close aria-label="Close">${icon("close")}</button></div><p id="cost-message" class="dialog-intro"></p><p class="field-note" data-zh="估算不是收費保證或硬性上限。請以阿里雲帳單為準。已提交的請求即使取消仍可能計費。" data-en="This estimate is not a billing guarantee or hard cap. Alibaba's bill is authoritative. Submitted requests may still be charged after cancellation.">估算不是收費保證或硬性上限。請以阿里雲帳單為準。已提交的請求即使取消仍可能計費。</p><div class="dialog-footer"><button class="quiet" data-close data-zh="取消" data-en="Cancel">取消</button><button class="primary" data-action="approve-cost" data-zh="確認並繼續" data-en="Confirm and continue">確認並繼續</button></div></dialog>`);
  for (const name of ["source", "cost"]) {
    const dialog = $(`#${name}-dialog`);
    dialog.addEventListener("click", e => { const r = dialog.getBoundingClientRect(); if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dialog.close(); });
  }
}

async function localAPI(path, data, { key = false, binary = false, signal } = {}) {
  if (browserMode) {
    browserService ||= import(new URL('browser/entry.js?v=4.5', document.baseURI).href);
    let service;
    try { service = await browserService; }
    catch { browserService = null; throw new Error(t('文件工具未能載入，請重新整理網頁後再試。', 'Document tools could not load. Refresh the page and retry.')); }
    return service.request(path, data, key ? $('#api-key').value.trim() : '');
  }
  let response;
  try {
    response = await fetch(path, { method: data === undefined ? "GET" : "POST", headers: {
      "X-Seven-Client": "1", ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "X-Qwen-Key": $("#api-key").value.trim() } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data), signal });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(t("本機服務未有啟動。請開啟資料夾內的 start.command。", "The local service is offline. Run start.command in the app folder."));
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const failure = new Error(error.error || t("本機服務未能完成操作。", "The local service could not complete the operation."));
    failure.code = error.code; throw failure;
  }
  return binary ? response.blob() : response.json();
}
function connectionConfig() {
  return { workspace: $("#workspace-id").value.trim(), models: state.models,
    fallback: $("#fallback").checked, cost: Number($("#cost-limit").value) };
}
function requireConnection() {
  if (!live.available) throw new Error(t("請先開啟 start.command，啟動本機服務。", "Run start.command to start the local service."));
  if (!$("#api-key").value.trim()) {
    showDialog("settings"); $("#api-key").focus();
    throw new Error(t("請先在 Qwen 設定輸入此 Workspace 的 API Key，再繼續。", "Enter your workspace Qwen API key in settings, then continue."));
  }
  if (!$("#workspace-id").checkValidity() || !$("#cost-limit").checkValidity()) {
    showDialog("settings"); $("#settings-dialog details").open = true;
    throw new Error(t("請檢查 Workspace 及費用設定。", "Check the workspace and cost settings."));
  }
}
function notice(message) {
  live.error = message || "";
  $("#live-notice").textContent = live.error; $("#live-notice").hidden = !message;
}
function report(error) {
  if (error.name === "AbortError" || error.code === "cancelled") return;
  notice(error.message); toast(error.message);
}
function costApproval(quote) {
  $("#cost-message").textContent = quote.estimatedUsd === null
    ? t(`指定模型的價格未能估算。這次會使用 ${quote.models.join("、")}，共 ${quote.requests} 項操作。是否繼續？`, `Pricing is unknown for the selected model. This uses ${quote.models.join(", ")} for ${quote.requests} operation(s). Continue?`)
    : t(`估算預留約 US$${quote.estimatedUsd.toFixed(3)}，高於你設定的提示門檻。估算已包括可能的模型切換。`, `The allowance estimate is about US$${quote.estimatedUsd.toFixed(3)}, above your confirmation threshold. It includes possible model fallbacks.`);
  return new Promise(resolve => {
    const dialog = $("#cost-dialog");
    dialog.returnValue = "";
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "approve"), { once: true });
    dialog.showModal();
  });
}
async function runLive(operation, payload) {
  requireConnection();
  if (live.busy) throw new Error(t("請先等候目前的操作完成。", "Wait for the current operation to finish."));
  live.busy = true; live.stopped = false; notice(""); syncSetup();
  try {
    const quote = await localAPI("/api/quote", { operation, payload, config: connectionConfig() });
    if (quote.needsConfirmation && !(await costApproval(quote))) {
      const cancelled = new Error("cancelled"); cancelled.code = "cancelled"; throw cancelled;
    }
    const response = await localAPI("/api/jobs", { quoteId: quote.quoteId, approveCost: !!quote.needsConfirmation }, { key: true });
    live.job = response.jobId;
    $("#progress-dialog .eyebrow").textContent = t("正在製作", "CREATING WORKSHEETS");
    $("#progress-dialog .field-note").textContent = t("Workspace 連線 · 所需時間按文件和模型而異", "Workspace connection · Time depends on the document and model");
    $("#progress-label").textContent = t("正在連接…", "Connecting…");
    $("#progress-bar").style.width = "10%";
    showDialog("progress");
    const started = Date.now();
    while (!live.stopped) {
      const status = await localAPI(`/api/jobs/${live.job}`);
      if (status.status === "done") return status.result;
      if (status.status === "error" || status.status === "cancelled") {
        const error = new Error(status.error?.message || status.message);
        error.code = status.error?.code || status.status; throw error;
      }
      $("#progress-label").textContent = state.lang === "zh" ? status.message : `Completed ${status.done} of ${status.total} operations…`;
      $("#progress-bar").style.width = `${Math.max(10, status.done / status.total * 100)}%`;
      if (Date.now() - started > 60000) $("#progress-dialog .field-note").textContent = t("模型仍在處理。你可以等候，或取消本次操作。", "The model is still working. You can wait or cancel.");
      await new Promise(resolve => setTimeout(resolve, 850));
    }
    const cancelled = new Error("cancelled"); cancelled.code = "cancelled"; throw cancelled;
  } finally {
    live.job = null; live.busy = false; closeDialog($("#progress-dialog")); syncSetup();
  }
}
async function cancelLive() {
  if (live.job) {
    live.stopped = true;
    await localAPI(`/api/jobs/${live.job}/cancel`, {}).catch(() => {});
    closeDialog($("#progress-dialog"));
    toast(t("已取消。已提交的模型請求仍可能計費。", "Cancelled. Already submitted model requests may still be charged."));
  }
}
function syncSetup() {
  const api = state.imported || $("#use-qwen")?.checked;
  $("#subject-select").disabled = !api;
  $("#use-qwen-row").hidden = state.imported;
  $("#edit-source-button").hidden = !live.source;
  $("#objective").required = !state.imported || !!live.source;
  $("#generate-button").disabled = live.busy || (state.imported && !live.document && !live.source) || (!api && $("#extend-mode").checked);
  if (live.busy) $("#generate-label").textContent = t("處理中…", "Working…");
  else if (state.imported && !live.source) $("#generate-label").textContent = t("讓 Qwen 讀取工作紙", "Read this worksheet with Qwen");
  else $("#generate-label").textContent = api ? t(`確認目標，製作 ${state.selected.length} 個版本`, `Confirm & create ${state.selected.length} versions`) : t(`製作 ${state.selected.length} 個示範版本`, `Create ${state.selected.length} demo versions`);
  copyLabel("#extend-note", api ? "只在另外標示的延伸題加入新目標，原有題目仍保留確認的目標。" : "延伸模式需要 Qwen 連線，示範模式未開放。", api ? "A new objective appears only in a separate extension question; the main questions keep your confirmed objective." : "Extension needs a Qwen connection and is unavailable in demo mode.");
  copyLabel(".create-action > .field-note", api ? "保留題目順序 · 生成前會檢查費用提示門檻" : "預先準備的分數題目 · 不使用 API", api ? "Original order retained · Cost threshold checked before requests" : "Prepared fraction examples · No API calls");
}
function resetLive() {
  live.pendingRead = false;
  live.document = null; live.source = null; notice("");
  $("#use-qwen").checked = false; $("#subject-select").value = "maths";
}
async function importFile(file) {
  if (live.busy) return toast(t("請先等候目前操作完成。", "Wait for the current operation."));
  if (!/\.(pdf|docx?|png|jpe?g|heic)$/i.test(file.name)) return toast(t("請選擇 DOC、DOCX、PDF、JPG、JPEG 或 PNG。", "Choose DOC, DOCX, PDF, JPG, JPEG or PNG."));
  if (file.size > 15 * 1024 * 1024) return toast(t("檔案不可超過 15 MB。", "Files must be under 15 MB."));
  startSample(); state.imported = true; state.fileName = file.name;
  $("#objective").value = ""; $("#topic").value = file.name.replace(/\.[^.]+$/, "");
  live.busy = true; renderSource(); renderImportNotice(); syncSetup();
  try {
    const encoded = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]); reader.onerror = reject; reader.readAsDataURL(file); });
    live.document = await localAPI("/api/documents", { fileName: file.name, base64: encoded });
    notice(live.document.notices.join("\n"));
  } catch (error) { report(error); }
  finally { live.busy = false; $("#file-input").value = ""; renderSource(); renderImportNotice(); syncSetup(); }
  if (browserMode && live.document) {
    if ($('#api-key').value.trim()) await analyzeUpload();
    else { live.pendingRead = true; showDialog('settings'); $('#api-key').focus(); }
  }
}
function sourceMarkup(source) {
  let previous = "";
  return `<p class="source-meta">小學${source.grade}年級${subjectText(source.subject)}科</p><h2>${esc(source.topic)}</h2>${source.context ? `<p class="source-context">${esc(source.context)}</p>` : ""}${source.questions.map((q, i) => {
    const heading = q.section !== previous ? `<p class="source-section">${esc(q.section)}</p>` : ""; previous = q.section;
    return `${heading}<p class="source-written">${i + 1}. ${esc(q.prompt)}</p>${q.diagram ? diagramMarkup(q.diagram) : ""}`;
  }).join("")}`;
}
function renderLiveSource() {
  if (!state.imported && !live.source) return false;
  $("#source-paper").innerHTML = live.source ? sourceMarkup(live.source)
    : live.document ? `${/\.docx?$/i.test(live.document.fileName) || !live.document.images.length ? `<pre class="raw-source-text">${esc(live.document.text)}</pre>${live.document.images.map(src => `<img class="source-page-image" src="${src}" alt="${t("Word 內嵌圖片", "Embedded Word image")}"/>`).join("")}` : `<img class="source-page-image" src="${live.document.images[0]}" alt="${esc(t("原稿第一頁預覽", "First source page"))}"/>`}`
    : `<p class="source-placeholder">${esc(t(live.busy ? "正在本機讀取檔案…" : "尚未讀取內容", live.busy ? "Reading locally…" : "No content read yet"))}</p>`;
  return true;
}
function renderLiveImport() {
  if (!state.imported) return false;
  $("#source-name").textContent = state.fileName;
  $("#import-notice").hidden = false;
  $("#import-notice").textContent = live.source ? t(`已讀取 ${live.source.questions.length} 題。請確認目標；如有誤讀，可按「檢查內容」修正。`, `Read ${live.source.questions.length} questions. Confirm the objective; use Check content to correct reading errors.`)
    : live.document ? t(browserMode ? '檔案已準備好。Qwen 會讀取文字、圖片及題目。' : '本機已讀取檔案。按下方按鈕後，內容才會傳送至Qwen 服務。', browserMode ? 'File ready. Qwen will read its text, pictures and questions.' : "File read locally. Its content is sent to Qwen service when you press the button below.")
    : t(live.busy ? "正在本機讀取檔案…" : "未能讀取檔案，請更換或重試。", live.busy ? "Reading locally…" : "Could not read the file. Choose another or retry.");
  $(".source-preview .preview-label span:last-child").textContent = live.source ? t("讀取內容", "Extracted content") : t("本機預覽", "Local preview");
  return true;
}
function sampleSource() {
  return { topic: $("#topic").value || "分數比較", objective: $("#objective").value || originalObjective,
    grade: Number($("#grade-select").value), subject: $("#subject-select").value, summary: "", context: "", notices: [],
    questions: samplePairs[4].map((pair, i) => ({ id: `q${i+1}`, section: ["在 ○ 內填上 ＞、＜ 或 ＝。", "在 ○ 內填上 ＞、＜ 或 ＝。", "觀察圖像，再比較大小。", "列式比較，並解釋方法。", "列式比較，並解釋方法。", "生活情境題。"][i], prompt: wording(pair, i, defaultPreset(4)), ...mathAnswer(pair, i), explanation: mathAnswer(pair, i).solution, hint: "", workLines: i < 2 ? 0 : 2, diagram: i === 2 ? { type: "fraction_bars", fractions: [[pair[0], pair[1]], [pair[2], pair[3]]], caption: "等長的整體" } : null })) };
}
function confirmedSource() {
  const source = structuredClone(live.source || sampleSource());
  return { ...source, topic: $("#topic").value.trim(), objective: $("#objective").value.trim(), grade: Number($("#grade-select").value), subject: $("#subject-select").value, summary: $("#content-notes").value || source.summary };
}
async function analyzeUpload() {
  live.pendingRead = false;
  try {
    const result = await runLive("analyze", { documentId: live.document.documentId, topic: $("#topic").value, notes: $("#content-notes").value });
    live.source = result.source;
    $("#objective").value = live.source.objective; $("#topic").value = live.source.topic;
    $("#grade-select").value = live.source.grade; $("#subject-select").value = live.source.subject;
    $("#content-notes").value = live.source.summary;
    notice([...live.source.notices, ...(result.meta.notes || [])].join("\n"));
    renderSource(); renderImportNotice(); syncSetup();
  } catch (error) { report(error); }
}
function versionRecord(data) {
  return { questions: data.questions, context: data.context, extension: data.extension,
    edits: {}, answers: {}, approved: false, notices: data.notices || [] };
}
async function generateLive() {
  try {
    const source = confirmedSource();
    const result = await runLive("generate", { source, levels: state.selected, baseline: state.baseline, presets: state.presets, extension: $("#extend-mode").checked });
    const levels = Object.keys(result.versions).map(Number).sort((a, b) => a-b);
    state.project = { id: crypto.randomUUID(), live: true, topic: source.topic, objective: source.objective, grade: source.grade, subject: source.subject,
      notes: source.summary, source: state.baseline, sourceDoc: source, fileName: state.fileName, imported: state.imported,
      extensionMode: $("#extend-mode").checked, levels, versions: Object.fromEntries(levels.map(n => [n, versionRecord(result.versions[n])])),
      failures: result.failures, modelUsage: result.metadata, updated: Date.now() };
    state.activeLevel = levels.includes(state.baseline) ? state.baseline : levels[0]; state.doc = "student"; state.compare = false;
    persistProject(); renderReview(); setView("review");
  } catch (error) { report(error); }
}
function handleGenerate() {
  if (state.imported && !live.source) { if (live.document) analyzeUpload(); return true; }
  if (state.imported || $("#use-qwen").checked) { generateLive(); return true; }
  $("#progress-dialog .eyebrow").textContent = t("示範製作中", "PREPARING DEMO VERSIONS");
  $("#progress-dialog .field-note").textContent = t("預先準備的分數題目，不使用 API", "Prepared fraction examples; no API calls");
  return false;
}
function diagramMarkup(diagram) {
  if (!diagram || diagram.type !== "fraction_bars") return "";
  return `<div class="fraction-bars">${diagram.fractions.map(([a, b]) => `<div class="bar-line"><span>${a}/${b}</span>${fractionBar(a, b)}</div>`).join("")}</div>`;
}
function liveQuestion(q, i, version, extension = false) {
  const edited = Object.hasOwn(version.edits, i);
  const prompt = edited ? version.edits[i] : q.prompt;
  return `<li class="worksheet-question" data-item="${i}"><span class="q-number">${extension ? "E1" : i + 1}.</span><span class="question-text" ${extension ? "" : `contenteditable="plaintext-only" role="textbox" data-edit="${i}" aria-label="${t("題目", "Question")} ${i+1}"`}>${esc(prompt)}</span>${!edited && q.diagram ? `<div class="question-visual">${diagramMarkup(q.diagram)}</div>` : ""}${!edited && q.hint ? `<p class="question-hint">${esc(q.hint)}</p>` : ""}${Array.from({ length: q.workLines }, () => '<div class="answer-space"></div>').join("")}${extension ? "" : `<button class="regenerate-button" data-regenerate="${i}" title="${t("重新製作這題", "Regenerate this question")}">${icon("refresh")}<span>${t("換一題", "Another question")}</span></button>`}</li>`;
}
function renderLiveWorksheet() {
  const p = state.project; if (!p?.live) return false;
  const v = p.versions[state.activeLevel], answerMode = state.doc === "answers";
  let content = `<header class="worksheet-heading"><div><p>小學${p.grade}年級${subjectText(p.subject)}科</p><h2>${esc(p.topic)}${answerMode ? " · 答案" : ""}</h2></div>${answerMode ? "" : '<div class="student-details"><span>姓名：＿＿＿＿＿＿</span><span>班別：＿＿＿　日期：＿＿＿</span></div>'}</header><div class="document-meta"><span>程度 ${state.activeLevel}</span><span>${v.questions.length} 題${v.extension ? " ＋ 延伸題" : ""}</span></div>`;
  if (v.context) content += `<div class="reading-passage">${esc(v.context)}</div>`;
  if (answerMode) {
    if (Object.keys(v.edits).length) content += '<p class="answer-warning">題目已修改，請檢查答案及解說。修改題目的舊圖解與提示不會匯出。</p>';
    content += v.questions.map((q, i) => `<div class="answer-item"><b>${i+1}.</b><div><span class="question-text" contenteditable="plaintext-only" role="textbox" data-answer-edit="${i}" aria-label="答案 ${i+1}">${esc(v.answers[i] ?? q.answer)}</span><small>${esc(q.explanation)}${Object.hasOwn(v.edits, i) ? "（修改前的解說，請核對）" : ""}</small></div></div>`).join("");
  } else {
    let current = null;
    v.questions.forEach((q, i) => { if (current !== q.section) { if (current !== null) content += "</ol></section>"; content += `<section class="question-section"><h3>${esc(q.section)}</h3><ol class="worksheet-questions">`; current = q.section; } content += liveQuestion(q, i, v); });
    content += "</ol></section>";
  }
  if (v.extension) content += `<section class="question-section extension-section"><h3>延伸挑戰</h3><p class="field-note">延伸目標：${esc(v.extension.objective)}</p>${answerMode ? `<div class="answer-item"><b>E1</b><div>${esc(v.extension.question.answer)}<small>${esc(v.extension.question.explanation)}</small></div></div>` : `<ol class="worksheet-questions">${liveQuestion(v.extension.question, 60, v, true)}</ol>`}</section>`;
  content += '<footer class="worksheet-end"><span>分層工作紙生成 · 需老師檢查</span></footer>';
  $("#worksheet-page").innerHTML = content;
  return true;
}
function renderComparison() {
  if (!state.project?.live) return false;
  $("#comparison-content").innerHTML = sourceMarkup(state.project.sourceDoc);
  return true;
}
function reviewRendered() {
  const p = state.project;
  const messages = p?.live ? [ ...Object.entries(p.failures || {}).map(([n, error]) => t(`程度 ${n} 未完成：${error.message}`, `Level ${n} did not finish: ${error.message}`)),
    ...(p.versions[state.activeLevel]?.notices || []), ...(p.modelUsage?.[state.activeLevel]?.notes || []) ] : [];
  $("#generation-notice").textContent = messages.join("\n"); $("#generation-notice").hidden = !messages.length;
  $(".comparison-page .paper-label").textContent = p?.live ? t("原稿讀取內容", "Extracted source") : t("原稿", "Original");
}
async function replaceQuestion(index) {
  const project = state.project, level = state.activeLevel, version = project.versions[level];
  try {
    const source = effectiveWorksheet(); source.questions = [source.questions[index]];
    const result = await runLive("replace", { source, levels: [level], baseline: project.source, presets: state.presets, extension: false });
    version.questions[index] = result.versions[level].questions[0]; delete version.edits[index]; delete version.answers[index]; version.approved = false;
    project.modelUsage[level] = result.metadata[level]; persistProject(); renderReview();
  } catch (error) { report(error); }
}
function effectiveWorksheet() {
  const p = state.project, v = p.versions[state.activeLevel];
  const questions = p.live ? v.questions.map((q, i) => ({ ...q, prompt: v.edits[i] ?? q.prompt, answer: v.answers[i] ?? q.answer,
    ...(Object.hasOwn(v.edits, i) ? { explanation: "", diagram: null, hint: "" } : {}) }))
    : v.pairs.map((pair, i) => ({ id: `q${i+1}`, section: sampleSource().questions[i].section, prompt: v.edits[i] ?? wording(pair, i, v.options), answer: v.answers[i] ?? mathAnswer(pair, i).answer,
      explanation: Object.hasOwn(v.edits, i) ? "" : mathAnswer(pair, i).solution,
      hint: !Object.hasOwn(v.edits, i) && (i >= 3 || i === 0) ? hintFor(pair, v.options) : "", workLines: i < 2 ? 0 : i === 2 ? 1 : 2,
      diagram: !Object.hasOwn(v.edits, i) && v.options.visuals && (i === 2 || (i === 0 && v.options.guidance >= 2)) ? { type: "fraction_bars", fractions: [[pair[0], pair[1]], [pair[2], pair[3]]], caption: "等長的整體" } : null }));
  return { topic: p.topic, objective: p.objective, grade: p.grade, subject: p.subject || "maths", summary: p.notes || "", context: p.live ? v.context : "", questions, notices: [] };
}
async function downloadWord(mode) {
  if (!state.project?.versions[state.activeLevel].approved) return;
  try {
    $("#download-menu").hidden = true;
    const blob = await localAPI("/api/export/docx", { worksheet: effectiveWorksheet(), level: state.activeLevel, mode, approved: true, extension: state.project.versions[state.activeLevel].extension || null }, { binary: true });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `${state.project.topic}_程度${state.activeLevel}_${mode}.docx`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(t("已匯出可編輯的 Word 文件。", "Exported an editable Word document."));
  } catch (error) { report(error); }
}
function openSourceEditor() {
  if (!live.source) return;
  $("#source-edit-list").innerHTML = `<label class="field"><span>${t("閱讀材料／共同資料", "Reading passage / shared information")}</span><textarea id="source-context-edit" rows="5">${esc(live.source.context)}</textarea></label>` + live.source.questions.map((q, i) => `<label class="field source-edit-question"><span>${i+1}. ${esc(q.section)}</span><textarea rows="3" data-source-edit="${i}">${esc(q.prompt)}</textarea></label>`).join("");
  showDialog("source");
}
function saveSourceEditor() {
  const fields = $$("[data-source-edit]");
  if (fields.some(el => !el.value.trim())) return toast(t("題目不可留空。", "Questions cannot be blank."));
  live.source.context = $("#source-context-edit").value;
  fields.forEach(el => { const q = live.source.questions[Number(el.dataset.sourceEdit)]; if (q.prompt !== el.value) { q.prompt = el.value; q.answer = ""; q.explanation = ""; q.hint = ""; q.diagram = null; } });
  closeDialog($("#source-dialog")); renderSource();
}
function afterTranslate() {
  $('.file-types').textContent = 'DOC · DOCX · PDF · JPG · JPEG · PNG';
  copyLabel("#settings-dialog h2", "連接你的 Qwen", "Connect your Qwen account");
  copyLabel("#settings-dialog .dialog-intro", "文件理解及題目調整使用同一個模型服務金鑰。精確數學圖解由本機繪製。", "Document reading and question adaptation use the same model-service key. Exact maths diagrams are drawn locally.");
  copyLabel("#settings-dialog .field > small", "金鑰不會儲存到磁碟。只有讀取、製作或測試時才送交Qwen 服務。", "The key is not saved to disk. It is sent to Qwen service only when reading, generating or testing.");
  copyLabel("#settings-dialog .region-note", "預設 Qwen 國際服務（新加坡）· 可自訂 API Host", "Default: Qwen International (Singapore) · Custom API Host supported");
  copyLabel("#settings-dialog .options-body > small", "圖片生成未接駁：目前只接駁文字及視覺理解模型。", "Image generation is not connected yet; language and vision models are supported.");
  copyLabel("#settings-dialog .service-list > div:last-child > span", "精確數學圖解", "Exact maths diagrams");
  $("#settings-dialog .service-list > div:last-child small").textContent = t("本機", "Local");
  const imageSelect = $("[data-model='image']"); if (imageSelect) { imageSelect.disabled = true; imageSelect.innerHTML = `<option>${t("圖片生成未接駁", "Image generation deferred")}</option>`; $("[data-model-id='image']").hidden = true; }
  $("#workspace-id").placeholder = t("貼上 API Host 或 API URL", "Paste an API Host or API URL");
  copyLabel("#about-dialog h2", "分層工作紙生成", "Differentiated worksheet generator");
  copyLabel("#about-dialog .dialog-intro", "可上載 PDF、Word 或圖片，透過Qwen 讀取及改編工作紙，並匯出可編輯的 Word。沒有金鑰也可使用分數示範。內容及難度尚需老師核對，未經官方課程校準。圖片生成、音訊及影片仍未接駁。", "Upload PDF, Word or images, use Qwen to read and adapt them, and export editable Word documents. The fraction demo works without a key. Teachers must review content and difficulty; formal curriculum calibration, generated illustrations, audio and video are not connected.");
  $("#use-qwen").checked = state.imported ? false : $("#use-qwen").checked;
  syncSetup(); reviewRendered();
}

installLiveUI();
window.SevenLive = {
  reset: resetLive, importFile, generate: handleGenerate, syncSetup, afterTranslate,
  renderSource: renderLiveSource, renderImportNotice: renderLiveImport,
  renderWorksheet: renderLiveWorksheet, renderComparison, reviewRendered, replace: replaceQuestion,
  cancel: () => { if (!live.job) return false; cancelLive(); return true; },
  afterEdit: el => { if (el.hasAttribute("data-edit")) $$(".question-visual,.question-hint", el.closest(".worksheet-question")).forEach(n => { n.hidden = true; }); },
  projectOpened: p => { live.source = p.live ? structuredClone(p.sourceDoc) : null; live.document = null; notice(""); $("#subject-select").value = p.subject || "maths"; $("#use-qwen").checked = !!p.live && !p.imported; $("#extend-mode").checked = !!p.extensionMode; syncSetup(); },
};
document.addEventListener("click", async e => {
  const button = e.target.closest("button"); if (!button || button.disabled) return;
  if (button.dataset.action === "approve-cost") $("#cost-dialog").close("approve");
  if (button.dataset.action === "word") downloadWord(state.doc);
  if (button.dataset.action === "word-both") downloadWord("both");
  if (button.dataset.action === "edit-source") openSourceEditor();
  if (button.dataset.action === "save-source") saveSourceEditor();
  if (button.dataset.action === "forget-key") { live.connected = false; $("#connection-result").textContent = ""; }
  if (button.dataset.action === 'save-settings' && live.pendingRead && $('#api-key').value.trim()) await analyzeUpload();
  if (button.dataset.action === "test-connection") {
    try {
      const result = await runLive("test", {}); live.connected = true;
      $("#connection-result").textContent = t(`文字連線成功 · ${result.meta.model}`, `Language connection successful · ${result.meta.model}`);
    } catch (error) { live.connected = false; $("#connection-result").textContent = error.message; report(error); }
  }
});
document.addEventListener("change", e => {
  if (["use-qwen", "subject-select"].includes(e.target.id)) syncSetup();
});
$("#api-key").addEventListener("input", () => { live.connected = false; $("#connection-result").textContent = ""; });
afterTranslate();
localAPI("/api/health").then(result => { live.available = result.live === true; syncSetup(); }).catch(() => {});
