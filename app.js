"use strict";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STORAGE = "seven-worksheets-v2";
const PREFS = "seven-preferences-v2";
const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const range = (length) => Array.from({ length }, (_, i) => i + 1);
const zhNumbers = ["", "一", "二", "三", "四", "五", "六", "七"];
const levelNames = ["", "充分引導", "分步提示", "適量支援", "原稿程度", "自主應用", "深入思考", "進階挑戰"];
const levelNamesEn = ["", "Fully guided", "Step by step", "Supported", "Original", "Independent", "Deeper thinking", "Challenge"];
const originalObjective = "比較異分母分數的大小，並解釋比較方法。";
const samplePairs = {
  1: [[1,2,1,4],[1,3,1,6],[3,4,5,8],[3,4,2,3],[2,5,1,2],[3,4,1,2]],
  2: [[2,3,1,2],[3,5,1,2],[3,4,5,8],[5,6,3,4],[4,7,1,2],[3,4,5,8]],
  3: [[2,3,3,5],[5,8,1,2],[3,4,5,8],[7,10,2,3],[4,9,5,12],[3,4,5,8]],
  4: [[2,3,3,5],[5,8,7,12],[3,4,5,8],[7,10,2,3],[4,9,5,12],[3,4,5,8]],
  5: [[7,12,5,9],[11,15,7,10],[3,4,5,8],[11,14,7,9],[5,8,7,12],[7,8,11,15]],
  6: [[13,18,17,24],[9,14,11,18],[3,4,5,8],[17,24,13,18],[7,12,5,8],[11,15,7,10]],
  7: [[17,28,23,36],[19,30,13,21],[3,4,5,8],[23,35,17,26],[11,16,13,19],[11,15,17,24]]
};
const rerollPairs = [[5,6,7,9],[4,5,7,10],[3,8,2,5],[5,12,4,9],[7,8,5,6],[11,15,3,4]];
function readStorage(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function defaultPreset(level) { return { guidance: level < 3 ? 3 : level === 3 ? 2 : level === 4 ? 1 : 0, numbers: level < 4 ? 0 : level === 4 ? 1 : 2, reasoning: level < 4 ? 0 : level < 6 ? 1 : 2, hints: level < 4, visuals: level < 5 }; }
const storedPreferences = readStorage(PREFS, {});
const state = {
  view: "home", lang: storedPreferences.lang === "en" ? "en" : "zh", example: 1,
  selected: [1,4,7], baseline: 4, preset: 1, project: null, activeLevel: 4,
  doc: "student", compare: false, imported: false, fileName: "P4_分數比較.pdf",
  timer: null, library: readStorage(STORAGE, []), lastDeleted: null,
  presets: Object.fromEntries(range(7).map(n => [n, { ...defaultPreset(n), ...(storedPreferences.presets?.[n] || {}) }])),
  models: storedPreferences.models || { vision: "", language: "", image: "" }
};
if (!Array.isArray(state.library)) state.library = [];
state.library = state.library.filter(p => p && typeof p.id === "string" && Array.isArray(p.levels) && p.versions);
const t = (zh, en) => state.lang === "zh" ? zh : en;
const levelName = (n, baseline = 4) => n === baseline ? t("原稿程度", "Original") : (state.lang === "zh" ? levelNames[n] : levelNamesEn[n]);

function persistPreferences() {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ lang: state.lang, presets: state.presets, models: state.models, workspace: $("#workspace-id").value, fallback: $("#fallback").checked, cost: $("#cost-limit").value }));
  } catch { toast(t("這個瀏覽器未能儲存設定。", "This browser could not save preferences.")); }
}
function persistProject() {
  if (!state.project) return false;
  state.project.updated = Date.now();
  const index = state.library.findIndex(p => p.id === state.project.id);
  if (index >= 0) state.library[index] = state.project; else state.library.unshift(state.project);
  try { localStorage.setItem(STORAGE, JSON.stringify(state.library)); return true; }
  catch { toast(t("儲存空間不足，修改目前只留在本次開啟。", "Storage unavailable. Changes remain in this session.")); return false; }
}
function toast(message) {
  $("#toast").textContent = message; $("#toast").classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 3000);
}
function showDialog(id) { const dialog = $(`#${id}-dialog`); if (!dialog.open) dialog.showModal(); }
function closeDialog(dialog) { dialog?.close(); }
function setView(view) {
  state.view = view;
  $$(".view").forEach(el => { el.hidden = el.id !== `${view}-view`; });
  document.body.dataset.view = view;
  $("#download-menu").hidden = true;
  window.scrollTo({ top: 0, behavior: "instant" });
}
function translate() {
  document.documentElement.lang = state.lang === "zh" ? "zh-Hant" : "en";
  $$('[data-zh]').forEach(el => { el.textContent = el.dataset[state.lang].replaceAll("｜", "\n"); });
  $(".language-button").textContent = t("EN", "繁");
  const grade = $("#grade-select").value || "4";
  $("#grade-select").innerHTML = range(6).map(n => `<option value="${n}">${t(`小${zhNumbers[n]}`, `Primary ${n}`)}</option>`).join("");
  $("#grade-select").value = grade;
  $("#source-level").innerHTML = range(7).map(n => `<option value="${n}">${n}</option>`).join("");
  $("#source-level").value = state.baseline;
  renderExample(false); renderLevelPicker(); renderModels(); renderSource(); renderImportNotice();
  if (state.project) renderReview();
  if ($("#presets-dialog").open) renderPresets();
  if ($("#library-dialog").open) renderLibrary();
  $("[data-action='show-key']").textContent = $("#api-key").type === "password" ? t("顯示", "Show") : t("隱藏", "Hide");
  window.SevenLive?.afterTranslate();
}

