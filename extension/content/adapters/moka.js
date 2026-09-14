/* 网申助手 · Moka Adapter
 *
 * 只使用真实 Moka 网申页面（app.mokahr.com 投递页 / 简历页）确认过的结构：
 * - 字段容器：div[class*="apply-field-"]（简历页基础信息为 div[class*="field-"]）
 * - 字段标签：容器内 [class*="title-"] / [class*="filed-title-"]
 * - 区块容器：[class*="apply-block-"] / [class*="basic-block-"]，
 *   区块标题：[class*="block-title-"] / [class*="blockTitle-"]（剔除内嵌「添加」按钮文字）
 * - 重复条目：同一 apply-block 下的 apply-fields 容器即 repeater item，
 *   itemIndex 由 itemElement 在区块内 DOM 顺序决定（禁止"同名字段第 N 次出现"）
 * - 控件语义类（apply-field 上的稳定前缀）：
 *   string_info 文本 | text_info 多行 | Select-/select_info 自绘下拉
 *   date_info 年月（2 下拉）或起止年月（4 下拉 + 至今 checkbox）
 *   day_info 日历选择 | location_info/cascader 级联 | file_upload 文件 | confirm_info 声明
 * - 自绘下拉选项就地渲染在本控件容器内：[class*="option-label-"]
 * 哈希后缀（如 title-IWWQ0Xa4L7）不作为长期 identity。
 * 填对 > 少填 > 多填：不确定的控件（日历/级联）不写入，只读。
 */