function fraction(a,b) { return `<span class="fraction"><span>${a}</span><span>${b}</span></span>`; }
function fractionBar(a,b) {
  const width = 280, height = 18;
  return `<svg class="fraction-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${a}/${b}"><rect x="0.5" y="0.5" width="279" height="17" fill="#fff" stroke="#8d98bb" stroke-width="1"/><rect x="1" y="1" width="${(278 * a/b).toFixed(4)}" height="16" fill="#b9c7ee"/>${Array.from({length:b-1},(_,i)=>`<line x1="${(1+278*(i+1)/b).toFixed(4)}" x2="${(1+278*(i+1)/b).toFixed(4)}" y1="1" y2="17" stroke="#7f8fb6" stroke-width=".7"/>`).join("")}</svg>`;
}
function bars(pair) { const [a,b,c,d] = pair; return `<div class="fraction-bars"><div class="bar-line"><span>${a}/${b}</span>${fractionBar(a,b)}</div><div class="bar-line"><span>${c}/${d}</span>${fractionBar(c,d)}</div></div>`; }
function renderExample(animate = true) {
  const n = state.example, page = $("#example-paper");
  const p = n === 7 ? [23,35,17,26] : [2,3,3,5];
  page.innerHTML = `<div class="paper-kicker"><span>小四數學 · 示範題目</span><strong>LEVEL ${String(n).padStart(2,"0")}</strong></div><h2>分數比較</h2><p class="paper-instruction">比較以下分數，在 ○ 內填上 ＞、＜ 或 ＝。</p><div class="example-equation">${fraction(p[0],p[1])}<span class="compare-circle">○</span>${fraction(p[2],p[3])}</div>${n===1 ? `<div class="guide-box"><strong>先找同樣的分母</strong><p>把兩個分數都分成 15 份，再看看。</p>${bars([10,15,9,15])}</div><p class="example-answer">我發現：＿＿＿＿＿＿＿＿＿＿＿＿</p>` : n===4 ? `<p class="challenge-note">寫出你的通分步驟。<br>想一想：為甚麼先找共同分母？</p><p class="example-answer">我的方法：＿＿＿＿＿＿＿＿＿＿＿</p>` : `<p class="challenge-note"><b>再想深一點</b><br>兩個分數十分接近。<br>怎樣比較，才可以確定答案？</p><p class="example-answer">我的解釋：＿＿＿＿＿＿＿＿＿＿＿</p>`}<div class="example-foot"><span>同一個學習目標</span><span>01</span></div>`;
  if (animate) { page.classList.remove("turning"); void page.offsetWidth; page.classList.add("turning"); }
  $$('[data-example]').forEach(el => { const active = Number(el.dataset.example) === n; el.classList.toggle("active", active); el.setAttribute("aria-pressed", active); });
}
function sourceHTML(grade = 4, topic = "分數比較") {
  return `<p class="source-meta">小學${zhNumbers[grade] || "四"}年級數學科</p><h2>${esc(topic)}</h2><p class="source-section">一、在 ○ 內填上 ＞、＜ 或 ＝。</p><div class="source-pairs">${samplePairs[4].slice(0,2).map((p,i)=>`<div class="source-pair"><span>${i+1}.</span>${fraction(p[0],p[1])}<span class="compare-circle">○</span>${fraction(p[2],p[3])}</div>`).join("")}</div><p class="source-section">二、觀察圖像，再比較大小。</p><p class="source-written">3. 比較 3/4 和 5/8。</p>${bars([3,4,5,8])}<p class="source-section">三、列式比較，並解釋方法。</p><p class="source-written">4. 比較 7/10 和 2/3。</p><div class="source-line"></div><p class="source-written">5. 比較 4/9 和 5/12。</p><div class="source-line"></div><p class="source-section">四、生活情境題。</p><p class="source-written">6. 家明用了 3/4 米絲帶，美儀用了 5/8 米。誰用得較多？解釋你的答案。</p><div class="source-line"></div>`;
}
function renderSource() {
  if (window.SevenLive?.renderSource()) return;
  const html = sourceHTML(Number($("#grade-select").value), $("#topic").value || "分數比較");
  $("#source-paper").innerHTML = html; $("#comparison-content").innerHTML = html;
}
function renderLevelPicker() {
  $("#level-picker").innerHTML = range(7).map(n => `<button type="button" data-level="${n}" class="${state.selected.includes(n)?"selected":""} ${state.baseline===n?"baseline":""}" aria-pressed="${state.selected.includes(n)}" aria-label="${t("程度", "Level")} ${n}${state.baseline===n?t("，原稿", ", original"):""}"><span>${n}</span><i class="selection-tick" aria-hidden="true">✓</i></button>`).join("");
  $("#baseline-label").textContent = t(`原稿：${state.baseline}`, `Original: ${state.baseline}`);
  $("#generate-label").textContent = t(`確認目標，製作 ${state.selected.length} 個版本`, `Confirm & create ${state.selected.length} versions`);
  window.SevenLive?.syncSetup();
}
function renderImportNotice() {
  if (window.SevenLive?.renderImportNotice()) return;
  $("#source-name").textContent = state.fileName;
  $("#import-notice").hidden = !state.imported;
  $("#import-notice").textContent = t("已選擇檔案。此原型會繼續使用分數示範題目，尚未解析檔案內容。", "File selected. This prototype uses the fraction sample; the file has not been parsed.");
  $(".source-preview .preview-label span:last-child").textContent = state.imported ? t("示範內容 · 尚未解析", "Sample · File not parsed") : t("內容預覽", "Content preview");
}
function startSample() {
  window.SevenLive?.reset();
  state.project = null; state.imported = false; state.fileName = "P4_分數比較.pdf"; state.selected = [1,4,7]; state.baseline=4;
  $("#grade-select").value = "4"; $("#objective").value = originalObjective; $("#topic").value = "分數比較"; $("#content-notes").value = ""; $("#source-level").value = "4";
  $("#extend-mode").checked = false; $("#extend-note").hidden = true; $("#generate-button").disabled = false;
  $(".setup-form .more-options").open = false;
  renderSource(); renderImportNotice(); renderLevelPicker(); setView("setup");
}
function handleFile(file) {
  if (!file) return;
  if (window.SevenLive) { window.SevenLive.importFile(file); return; }
  if (!/\.(pdf|docx?|png|jpe?g|heic)$/i.test(file.name)) { toast(t("請選擇 PDF、Word 或圖片檔案。", "Choose a PDF, Word document or image.")); return; }
  startSample(); state.imported = true; state.fileName = file.name;
  renderImportNotice(); $("#file-input").value = "";
}

function renderPresets() {
  const n=state.preset, preset=state.presets[n];
  $("#preset-tabs").innerHTML = range(7).map(l=>`<button type="button" data-preset="${l}" aria-pressed="${n===l}" class="${n===l?"active":""}">${l}</button>`).join("");
  const controls = [
    ["guidance",t("引導步驟", "Guided steps"),3,t("從獨立作答，到逐步引導。", "From independent work to guided steps.")],
    ["numbers",t("數字複雜度", "Number complexity"),2,t("較簡單、跟隨原稿，或較複雜。", "Simpler, original, or more complex values.")],
    ["reasoning",t("解釋與思考", "Explanation and reasoning"),2,t("調整提示方式與需要解釋的程度。", "Adjust how much explanation each question asks for.")]
  ];
  $("#preset-detail").innerHTML = controls.map(([key,label,max,note])=>`<label class="preset-line"><span>${label}<output id="${key}-output">${presetLabel(key,preset[key])}</output></span><input type="range" min="0" max="${max}" step="1" value="${preset[key]}" data-preset-value="${key}" aria-label="${label}"/><small>${note}</small></label>`).join("") + `<div class="preset-checks"><label class="checkbox-row"><input type="checkbox" data-preset-check="hints" ${preset.hints?"checked":""}/><span>${t("加入提示", "Add hints")}</span></label><label class="checkbox-row"><input type="checkbox" data-preset-check="visuals" ${preset.visuals?"checked":""}/><span>${t("加入圖解", "Add diagrams")}</span></label></div><p class="preset-explanation">${t("調整套用於下一次示範製作。七級難度仍有待課堂校準。", "Changes apply to the next demo generation. The seven levels still need classroom calibration.")}</p>`;
}
function presetLabel(key,value) { const labels=key==="guidance" ? [["沒有", "None"],["少量", "Light"],["適量", "Some"],["逐步引導", "Step by step"]] : key==="numbers" ? [["較簡單", "Simpler"],["原稿", "Original"],["較複雜", "More complex"]] : [["基本", "Basic"],["說明方法", "Explain method"],["深入解釋", "Explain reasoning"]]; return t(...labels[clamp(value,0,labels.length-1)]); }
function renderModels() {
  $("#model-options").innerHTML = [["vision",t("文件閱讀", "Document reading")],["language",t("題目與推理", "Questions & reasoning")],["image",t("插圖", "Illustrations")]].map(([key,label])=>`<label class="model-option"><span>${label}</span><select data-model="${key}" aria-label="${label}"><option value="auto" ${!state.models[key]?"selected":""}>${t("自動選擇", "Automatic")}</option><option value="custom" ${state.models[key]?"selected":""}>${t("指定模型", "Custom model")}</option></select><input data-model-id="${key}" aria-label="${label} Model ID" placeholder="Model ID" value="${esc(state.models[key])}" ${state.models[key]?"":"hidden"}/></label>`).join("");
}
function syncEndpoint() {
  const raw=$("#workspace-id").value.trim();
  const valid=/^[a-zA-Z0-9-]+$/.test(raw);
  $("#workspace-id").setCustomValidity(raw && !valid ? t("只可使用英文字母、數字及連字號。", "Use letters, numbers and hyphens.") : "");
  $("#endpoint").textContent=raw?`https://${valid?raw:"{WorkspaceId}"}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`:"https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
}