(function () {
  const NS = (window.__WSZ = window.__WSZ || {});
  NS.adapterDefinitions = NS.adapterDefinitions || {};

  const APPLY_FIELD_SEL = 'div[class*="apply-field-"]';
  const BASIC_FIELD_SEL = 'div[class*="field-"]';
  const TITLE_SEL = '[class*="title-"], [class*="filed-title-"]';
  const BLOCK_SEL = '[class*="apply-block-"], [class*="basic-block-"]';
  const BLOCK_TITLE_SEL = '[class*="block-title-"], [class*="blockTitle-"]';
  const FIELDS_WRAPPER_SEL = '[class*="apply-fields-"]';
  const SELECT_COMPONENT_SEL = '[class*="sd-Select-container"]';
  const DROPDOWN_SEL = '[class*="sd-Dropdown-container"]';
  // 普通下拉选项：option-label-*；年月下拉选项：span[data-key="sugar.select.label"]
  const OPTION_SEL = '[class*="option-label-"], [data-key="sugar.select.label"]';
  const DISPLAY_VALUE_SEL = '[class*="display-value"]';
  // 远程搜索下拉（学校/专业等 string_info + sd-Select-container）的候选行；
  // 真实结构为嵌套两行（外层 sd-list-item-* / 内层 sd-Menu-*-item-*），点叶子行
  const SEARCH_OPTION_SEL = '[class*="-item-"]';
  const SEARCH_FALLBACK_RE = /没有找到|添加学校|添加专业|添加全称|手动添加|手动输入/;

  const SECTION_DEFS = [
    { label: "申请信息", key: "_flat", repeatable: false },
    { label: "校招站点", key: "_flat", repeatable: false },
    { label: "上传", key: "_flat", repeatable: false },
    { label: "基础信息", key: "_flat", repeatable: false },
    { label: "个人信息", key: "_flat", repeatable: false },
    { label: "求职意向", key: "_flat", repeatable: false },
    { label: "其他信息", key: "_flat", repeatable: false },
    { label: "自我描述", key: "_flat", repeatable: false },
    { label: "自我评价", key: "_flat", repeatable: false },
    { label: "个人评价", key: "_flat", repeatable: false },
    { label: "个人总结", key: "_flat", repeatable: false },
    { label: "声明", key: "_flat", repeatable: false },
    { label: "更新说明", key: "_flat", repeatable: false },
    { label: "工作经历", key: "work", repeatable: true },
    { label: "工作经验", key: "work", repeatable: true },
    { label: "全职工作", key: "work", repeatable: true },
    { label: "工作履历", key: "work", repeatable: true },
    { label: "实习经历", key: "internship", repeatable: true },
    { label: "实习经验", key: "internship", repeatable: true },
    { label: "项目经验", key: "project", repeatable: true },
    { label: "项目经历", key: "project", repeatable: true },
    { label: "项目实践", key: "project", repeatable: true },
    { label: "在校项目", key: "project", repeatable: true },
    { label: "教育背景", key: "education", repeatable: true },
    { label: "教育经历", key: "education", repeatable: true },
    { label: "教育信息", key: "education", repeatable: true },
    { label: "教育情况", key: "education", repeatable: true },
    { label: "学历信息", key: "education", repeatable: true },
    { label: "语言能力", key: "language", repeatable: true },
    { label: "语言水平", key: "language", repeatable: true },
    { label: "外语能力", key: "language", repeatable: true },
    { label: "外语水平", key: "language", repeatable: true },
    { label: "获奖经历", key: "award", repeatable: true },
    { label: "获奖情况", key: "award", repeatable: true },
    { label: "奖励情况", key: "award", repeatable: true },
    { label: "荣誉奖励", key: "award", repeatable: true },
    { label: "荣誉奖项", key: "award", repeatable: true },
  ];
  const SECTION_BY_LABEL = Object.fromEntries(SECTION_DEFS.map((s) => [s.label, s]));

  function docOf(context) {
    if (context && context.document) return context.document;
    return typeof document !== "undefined" ? document : null;
  }

  function locationOf(context) {
    if (context && context.location) return context.location;
    return typeof location !== "undefined" ? location : {};
  }

  function qsa(root, selector) {
    if (!root || typeof root.querySelectorAll !== "function") return [];
    try { return Array.from(root.querySelectorAll(selector)); } catch (e) { return []; }
  }

  function first(root, selector) { return qsa(root, selector)[0] || null; }

  function normalize(value) {
    return NS.normalizeLabel ? NS.normalizeLabel(value) : String(value || "").replace(/[\s*＊:：]/g, "");
  }

  function classText(element) {
    return element && typeof element.className === "string" ? element.className : "";
  }

  function isVisible(element) {
    if (!element) return false;
    try {
      if (typeof NS.isVisible === "function" && NS.isVisible(element)) return true;
    } catch (e) { /* fall through */ }
    if (element.hidden) return false;
    const style = element.style || {};
    if (style.display === "none" || style.visibility === "hidden") return false;
    return true;
  }

  function contains(parent, child) {
    return Boolean(parent && child && typeof parent.contains === "function" && parent.contains(child));
  }

  function isDisabled(el) {
    if (!el) return false;
    if (el.disabled) return true;
    try { return Boolean(el.getAttribute && el.getAttribute("disabled") != null); } catch (e) { return false; }
  }

  // 与 Core writer 一致的原生赋值（React 受控输入可感知）
  function setNativeInputValue(el, value) {
    try {
      const proto = el.tagName === "TEXTAREA"
        ? (typeof HTMLTextAreaElement !== "undefined" && HTMLTextAreaElement.prototype)
        : (typeof HTMLInputElement !== "undefined" && HTMLInputElement.prototype);
      const desc = proto && Object.getOwnPropertyDescriptor(proto, "value");
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
    } catch (e) {
      el.value = value;
    }
  }

  function closest(element, selector) {
    if (!element) return null;
    if (typeof element.closest === "function") {
      try { return element.closest(selector); } catch (e) { /* parent walk */ }
    }
    for (let current = element; current; current = current.parentElement) {
      if (typeof current.matches === "function") {
        try { if (current.matches(selector)) return current; } catch (e) { /* ignore */ }
      }
    }
    return null;
  }

  function isMokaHost(context) {
    const host = locationOf(context).hostname;
    return NS.hostMatchesPattern ? NS.hostMatchesPattern(host, "mokahr.com") : /(^|\.)mokahr\.com$/.test(String(host || "").toLowerCase());
  }

  function textOf(element) {
    if (!element) return "";
    return String(element.textContent || element.value || "").trim();
  }

  // 区块标题文字：剔除内嵌的「添加」按钮等可点元素
  function titleText(titleEl) {
    if (!titleEl) return "";
    let clone = titleEl;
    if (typeof titleEl.cloneNode === "function") {
      clone = titleEl.cloneNode(true);
      for (const junk of qsa(clone, 'button, a, [class*="add"], [class*="Add"], [class*="btn"], [class*="Btn"], svg')) junk.remove();
    }
    return normalize(textOf(clone));
  }

  // 模糊兜底规则：关键词命中 + 结构后缀白名单，排除意向/地点类干扰标题
  const FUZZY_RULES = [
    { re: /教育|学历/, key: "education" },
    { re: /实习/, key: "internship" },
    { re: /项目/, key: "project" },
    { re: /工作/, key: "work" },
    { re: /语言|外语/, key: "language" },
    { re: /获奖|荣誉|奖励/, key: "award" },
  ];
  const FUZZY_SUFFIX_RE = /(经历|经验|背景|信息|情况|实践|履历|奖励|奖项|能力|水平)$/;
  const FUZZY_EXCLUDE_RE = /意向|期望|地点|城市|年限|薪资/;

  // 精确匹配优先；长标题（如「校招站点（本次校招主要采取……）」）按前缀归并；
  // 字典未收录的变体走带护栏的关键词模糊兜底（如「教育背景信息」→ education）
  function canonicalSection(rawTitle) {
    const t = normalize(rawTitle);
    if (!t) return null;
    if (SECTION_BY_LABEL[t]) return SECTION_BY_LABEL[t];
    for (const def of SECTION_DEFS) {
      if (t.length > def.label.length && t.startsWith(def.label)) return def;
    }
    if (!FUZZY_EXCLUDE_RE.test(t) && FUZZY_SUFFIX_RE.test(t)) {
      const rule = FUZZY_RULES.find((r) => r.re.test(t));
      if (rule) return { label: t, key: rule.key, repeatable: true };
    }
    return null;
  }

  function blockOf(element) { return closest(element, BLOCK_SEL); }

  function sectionDefOf(element) {
    const block = blockOf(element);
    if (!block) return null;
    const titleEl = first(block, BLOCK_TITLE_SEL);
    return canonicalSection(titleText(titleEl));
  }

  function rawSectionOf(element) {
    const block = blockOf(element);
    if (!block) return "";
    return titleText(first(block, BLOCK_TITLE_SEL));
  }

  // ---- repeater：以真实 DOM item（apply-fields 容器）为准 ----
  function itemElementOf(container) { return closest(container, FIELDS_WRAPPER_SEL); }

  function repeaterFor(container, sectionDef) {
    if (!sectionDef || !sectionDef.repeatable) return { itemIndex: null, itemElement: null };
    const item = itemElementOf(container);
    const block = blockOf(container);
    if (!item || !block) return { itemIndex: null, itemElement: null };
    const items = qsa(block, FIELDS_WRAPPER_SEL).filter((el) => el.parentElement === block || contains(block, el));
    // 只统计与本 item 同层（直接属于该 block 的）wrapper，防止嵌套误计
    const siblings = items.filter((el) => {
      const parentBlock = closest(el.parentElement, BLOCK_SEL);
      return parentBlock === block;
    });
    const index = siblings.indexOf(item);
    return { itemIndex: index < 0 ? null : index, itemElement: item };
  }

  // ---- 控件分类：语义类优先，结构兜底 ----
  const SEMANTIC_KINDS = [
    ["file_upload", "file"],
    ["confirm_info", "checkbox"],
    ["cascader-", "cascader"],
    ["location_info", "cascader"],
    ["day_info", "day"],
    ["date_info", "month"],      // 再由下拉数量细分 date / range
    ["text_info", "textarea"],
    ["string_info", "text"],
    ["select_info", "select"],
    ["Select-", "select"],
  ];

  function semanticKind(container) {
    const cls = classText(container);
    for (const [token, kind] of SEMANTIC_KINDS) {
      if (cls.includes(token)) return kind;
    }
    return null;
  }

  function controlParts(container) {
    const all = qsa(container, "input, textarea, select").filter((el) => {
      const type = String(el.type || "").toLowerCase();
      return !["hidden", "submit", "button", "reset"].includes(type);
    });
    const selectComponents = qsa(container, SELECT_COMPONENT_SEL).filter(isVisible);
    const inSelect = (el) => selectComponents.some((c) => contains(c, el));
    const textControls = all.filter((el) => {
      const type = String(el.type || "").toLowerCase();
      if (["checkbox", "radio", "file"].includes(type)) return false;
      return !inSelect(el) && isVisible(el);
    });
    const selectControls = selectComponents.map((c) => first(c, "input") || c);
    const checkbox = all.find((el) => String(el.type || "").toLowerCase() === "checkbox") || null;
    const fileControls = all.filter((el) => String(el.type || "").toLowerCase() === "file");
    const controls = [];
    for (const el of textControls.concat(selectControls, checkbox ? [checkbox] : [], fileControls)) {
      if (!controls.includes(el)) controls.push(el);
    }
    return { controls, textControls, selectComponents, selectControls, checkbox, fileControls };
  }

  function kindOf(container, parts) {
    const sem = semanticKind(container);
    if (sem === "month") {
      // date_info：4 个下拉 = 起止年月 range；2 个 = 单点年月 date
      if (parts.selectComponents.length >= 4) return "range";
      if (parts.selectComponents.length >= 2) return "date";
      return parts.selectComponents.length === 1 ? "date" : "unknown";
    }
    if (sem) return sem;
    // 简历页基础信息等无语义类容器：按结构判断
    if (parts.fileControls.length) return "file";
    if (parts.selectComponents.length >= 4) return "range";
    if (parts.selectComponents.length >= 2) return "date";
    if (parts.selectComponents.length === 1 && !parts.textControls.length) return "select";
    if (parts.textControls.some((el) => String(el.tagName || "").toUpperCase() === "TEXTAREA")) return "textarea";
    if (parts.textControls.length) return "text";
    if (parts.checkbox && parts.controls.length <= 1) return "checkbox";
    return "unknown";
  }

  function labelOf(container) {
    const titleEl = first(container, TITLE_SEL);
    const raw = textOf(titleEl);
    const label = normalize(raw);
    if (label && label.length <= 20) return { label, rawLabel: raw.trim(), titleEl };
    const input = first(container, "input[placeholder], textarea[placeholder]");
    const ph = normalize(input && input.placeholder);
    if (ph && !["请选择", "请填写", "内容"].includes(ph) && ph.length <= 20) {
      return { label: ph, rawLabel: input.placeholder, titleEl: null };
    }
    return { label: "", rawLabel: raw.trim(), titleEl };
  }

  function requiredOf(titleEl, rawLabel) {
    if (titleEl && first(titleEl, '[class*="required"], [class*="asterisk"]')) return true;
    if (/[*＊]/.test(rawLabel || "")) return true;
    return null;
  }

  function isFieldContainer(el) {
    const cls = classText(el);
    if (/apply-fields-|fields-wrapper/i.test(cls)) return false;
    if (!qsa(el, "input, textarea, select").length && !first(el, SELECT_COMPONENT_SEL)) return false;
    // 嵌套时只取最小容器
    for (const inner of qsa(el, APPLY_FIELD_SEL)) {
      if (inner !== el && (qsa(inner, "input, textarea, select").length || first(inner, SELECT_COMPONENT_SEL))) return false;
    }
    return true;
  }

  function fieldContainers(doc) {
    const apply = qsa(doc, APPLY_FIELD_SEL).filter(isFieldContainer);
    // 简历页基础信息：field-* 但不属于任何 apply-field
    const basic = qsa(doc, BASIC_FIELD_SEL).filter((el) => {
      if (closest(el, APPLY_FIELD_SEL)) return false;
      return isFieldContainer(el);
    });
    const seen = new Set();
    return apply.concat(basic).filter((el) => {
      if (seen.has(el)) return false;
      seen.add(el);
      return isVisible(el);
    });
  }

  function formEvidence(context) {
    const doc = docOf(context);
    const hasApplyFields = Boolean(doc && typeof doc.querySelector === "function" && doc.querySelector(APPLY_FIELD_SEL + " " + 'input, ' + APPLY_FIELD_SEL + " textarea"));
    const hasSdComponents = Boolean(doc && typeof doc.querySelector === "function" && doc.querySelector(SELECT_COMPONENT_SEL));
    const hasBlocks = Boolean(doc && typeof doc.querySelector === "function" && doc.querySelector(BLOCK_SEL));
    let status = "MOKA_UNCERTAIN";
    if (isMokaHost(context) && !(hasApplyFields && hasBlocks)) status = "MOKA_NON_FORM";
    else if (isMokaHost(context) && hasApplyFields && hasBlocks) status = "MOKA_FORM_CONFIRMED";
    return { status, evidence: { hasApplyFields, hasSdComponents, hasBlocks } };
  }

  function descriptorFor(container, context) {
    const parts = controlParts(container);
    const { label, rawLabel, titleEl } = labelOf(container);
    const def = sectionDefOf(container);
    const kind = kindOf(container, parts);
    const repeater = repeaterFor(container, def);
    const sectionKey = def && def.key !== "_flat" ? def.key : null;
    // 远程搜索下拉：语义为 string_info，但输入框在 sd-Select-container 内（学校/专业等）
    const searchCombo = kind === "text" && parts.selectComponents.length === 1 && parts.textControls.length === 0;
    // 全部控件被页面禁用（基础信息 姓名/手机/邮箱为账号级只读）：不判为填写失败，转人工
    const allDisabled = parts.controls.length > 0 && parts.controls.every(isDisabled);
    const manualOnly = kind === "file" || kind === "cascader" || kind === "day" || allDisabled;
    return {
      provider: "moka",
      section: def ? def.label : rawSectionOf(container),
      sectionKey,
      repeater,
      identity: { sectionKey, itemIndex: repeater.itemIndex, fieldKey: label },
      label,
      rawLabel: rawLabel || label,
      kind: kind === "cascader" || kind === "day" ? "unknown" : kind,
      mokaKind: kind,
      container,
      controls: parts.controls,
      required: requiredOf(titleEl, rawLabel),
      confidence: kind === "unknown" ? 0.25 : 0.95,
      confidenceReason: "真实页面确认的 apply-field / 语义类 / 区块结构",
      textControls: parts.textControls,
      selectComponents: parts.selectComponents,
      selectControls: parts.selectControls,
      checkbox: parts.checkbox,
      fileControls: parts.fileControls,
      searchCombo,
      manualOnly,
      safetyRole: kind === "file" ? "file" : null,
    };
  }

  // 声明/更新说明（confirm_info）：manual-only
  function declarationPatch(field) {
    return Object.assign(field, {
      manualOnly: true,
      safetyRole: "declaration",
      confidenceReason: "真实页面确认的 confirm_info 声明控件",
    });
  }

  function safetyDescriptor(label, section, kind, element, extra) {
    return Object.assign({
      provider: "moka",
      section,
      sectionKey: null,
      repeater: { itemIndex: null, itemElement: null },
      identity: { sectionKey: null, itemIndex: null, fieldKey: label },
      label,
      rawLabel: label,
      kind,
      container: element,
      controls: element ? [element] : [],
      required: false,
      confidence: 0.95,
      confidenceReason: "真实页面确认的安全边界控件",
      manualOnly: true,
    }, extra || {});
  }

  function submitDescriptor(doc, covered) {
    const button = qsa(doc, 'button, [role="button"], input[type="submit"]').find((el) => {
      if (covered.has(el) || !isVisible(el)) return false;
      return /^(保存|提交|提交申请|预览并提交|确认提交)$/.test(normalize(textOf(el)));
    });
    if (!button) return null;
    covered.add(button);
    return safetyDescriptor(normalize(textOf(button)), "提交", "unknown", button, { safetyRole: "submit" });
  }

  // 简历页的「同步更新在线简历」类入口：禁止自动处理
  function syncDescriptor(doc, covered) {
    const candidates = qsa(doc, 'button, [role="button"], a, span, div').filter((el) => {
      if (covered.has(el) || !isVisible(el)) return false;
      const t = normalize(textOf(el));
      return t.length <= 20 && /同步.*简历|更新在线简历|重新解析/.test(t);
    });
    if (!candidates.length) return null;
    // 取文字最短（最内层）的候选，避免框住整段区块标题
    const button = candidates.sort((a, b) => normalize(textOf(a)).length - normalize(textOf(b)).length)[0];
    covered.add(button);
    return safetyDescriptor(normalize(textOf(button)), "同步简历", "unknown", button, { safetyRole: "sync" });
  }

  function captchaDescriptor(doc, covered) {
    const input = qsa(doc, "input").find((el) => {
      if (covered.has(el)) return false;
      const hint = normalize(`${el.placeholder || ""} ${textOf(el.parentElement)}`);
      return hint.includes("验证码");
    });
    if (!input) return null;
    covered.add(input);
    return safetyDescriptor("验证码", "安全校验", "unknown", input, { safetyRole: "captcha" });
  }

  // ---- 值读取 ----
  function shownTextOfComponent(component) {
    const dv = first(component, DISPLAY_VALUE_SEL);
    const text = normalize(textOf(dv));
    if (text && !/^(请选择|请填写|选择)$/.test(text)) return text;
    return "";
  }

  function readSelect(field) {
    const component = field.selectComponents && field.selectComponents[0];
    if (!component) return "";
    return shownTextOfComponent(component);
  }

  function normalizeYM(value) {
    if (NS.parseYearMonth) {
      const p = NS.parseYearMonth(value);
      if (p) return `${p.y}.${String(p.m).padStart(2, "0")}`;
    }
    return normalize(value);
  }

  function readYearMonth(component) {
    return shownTextOfComponent(component);
  }

  function readControl(field) {
    if (!field) return undefined;
    const kind = field.mokaKind || field.kind;
    if (kind === "text" || kind === "textarea") {
      // 搜索下拉：已提交的值在 display-value 里，输入框只是过滤盒
      if (field.searchCombo && field.selectComponents && field.selectComponents[0]) {
        const shown = shownTextOfComponent(field.selectComponents[0]);
        if (shown) return shown;
      }
      const input = (field.textControls && field.textControls[0]) || (field.selectControls && field.selectControls[0]);
      return input ? String(input.value || "").trim() : "";
    }
    if (kind === "select") return readSelect(field);
    if (kind === "date") {
      const parts = (field.selectComponents || []).map(readYearMonth);
      const y = parts[0] || "";
      const m = parts[1] || "";
      return y ? (m ? normalizeYM(`${y}.${m}`) : y) : "";
    }
    if (kind === "range") {
      const parts = (field.selectComponents || []).map(readYearMonth);
      const start = parts[0] ? (parts[1] ? normalizeYM(`${parts[0]}.${parts[1]}`) : parts[0]) : "";
      const forever = Boolean(field.checkbox && field.checkbox.checked);
      let end = "";
      if (forever) end = "至今";
      else if (parts[2]) end = parts[3] ? normalizeYM(`${parts[2]}.${parts[3]}`) : parts[2];
      // Core 的「已有值」判断基于字符串：空 range 若返回对象会被 String() 成
      // "[object Object]" 而永远误判已有值导致跳过——空值必须返回空串
      if (!start && !end) return "";
      return { start, end };
    }
    if (kind === "day") {
      const input = field.controls && field.controls[0];
      return input ? String(input.value || "").trim() : "";
    }
    if (kind === "cascader") {
      const tag = first(field.container, '[class*="tag"], ' + DISPLAY_VALUE_SEL);
      return normalize(textOf(tag)) || readSelect(field);
    }
    if (kind === "checkbox") return Boolean(field.checkbox && field.checkbox.checked);
    if (kind === "file") return Boolean((field.fileControls || []).some((f) => f.files && f.files.length));
    return undefined;
  }

  // ---- 写入 ----
  function dispatchClick(element) {
    if (!element || typeof element.click !== "function") return false;
    try {
      if (typeof MouseEvent !== "undefined" && element.dispatchEvent) element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    } catch (e) { /* click 才是关键动作 */ }
    element.click();
    return true;
  }

  function closePopup(context, scope) {
    try {
      const doc = docOf(context);
      const active = doc && doc.activeElement;
      if (active && active.dispatchEvent && typeof KeyboardEvent !== "undefined") {
        active.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      }
    } catch (e) { /* 不点 body，避免影响其他字段 */ }
  }

  // 选项就地渲染在被点开组件的容器内——只在 scope 内找，绝不动别的控件的弹层。
  // 唯一精确候选才点击；0 个或多个同名候选一律放弃。
  async function pickOption(scope, wantText, context) {
    const want = normalize(wantText);
    if (!want) return false;
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const options = qsa(scope, OPTION_SEL).filter(isVisible);
      const matches = options.filter((o) => normalize(textOf(o)) === want);
      if (matches.length === 1) return dispatchClick(matches[0]);
      if (matches.length > 1) return false;
      if (NS.sleep) await NS.sleep(60);
      else await new Promise((r) => setTimeout(r, 60));
    }
    return false;
  }

  // 打开下拉：点击组件，等待选项出现
  async function openSelect(component, context) {
    if (!dispatchClick(component)) return false;
    if (NS.sleep) await NS.sleep(120);
    return true;
  }

  // 输入过滤后重试（不提交输入，只缩小候选——年月虚拟列表必须走这条路）
  async function filterAndPick(component, scope, want, context) {
    const input = first(component, "input");
    if (!input) return false;
    if (input.readOnly) return false;
    try {
      if (input.getAttribute && input.getAttribute("readonly") != null) return false;
    } catch (e) { /* getAttribute 不可用时按可输入处理 */ }
    try {
      input.focus && input.focus();
      input.value = String(want);
      if (NS.emitInputEvents) NS.emitInputEvents(input);
      if (NS.sleep) await NS.sleep(250);
      return await pickOption(scope, want, context);
    } catch (e) {
      return false;
    }
  }

  // 单个下拉组件的完整写入：打开 -> 直接点选 -> 输入过滤点选 -> 失败收起
  async function writeSelectComponent(component, wantText, context) {
    if (!component) return false;
    const want = NS.toOptionText ? NS.toOptionText((context && context.merged) || {}, wantText) : wantText;
    if (!(await openSelect(component, context))) return false;
    const scope = closest(component, DROPDOWN_SEL) || component;
    let ok = await pickOption(scope, want, context);
    if (!ok) ok = await filterAndPick(component, scope, want, context);
    if (!ok) closePopup(context, scope);
    return ok;
  }

  async function writeSelect(field, value, context) {
    const component = field.selectComponents && field.selectComponents[0];
    return writeSelectComponent(component, value, context || {});
  }

  // 远程搜索下拉（学校/专业）：键入 -> 服务端检索 -> 唯一精确叶子行才点击。
  // 找不到候选时清掉已键入文本并诚实失败（不提交自由文本，避免脏数据）。
  async function writeSearchCombo(field, value, context) {
    const component = field.selectComponents && field.selectComponents[0];
    const input = (field.controls && field.controls[0]) || (component && first(component, "input"));
    if (!component || !input || isDisabled(input)) return false;
    const want = String(value || "").trim();
    if (!want) return false;
    const scope = closest(component, DROPDOWN_SEL) || field.container || component;
    const cleanup = () => {
      try { setNativeInputValue(input, ""); if (NS.emitInputEvents) NS.emitInputEvents(input); } catch (e) { /* ignore */ }
      closePopup(context, scope);
    };
    try {
      input.scrollIntoView && input.scrollIntoView({ block: "center" });
      input.focus && input.focus();
      // Moka 检索对完整键序列敏感：补 keydown/keyup，不能只发 input
      input.dispatchEvent && input.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
      dispatchClick(input);
      setNativeInputValue(input, want);
      if (NS.emitInputEvents) NS.emitInputEvents(input);
      input.dispatchEvent && input.dispatchEvent(new KeyboardEvent("keyup", { key: "x", bubbles: true }));
    } catch (e) {
      cleanup();
      return false;
    }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const rows = qsa(scope, SEARCH_OPTION_SEL).filter((el) => isVisible(el)
        && normalize(textOf(el)) === normalize(want)
        && !SEARCH_FALLBACK_RE.test(textOf(el)));
      const leaves = rows.filter((r) => !rows.some((o) => o !== r && contains(r, o)));
      if (leaves.length > 1) { cleanup(); return false; } // 同名多候选不猜
      if (leaves.length === 1) {
        if (!dispatchClick(leaves[0])) { cleanup(); return false; }
        if (NS.sleep) await NS.sleep(120);
        if (shownTextOfComponent(component) === normalize(want)) return true;
        cleanup();
        return false;
      }
      if (NS.sleep) await NS.sleep(120);
      else await new Promise((r) => setTimeout(r, 120));
    }
    cleanup();
    return false;
  }

  async function writeYearMonthPair(components, ym, context) {
    const p = NS.parseYearMonth ? NS.parseYearMonth(ym) : null;
    if (!p || components.length < 2) return false;
    for (const [i, v] of [[0, p.y], [1, p.m]]) {
      const ok = await writeSelectComponent(components[i], v, context);
      if (!ok) return false;
      if (NS.sleep) await NS.sleep(60);
    }
    return true;
  }

  async function writeRange(field, value, context) {
    const components = field.selectComponents || [];
    if (components.length < 2) return false;
    if (!(await writeYearMonthPair(components.slice(0, 2), value.start, context))) return false;
    if (NS.isForever && NS.isForever(value.end)) {
      if (field.checkbox && !field.checkbox.checked) {
        field.checkbox.click();
        if (NS.emitInputEvents) NS.emitInputEvents(field.checkbox);
      }
      return true;
    }
    if (components.length < 4) return false;
    return writeYearMonthPair(components.slice(2, 4), value.end, context);
  }

  function verifyControl(field, value, context) {
    const actual = context && Object.prototype.hasOwnProperty.call(context, "actual") ? context.actual : readControl(field);
    if (actual === undefined || actual === null) return false;
    const kind = (context && context.kind) || field.mokaKind || field.kind;
    if (kind === "text" || kind === "textarea") return String(actual).trim() === String(value).trim();
    if (kind === "select") {
      const want = NS.toOptionText ? NS.toOptionText((context && context.merged) || {}, value) : value;
      return normalize(actual) === normalize(want);
    }
    if (kind === "date") return normalizeYM(actual) === normalizeYM(value);
    if (kind === "range") {
      if (!actual || typeof actual !== "object") return false;
      const startOk = normalizeYM(actual.start || "") === normalizeYM(value.start || "");
      const endOk = (NS.isForever && NS.isForever(value.end))
        ? actual.end === "至今"
        : normalizeYM(actual.end || "") === normalizeYM(value.end || "");
      return startOk && endOk;
    }
    if (kind === "checkbox") return Boolean(actual) === Boolean(value);
    return false;
  }

  // ---- 清空 ----
  async function clearSelectComponent(component, context) {
    if (!component) return false;
    if (!shownTextOfComponent(component)) return true;
    // 真实页面确认：清除按钮（×）hover 才渲染（sd-Input-clear-*）
    try {
      if (component.dispatchEvent && typeof MouseEvent !== "undefined") {
        component.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        component.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      }
    } catch (e) { /* hover 只为唤起清除按钮 */ }
    if (NS.sleep) await NS.sleep(100);
    // Moka sd-Select 有值且 hover 时出现清除按钮（×）；找不到就诚实失败
    const target = qsa(component, '[class*="clear"], [class*="Clear"]').find(isVisible);
    if (!target || !dispatchClick(target)) return false;
    if (NS.sleep) await NS.sleep(80);
    return !shownTextOfComponent(component);
  }

  const moka = {
    key: "moka",
    capabilities: {
      // 「添加」按钮定位与点击-重扫链路已在真实页面验证（教育/工作/实习/项目/获奖/语言 同构）
      addItem: {
        education: true, work: true, internship: true, project: true,
        award: true, language: true,
      },
    },

    getFormState(context) {
      return formEvidence(context || {});
    },

    scanFields(context) {
      const ctx = context || {};
      if (!isMokaHost(ctx)) return undefined; // 非 Moka 页面：交回 Generic
      const state = formEvidence(ctx);
      if (state.status !== "MOKA_FORM_CONFIRMED") return [];
      const doc = docOf(ctx);
      const fields = [];
      const covered = new Set();
      for (const container of fieldContainers(doc)) {
        covered.add(container);
        for (const c of qsa(container, "input, textarea, select")) covered.add(c);
        let field = descriptorFor(container, ctx);
        if (field.mokaKind === "checkbox" && field.kind === "checkbox" && /声明|确认|承诺|更新说明/.test(field.section + field.label)) {
          field = declarationPatch(field);
        }
        fields.push(field);
      }
      const submit = submitDescriptor(doc, covered);
      if (submit) fields.push(submit);
      const sync = syncDescriptor(doc, covered);
      if (sync) fields.push(sync);
      const captcha = captchaDescriptor(doc, covered);
      if (captcha) fields.push(captcha);
      return fields;
    },

    getFieldContainers(context) {
      return fieldContainers(docOf(context));
    },

    getSection(container, context) {
      const field = context && context.field;
      if (field && field.safetyRole) return { section: field.section || "", sectionKey: "_flat" };
      const def = sectionDefOf(container);
      if (!def) return { section: (field && field.section) || rawSectionOf(container), sectionKey: (field && field.sectionKey) || null };
      return { section: def.label, sectionKey: def.key };
    },

    getRepeaterItem(container, context) {
      const field = context && context.field;
      if (field && field.safetyRole) return { itemIndex: null, itemElement: null };
      const def = sectionDefOf(container);
      return repeaterFor(container, def);
    },

    classifyControl(field) {
      return (field && (field.mokaKind || field.kind)) || "unknown";
    },

    readControl(field) {
      return readControl(field);
    },

    captureControl(field) {
      return readControl(field);
    },

    async writeControl(field, value, context) {
      if (!field || field.manualOnly || field.safetyRole) return false;
      const kind = (context && context.kind) || field.mokaKind || field.kind;
      if (kind === "text" && field.searchCombo) return writeSearchCombo(field, value, context || {});
      if (kind === "text" || kind === "textarea" || kind === "checkbox") {
        return Boolean(NS.writeControlCore && await NS.writeControlCore(field, value, Object.assign({}, context || {}, { kind })));
      }
      if (kind === "select") return writeSelect(field, value, context || {});
      if (kind === "date") return writeYearMonthPair((field.selectComponents || []).slice(0, 2), value, context || {});
      if (kind === "range") return writeRange(field, value, context || {});
      // day / cascader / file / unknown：不确定，不写入
      return false;
    },

    verifyControl(field, value, context) {
      return verifyControl(field, value, context || {});
    },

    async clearControl(field, context) {
      if (!field || field.manualOnly || field.safetyRole) return false;
      const kind = (context && context.kind) || field.mokaKind || field.kind;
      if (kind === "text" && field.searchCombo) return clearSelectComponent(field.selectComponents && field.selectComponents[0], context || {});
      if (kind === "text" || kind === "textarea" || kind === "checkbox") {
        return Boolean(NS.clearControlCore && await NS.clearControlCore(field, Object.assign({}, context || {}, { kind })));
      }
      if (kind === "select") return clearSelectComponent(field.selectComponents && field.selectComponents[0], context || {});
      if (kind === "date" || kind === "range") {
        let ok = true;
        for (const component of field.selectComponents || []) {
          if (!(await clearSelectComponent(component, context || {}))) ok = false;
        }
        if (field.checkbox && field.checkbox.checked) {
          field.checkbox.click();
          if (NS.emitInputEvents) NS.emitInputEvents(field.checkbox);
        }
        return ok;
      }
      return false;
    },

    // 「添加」按钮：定位到对应区块标题行内、文字含「添加」的最深可点元素
    findAddButton(section, context) {
      const label = typeof section === "string" ? section : (section && section.label) || "";
      if (!label) return null;
      // 允许传 sectionKey（如 "education"）或区块标题（如 "教育背景"）
      const def = SECTION_BY_LABEL[normalize(label)] || SECTION_DEFS.find((d) => d.key === normalize(label));
      return findAddButtonForSection(def || { label, key: null }, context || {});
    },

    // 条目补齐：快照条数 > 页面条数的 repeater 区块，逐次点击「添加」。
    // 返回点击次数；调用方负责在 >0 时重新扫描。不支持的区块/找不到按钮诚实跳过。
    async ensureItemCount(fields, snapshot, context) {
      const ctx = context || {};
      if (!docOf(ctx) || !snapshot || typeof snapshot !== "object") return 0;
      const have = {};
      for (const f of fields || []) {
        const key = f.sectionKey;
        if (!key || key === "_flat" || !moka.capabilities.addItem[key]) continue;
        const idx = f.repeater && Number.isInteger(f.repeater.itemIndex) ? f.repeater.itemIndex : 0;
        have[key] = Math.max(have[key] || 0, idx + 1);
      }
      let clicked = 0;
      const processedKeys = new Set(); // 同义标题共享 key，每个区块只补一次
      for (const def of SECTION_DEFS) {
        if (!def.repeatable || !moka.capabilities.addItem[def.key]) continue;
        if (processedKeys.has(def.key)) continue;
        processedKeys.add(def.key);
        const need = Array.isArray(snapshot[def.key]) ? snapshot[def.key].length : 0;
        const gap = need - (have[def.key] || 0);
        if (gap <= 0) continue;
        const btn = findAddButtonForSection(def, ctx);
        if (!btn) continue;
        for (let i = 0; i < gap; i++) {
          dispatchClick(btn);
          clicked++;
          if (NS.sleep) await NS.sleep(400);
        }
      }
      return clicked;
    },
  };

  // 区块标题行内的「添加」按钮（剔除标题文本自身，取最深层匹配元素）
  // 同义标题按 sectionKey 比较（「教育信息」与「教育背景」同属 education）；
  // 无法归并的标题回退按原始文字比较
  function findAddButtonForSection(want, context) {
    const doc = docOf(context);
    if (!doc) return null;
    for (const block of qsa(doc, BLOCK_SEL)) {
      const titleEl = first(block, BLOCK_TITLE_SEL);
      const def = canonicalSection(titleText(titleEl));
      if (!def) continue;
      const same = want.key && def.key !== "_flat" ? def.key === want.key : def.label === want.label;
      if (!same) continue;
      const cands = qsa(titleEl, "button, a, span, div").filter((el) => isVisible(el) && /添加/.test(textOf(el)));
      const leaves = cands.filter((c) => !cands.some((o) => o !== c && contains(c, o)));
      if (leaves.length) return leaves[0];
    }
    return null;
  }

  NS.mokaFormState = formEvidence;
  NS.adapterDefinitions.moka = moka;
})();