function gcd(a,b){ while(b){[a,b]=[b,a%b];}return a; }
function mathAnswer(pair,index) {
  const [a,b,c,d]=pair, relation=a*d===c*b?"＝":a*d>c*b?"＞":"＜", common=b*d/gcd(b,d);
  const answer=index===5 ? (relation==="＞"?"家明用得較多。":relation==="＜"?"美儀用得較多。":"兩人用得一樣多。") : `${a}/${b} ${relation} ${c}/${d}`;
  return { answer, solution:`通分：${a}/${b} ＝ ${a*common/b}/${common}；${c}/${d} ＝ ${c*common/d}/${common}。` };
}
function wording(pair,index,options) {
  const [a,b,c,d]=pair, left=`${a}/${b}`, right=`${c}/${d}`;
  if(index<2)return `${left}　○　${right}`;
  if(index===2)return `比較 ${left} 和 ${right}，在 ○ 內填上 ＞、＜ 或 ＝。`;
  if(index===5)return `家明用了 ${left} 米絲帶，美儀用了 ${right} 米。誰用得較多？${options.reasoning===2?"列式比較，並解釋為甚麼不能只看分子。":"解釋你的答案。"}`;
  if(options.reasoning===2 && index===4)return `有同學說：「比較分數，只要看分子就足夠。」以 ${left} 和 ${right} 為例，指出這個說法的問題，再作出正確比較。`;
  return `比較 ${left} 和 ${right}。${options.reasoning===0?"圈出較大的分數。":options.reasoning===1?"寫出通分步驟，並解釋你的方法。":"寫出比較方法，並說明為甚麼這個方法有效。"}`;
}
function createVersion(level) {
  const effective=clamp(4+level-state.baseline,1,7);
  const options={...state.presets[level]};
  const defaultValues=defaultPreset(level);
  // Keep levels relative to the teacher's source setting. Explicit edits win.
  for(const key of Object.keys(options)){if(options[key]===defaultValues[key]) options[key]=defaultPreset(effective)[key];}
  const poolLevel=options.numbers===0 ? Math.min(effective,3) : options.numbers===1 ? 4 : Math.max(effective,5);
  const pairs=samplePairs[poolLevel].map(p=>[...p]);
  return { level, effective, options, pairs, edits:{}, answers:{}, approved:false, rerolls:{} };
}
function generate() {
  if (window.SevenLive?.generate()) return;
  if (!$("#objective").value.trim() || !$("#topic").value.trim()) {toast(t("請填寫學習目標及主題。", "Enter the objective and topic."));return;}
  if($("#extend-mode").checked)return;
  let step=0;
  showDialog("progress"); $("#progress-bar").style.width="0%";
  $("#progress-label").textContent=t("正在整理你的版本…", "Preparing your versions…");
  const steps=[t("整理題目與版面…", "Preparing the questions…"),t("加入合適的引導…", "Adding the right guidance…"),t("準備工作紙與答案…", "Preparing worksheets and answers…")];
  const next=()=>{
    step++; $("#progress-bar").style.width=`${step/3*100}%`; $("#progress-label").textContent=steps[step-1];
    if(step<3){state.timer=setTimeout(next,550);return;}
    state.timer=setTimeout(()=>{
      const levels=[...state.selected].sort((a,b)=>a-b);
      state.project={id:crypto.randomUUID(),topic:$("#topic").value.trim(),objective:$("#objective").value.trim(),notes:$("#content-notes").value,grade:Number($("#grade-select").value),source:state.baseline,fileName:state.fileName,imported:state.imported,levels,versions:Object.fromEntries(levels.map(n=>[n,createVersion(n)])),updated:Date.now()};
      state.activeLevel=levels.includes(state.baseline)?state.baseline:levels[0];state.doc="student";state.compare=false;
      persistProject(); closeDialog($("#progress-dialog")); renderReview(); setView("review");
    },350);
  };
  state.timer=setTimeout(next,160);
}
function cancelGeneration() {if(window.SevenLive?.cancel())return;clearTimeout(state.timer);closeDialog($("#progress-dialog"));toast(t("已取消，設定仍然保留。", "Cancelled. Your choices are kept."));}
function hintFor(pair,options) {
  if(!options.hints || !options.guidance)return "";
  const [a,b,c,d]=pair,common=b*d/gcd(b,d);
  return options.guidance>=3 ? `① 找共同分母 ${common}。　② 把 ${a}/${b} 和 ${c}/${d} 通分。　③ 比較分子。` : options.guidance===2 ? `試試先把分母都變成 ${common}，再比較分子。` : "提示：先找共同分母，再比較分子。";
}
function questionHTML(version,index) {
  const pair=version.pairs[index], edited=Object.hasOwn(version.edits,index), text=edited?version.edits[index]:wording(pair,index,version.options);
  const hint=edited?"":hintFor(pair,version.options);
  return `<li class="worksheet-question" data-item="${index}"><span class="q-number">${index+1}.</span><span class="question-text" contenteditable="plaintext-only" role="textbox" aria-label="${t("題目", "Question")} ${index+1}" data-edit="${index}" spellcheck="false">${esc(text)}</span>${!edited && (index===2 || (index===0 && version.options.guidance>=2)) && version.options.visuals ? `<div class="question-visual">${bars(pair)}</div>` : ""}${hint && (index>=3 || index===0) ? `<p class="question-hint">${esc(hint)}</p>` : ""}${index>=2?`<div class="answer-space"></div>${index>=3?'<div class="answer-space"></div>':""}`:""}<button class="regenerate-button" data-regenerate="${index}" title="${t("更換這道示範題目", "Replace this sample question")}">${icon("refresh")}<span>${t("換一題", "Another question")}</span></button></li>`;
}
function renderWorksheet() {
  if (window.SevenLive?.renderWorksheet()) return;
  const p=state.project,v=p?.versions[state.activeLevel];if(!v)return;
  const answersMode=state.doc==="answers";
  const header=`<header class="worksheet-heading"><div><p>小學${zhNumbers[p.grade]}年級數學科</p><h2>${esc(p.topic)}${answersMode?" · 答案":""}</h2></div>${!answersMode?'<div class="student-details"><span>姓名：＿＿＿＿＿＿</span><span>班別：＿＿＿　日期：＿＿＿</span></div>':""}</header><div class="document-meta"><span>程度 ${v.level} · ${esc(v.level===p.source?"原稿程度":levelNames[v.level])}</span><span>6 題 · 12 分 · 示範工作紙</span></div>`;
  let content;
  if(answersMode){
    content=(Object.keys(v.edits).length?'<p class="answer-warning">題目有修改，請核對下列答案。可點選答案直接修訂。</p>':"")+v.pairs.map((pair,i)=>{
      const result=mathAnswer(pair,i);
      return `<div class="answer-item"><b>${i+1}.</b><div><span contenteditable="plaintext-only" class="question-text" role="textbox" aria-label="答案 ${i+1}" data-answer-edit="${i}">${esc(v.answers[i]??result.answer)}</span><small>${esc(result.solution)}${Object.hasOwn(v.edits,i)?"（按修改前數值計算）":""}</small></div></div>`;
    }).join("");
  }else{
    content=`<section class="question-section"><h3><span>一</span>在 ○ 內填上 ＞、＜ 或 ＝。</h3><ol class="worksheet-questions inline">${questionHTML(v,0)}${questionHTML(v,1)}</ol></section><section class="question-section"><h3><span>二</span>${v.options.visuals?"觀察圖像，再比較大小。":"比較分數，並寫出答案。"}</h3><ol class="worksheet-questions">${questionHTML(v,2)}</ol></section><section class="question-section"><h3><span>三</span>列式比較，並解釋方法。</h3><ol class="worksheet-questions">${questionHTML(v,3)}${questionHTML(v,4)}</ol></section><section class="question-section"><h3><span>四</span>生活情境題。</h3><ol class="worksheet-questions">${questionHTML(v,5)}</ol></section>`;
  }
  $("#worksheet-page").innerHTML=header+content+'<footer class="worksheet-end"><span>分層工作紙生成 · 示範工作紙</span><span>1</span></footer>';
}
function renderReview() {
  const p=state.project;if(!p)return;
  $("#review-title").textContent=p.topic;
  $("#review-tabs").innerHTML=p.levels.map(n=>`<button data-review-level="${n}" aria-pressed="${state.activeLevel===n}" class="${state.activeLevel===n?"active":""}"><span>${t(`程度 ${n}`, `Level ${n}`)}</span><i>${p.versions[n].approved?"✓":""}</i></button>`).join("");
  $$('[data-document]').forEach(b=>{const active=b.dataset.document===state.doc;b.classList.toggle("active",active);b.setAttribute("aria-pressed",active);});
  $("#comparison-page").hidden=!state.compare;$("#review-canvas").classList.toggle("comparing",state.compare);$("[data-action='compare']").setAttribute("aria-pressed",state.compare);
  if(!window.SevenLive?.renderComparison())$("#comparison-content").innerHTML=sourceHTML(p.grade,p.topic);
  renderWorksheet();updateReviewStatus();
  $("#save-indicator").textContent=t("點選題目即可修改", "Click a question to edit");
  window.SevenLive?.reviewRendered();
}
function updateReviewStatus() {
  const version=state.project?.versions[state.activeLevel];if(!version)return;
  $("#review-approved").checked=version.approved;$("#download-button").disabled=!version.approved;
  if(!version.approved)$("#download-menu").hidden=true;
  $("#review-status").textContent=version.approved?t("已檢查 · 可以下載這個版本", "Reviewed · This version is ready to download") : Object.keys(version.edits).length ? t("已修改題目，請同步核對答案。", "Questions changed. Check the answers too.") : t("檢查完成後，即可下載。", "Download after your review.");
}
function handleEdit(el) {
  const v=state.project?.versions[state.activeLevel];if(!v)return;
  if(el.hasAttribute("data-edit"))v.edits[el.dataset.edit]=el.textContent;
  else v.answers[el.dataset.answerEdit]=el.textContent;
  v.approved=false;updateReviewStatus();
  const activeTab=$(`.review-tabs [data-review-level='${state.activeLevel}'] i`);if(activeTab)activeTab.textContent="";
  const saved=persistProject();
  $("#save-indicator").textContent=saved?t("已儲存到這部電腦", "Saved on this computer"):t("本次開啟已保留", "Kept in this session");
  window.SevenLive?.afterEdit(el);
}
function regenerate(index) {
  if (state.project?.live && window.SevenLive) { window.SevenLive.replace(index); return; }
  const v=state.project.versions[state.activeLevel];
  v.rerolls[index]=(v.rerolls[index]||0)+1;
  v.pairs[index]=[...rerollPairs[(index+v.rerolls[index]-1)%rerollPairs.length]];
  delete v.edits[index];delete v.answers[index];v.approved=false;
  persistProject();renderReview();toast(t("已更換這道示範題目。", "This sample question has been replaced."));
}
function renderLibrary() {
  const rows=[...state.library].sort((a,b)=>b.updated-a.updated);
  $("#library-list").innerHTML=rows.length?rows.map(p=>`<div class="library-row"><button class="library-open" data-open-project="${esc(p.id)}">${icon("file")}<span><strong>${esc(p.topic)}</strong><small>${t(`小${zhNumbers[p.grade]}`,`Primary ${p.grade}`)} · ${t(`${p.levels.length} 個版本`,`${p.levels.length} versions`)} · ${new Date(p.updated).toLocaleDateString(state.lang==="zh"?"zh-HK":"en-GB")}</small></span>${icon("arrow")}</button><button class="icon-button" data-delete-project="${esc(p.id)}" aria-label="${t("刪除", "Delete")} ${esc(p.topic)}">${icon("trash")}</button></div>`).join(""):`<p class="library-empty">${t("還沒有工作紙。先試試示範，製作你的第一份。", "No worksheets yet. Start with the sample.")}</p>`;
}
function openProject(id) {
  const p=state.library.find(p=>p.id===id);if(!p)return;
  state.project=p;state.selected=[...p.levels];state.baseline=p.source;state.activeLevel=p.levels.includes(p.source)?p.source:p.levels[0];state.fileName=p.fileName;state.imported=!!p.imported;state.doc="student";state.compare=false;
  $("#grade-select").value=p.grade;$("#topic").value=p.topic;$("#objective").value=p.objective;$("#content-notes").value=p.notes;$("#source-level").value=p.source;
  window.SevenLive?.projectOpened(p);
  renderSource();renderImportNotice();renderLevelPicker();renderReview();closeDialog($("#library-dialog"));setView("review");
}

document.addEventListener("click",e=>{
  const button=e.target.closest("button");if(!button || button.disabled)return;
  if(button.hasAttribute("data-close")){closeDialog(button.closest("dialog"));return;}
  if(button.dataset.example){state.example=Number(button.dataset.example);renderExample();return;}
  if(button.dataset.level){const n=Number(button.dataset.level);if(state.selected.includes(n)){if(state.selected.length===1){toast(t("請保留至少一個程度。", "Keep at least one level selected."));return;}state.selected=state.selected.filter(l=>l!==n);}else state.selected.push(n);renderLevelPicker();return;}
  if(button.dataset.preset){state.preset=Number(button.dataset.preset);renderPresets();return;}
  if(button.dataset.reviewLevel){state.activeLevel=Number(button.dataset.reviewLevel);renderReview();return;}
  if(button.dataset.document){state.doc=button.dataset.document;renderReview();return;}
  if(button.hasAttribute("data-regenerate")){regenerate(Number(button.dataset.regenerate));return;}
  if(button.dataset.openProject){openProject(button.dataset.openProject);return;}
  if(button.dataset.deleteProject){
    state.lastDeleted=state.library.find(p=>p.id===button.dataset.deleteProject);state.library=state.library.filter(p=>p.id!==button.dataset.deleteProject);
    try{localStorage.setItem(STORAGE,JSON.stringify(state.library));}catch{}
    renderLibrary();$("#library-list").insertAdjacentHTML("beforeend",`<button class="quiet" data-action="undo-delete">${t("已移除工作紙 · 復原", "Worksheet removed · Undo")}</button>`);return;
  }
  const action=button.dataset.action;
  if(action==="home"){setView("home");return;}
  if(action==="back-setup"){setView("setup");return;}
  if(action==="demo"){startSample();return;}
  if(action==="upload"){$("#file-input").click();return;}
  if(action==="settings"){showDialog("settings");return;}
  if(action==="about"){showDialog("about");return;}
  if(action==="library"){renderLibrary();showDialog("library");return;}
  if(action==="language"){state.lang=state.lang==="zh"?"en":"zh";translate();persistPreferences();return;}
  if(action==="presets"){renderPresets();showDialog("presets");return;}
  if(action==="reset-preset"){state.presets[state.preset]=defaultPreset(state.preset);renderPresets();return;}
  if(action==="save-preset"){persistPreferences();closeDialog($("#presets-dialog"));toast(t("已儲存，下次製作時套用。", "Saved for the next generation."));return;}
  if(action==="show-key"){$("#api-key").type=$("#api-key").type==="password"?"text":"password";button.textContent=$("#api-key").type==="password"?t("顯示","Show"):t("隱藏","Hide");return;}
  if(action==="forget-key"){$("#api-key").value="";$("#api-key").type="password";$("[data-action='show-key']").textContent=t("顯示","Show");return;}
  if(action==="save-settings"){
    if(!$("#workspace-id").reportValidity()||!$("#cost-limit").reportValidity())return;
    persistPreferences();closeDialog($("#settings-dialog"));return;
  }
  if(action==="compare"){state.compare=!state.compare;renderReview();return;}
  if(action==="cancel"){cancelGeneration();return;}
  if(action==="download"){$("#download-menu").hidden=!$("#download-menu").hidden;return;}
  if(action==="print"){if(!state.project?.versions[state.activeLevel].approved)return;$("#download-menu").hidden=true;window.print();return;}
  if(action==="undo-delete" && state.lastDeleted){state.library.unshift(state.lastDeleted);state.lastDeleted=null;try{localStorage.setItem(STORAGE,JSON.stringify(state.library));}catch{}renderLibrary();}
});
document.addEventListener("input",e=>{
  const el=e.target;
  if(el.hasAttribute("data-edit")||el.hasAttribute("data-answer-edit")){handleEdit(el);return;}
  if(el.dataset.presetValue){const key=el.dataset.presetValue;state.presets[state.preset][key]=Number(el.value);$(`#${key}-output`).textContent=presetLabel(key,Number(el.value));}
  if(el.dataset.modelId){state.models[el.dataset.modelId]=el.value.trim();}
  if(el.id==="workspace-id")syncEndpoint();
  if(el.id==="topic")renderSource();
});
document.addEventListener("change",e=>{
  const el=e.target;
  if(el.dataset.presetCheck)state.presets[state.preset][el.dataset.presetCheck]=el.checked;
  if(el.dataset.model){const input=$(`[data-model-id='${el.dataset.model}']`);input.hidden=el.value!=="custom";if(el.value==="auto"){input.value="";state.models[el.dataset.model]="";}else input.focus();}
  if(el.id==="source-level"){state.baseline=Number(el.value);renderLevelPicker();}
  if(el.id==="grade-select")renderSource();
  if(el.id==="extend-mode"){$("#extend-note").hidden=!el.checked;$("#generate-button").disabled=el.checked;window.SevenLive?.syncSetup();}
  if(el.id==="file-input")handleFile(el.files[0]);
  if(el.id==="review-approved" && state.project){state.project.versions[state.activeLevel].approved=el.checked;persistProject();updateReviewStatus();const tab=$(`.review-tabs [data-review-level='${state.activeLevel}'] i`);if(tab)tab.textContent=el.checked?"✓":"";}
});
$("#setup-form").addEventListener("submit",e=>{e.preventDefault();generate();});
$$('dialog').forEach(dialog=>{
  dialog.addEventListener("click",e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){if(dialog.id==="progress-dialog")cancelGeneration();else closeDialog(dialog);}});
});
$("#progress-dialog").addEventListener("cancel",e=>{e.preventDefault();cancelGeneration();});
document.addEventListener("click",e=>{if(!e.target.closest(".download-area"))$("#download-menu").hidden=true;});
const dropzone=$("#dropzone");
dropzone.addEventListener("dragover",e=>{e.preventDefault();dropzone.classList.add("dragover");});
dropzone.addEventListener("dragleave",()=>dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop",e=>{e.preventDefault();dropzone.classList.remove("dragover");handleFile(e.dataTransfer.files[0]);});
document.addEventListener("dragover",e=>e.preventDefault());
document.addEventListener("drop",e=>e.preventDefault());
$("#workspace-id").value=storedPreferences.workspace||"";
$("#fallback").checked=storedPreferences.fallback!==false;
$("#cost-limit").value=storedPreferences.cost||"1";
syncEndpoint();translate();setView("home");
