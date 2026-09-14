/* 网申助手 · 北森 Adapter
 *
 * 这份实现只使用真实北森样本中确认过的结构：
 * .form-item / .form-item__text / .form-item__control 以及 Phoenix 组件的
 * 语义 class。随机生成的 group id、客户名称、职位 id 和 hash class 不参与
 * 字段 identity。没有被确认的控件仍返回 unknown/manual。
 */
(function () {
  const NS = (window.__WSZ = window.__WSZ || {});
  NS.adapterDefinitions = NS.adapterDefinitions || {};

  const FORM_GROUP_SELECTOR = "div.form";
  const FORM_ITEM_SELECTOR = ".form-item";
  const SELECT_SELECTOR = ".phoenix-select";
  const RADIO_ITEM_SELECTOR = ".phoenix-radio-group__radioItem";
  const DATE_LABELS = new Set(["出生日期", "出生年月", "开始时间", "结束时间", "获奖时间", "获得时间"]);
  const SECTION_DEFS = [
    { label: "个人信息", key: "_flat", repeatable: false },
    { label: "求职意向", key: "_flat", repeatable: false },
    { label: "上传简历", key: "_flat", repeatable: false },
    { label: "教育经历", key: "education", repeatable: true },
    { label: "实习经历", key: "internship", repeatable: true },
    { label: "项目经历", key: "project", repeatable: true },
    { label: "工作经历", key: "work", repeatable: true },
    { label: "获奖情况", key: "award", repeatable: true },
    { label: "技能", key: "skills", repeatable: true },
    { label: "证书", key: "certificates", repeatable: true },
    { label: "语言能力", key: "language", repeatable: true },
    { label: "声明", key: "_flat", repeatable: false },
    { label: "提交", key: "_flat", repeatable: false },
  ];
  const SECTION_BY_LABEL = Object.fromEntries(SECTION_DEFS.map((item) => [item.label, item]));

  // Beisen exposes more than one generated form profile. The suffixes below
  // are platform module names observed in real forms, not customer or job
  // identifiers. Keep the allow-list narrow so an unrelated div.form does not
  // become a business group by accident.
  const PROFILE_B_MODULES = [
    { marker: "Recruitment_PersonProfilePerfectResumeDefaultForm", section: "个人信息" },
    { marker: "Recruitment_ApplicantObjectivePerfectResumeDefaultForm", section: "求职意向" },
    { marker: "Recruitment_ApplicantEducationPerfectResumeDefaultForm", section: "教育经历" },
    { marker: "Recruitment_ApplicantWorkExperiencePerfectResumeDefaultForm", section: "工作经历" },
    { marker: "Recruitment_ApplicantProjectPerfectResumeDefaultForm", section: "项目经历" },
  ];

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

  function first(root, selector) {
    const values = qsa(root, selector);
    return values[0] || null;
  }

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
    } catch (e) { /* fall through to the conservative local check */ }
    if (element.hidden) return false;
    const style = element.style || {};
    if (style.display === "none" || style.visibility === "hidden") return false;
    return true;
  }

  function hostMatches(host, pattern) {
    if (typeof NS.hostMatchesPattern === "function") return NS.hostMatchesPattern(host, pattern);
    const h = String(host || "").toLowerCase().replace(/\.$/, "");
    const p = String(pattern || "").toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
    return Boolean(h && p) && (h === p || h.endsWith("." + p));
  }

  function isBeisenHost(context) {
    const host = locationOf(context).hostname;
    return ["zhiye.com", "italent.cn", "beisen.com"].some((pattern) => hostMatches(host, pattern));
  }

  function textOf(element) {
    if (!element) return "";
    return String(element.textContent || element.value || "").trim();
  }

  function exactSection(value) {
    const label = normalize(value);
    return SECTION_BY_LABEL[label] ? label : "";
  }

  function contains(parent, child) {
    return Boolean(parent && child && typeof parent.contains === "function" && parent.contains(child));
  }

  function closest(element, selector) {
    if (!element) return null;
    if (typeof element.closest === "function") {
      try { return element.closest(selector); } catch (e) { /* use the parent walk */ }
    }
    for (let current = element; current; current = current.parentElement) {
      if (typeof current.matches === "function") {
        try { if (current.matches(selector)) return current; } catch (e) { /* ignore */ }
      }
    }
    return null;
  }

  function profileForGroup(element) {
    if (!element || String(element.tagName || "").toUpperCase() !== "DIV") return null;
    const classes = classText(element).split(/\s+/).filter(Boolean);
    if (!classes.includes("form")) return null;
    const id = String(element.id || "");
    if (id.includes("Recruitment_extPerfect")) return { key: "extPerfect", sectionHint: "" };
    const module = PROFILE_B_MODULES.find((item) => id.includes(item.marker));
    return module ? { key: "perfectResumeDefault", sectionHint: module.section, marker: module.marker } : null;
  }

  function groupOf(element) {
    for (let current = element; current; current = current.parentElement) {
      if (profileForGroup(current)) return current;
    }
    return null;
  }

  function allGroups(doc) {
    return qsa(doc, FORM_GROUP_SELECTOR)
      .filter((element) => Boolean(profileForGroup(element)))
      .filter((element, index, all) => all.indexOf(element) === index);
  }

  // The section title is a sibling of the generated form subtree. Search the
  // nearest ancestor first; never use the customer name or a random group id.
  function sectionTitleForGroup(group) {
    if (!group) return "";
    for (let parent = group.parentElement, depth = 0; parent && depth < 10; parent = parent.parentElement, depth++) {
      const direct = parent.children ? Array.from(parent.children) : [];
      // Prefer a direct sibling title. Profile B puts the title next to the
      // ux-standard-form wrapper; Profile A may put it directly next to the
      // form. This relation is more stable than hashed CSS-module classes.
      for (const candidate of direct) {
        if (candidate === group || contains(group, candidate)) continue;
        const section = exactSection(textOf(candidate));
        if (section) return section;
      }
      // Some Profile A pages wrap the title one level below the section shell.
      // Keep this fallback scoped to the current ancestor and never use a
      // title contained by another generated group.
      const nested = qsa(parent, "*").filter((candidate) => {
        if (candidate === group || contains(group, candidate) || contains(candidate, group)) return false;
        return Boolean(exactSection(textOf(candidate)));
      });
      if (nested.length) return exactSection(textOf(nested[0]));
    }
    return (profileForGroup(group) || {}).sectionHint || "";
  }

  function sectionTitleForElement(element) {
    const group = groupOf(element);
    if (group) return sectionTitleForGroup(group);
    for (let parent = element && element.parentElement, depth = 0; parent && depth < 8; parent = parent.parentElement, depth++) {
      const section = exactSection(textOf(parent));
      if (section) return section;
      const candidate = qsa(parent, "*").map((el) => exactSection(textOf(el))).find(Boolean);
      if (candidate) return candidate;
    }
    return "";
  }

  function sectionInfoForElement(element) {
    const section = sectionTitleForElement(element);
    const definition = SECTION_BY_LABEL[section];
    return {
      section,
      sectionKey: definition ? definition.key : null,
      group: groupOf(element),
    };
  }

  function controlAvailable(element) {
    if (isVisible(element)) return true;
    // Phoenix uploads keep the real file input hidden inside a visible uploader.
    if (element && String(element.type || "").toLowerCase() === "file") {
      return isVisible(closest(element, ".form-item")) || isVisible(element.parentElement);
    }
    return false;
  }

  function directTextControls(item) {
    return qsa(item, "input, textarea").filter((element) => {
      const type = String(element.type || "").toLowerCase();
      if (["hidden", "file", "checkbox", "radio", "submit", "button", "reset"].includes(type)) return false;
      if (closest(element, SELECT_SELECTOR)) return false;
      return controlAvailable(element);
    });
  }

  function controlParts(item) {
    const fileControls = qsa(item, 'input[type="file"]').filter(controlAvailable);
    const checkboxControls = qsa(item, 'input[type="checkbox"]').filter(controlAvailable);
    const radioControls = qsa(item, RADIO_ITEM_SELECTOR).filter(controlAvailable);
    const selectComponents = qsa(item, SELECT_SELECTOR).filter(isVisible);
    const selectControls = selectComponents.map((component) => first(component, ".phoenix-select__input") || component);
    const textControls = directTextControls(item);
    let controls = [];
    controls = controls.concat(textControls, selectControls, radioControls, checkboxControls, fileControls);
    if (!controls.length) {
      const controlWrapper = first(item, ".form-item__control");
      if (controlWrapper) controls.push(controlWrapper);
    }
    return {
      controls: controls.filter((element, index, all) => all.indexOf(element) === index),
      textControls,
      selectComponents,
      selectControls,
      radioControls,
      checkbox: checkboxControls[0] || null,
      fileControls,
    };
  }

  function itemLabel(item) {
    const labelNode = first(item, ".form-item__text") || first(item, ".form-item__title");
    const titleNode = first(item, ".form-item__title");
    const label = normalize(textOf(labelNode));
    const rawLabel = textOf(titleNode || labelNode) || label;
    return { label, rawLabel, titleNode };
  }

  function requiredOf(titleNode, rawLabel) {
    if (Boolean(titleNode && /required/i.test(classText(titleNode))) || /[*＊]/.test(rawLabel || "")) return true;
    // The sample exposes some required state through AX/CSS behavior rather
    // than a stable DOM attribute. Do not convert that absence into false.
    return null;
  }

  function kindOf(label, parts, section) {
    if (parts.fileControls.length) return "file";
    if (parts.radioControls.length) return "radio";
    if (parts.checkbox && parts.controls.length === 1) return "checkbox";
    if (parts.textControls.some((element) => String(element.tagName || "").toUpperCase() === "TEXTAREA")) return "textarea";
    if (parts.selectControls.length && !parts.textControls.length) {
      // `籍贯` is a provider-confirmed area selector, not an ordinary Phoenix
      // option list. Keep the special kind scoped to this exact flat field.
      if (normalize(section) === "个人信息" && normalize(label) === "籍贯") return "search-select";
      // Date is the semantic field kind. The actual picker variant is derived
      // only after opening the current control's popup (see dateVariantOf).
      return DATE_LABELS.has(normalize(label)) ? "date" : "select";
    }
    if (parts.textControls.length) return parts.textControls.some((element) => String(element.tagName || "").toUpperCase() === "TEXTAREA") ? "textarea" : "text";
    return "unknown";
  }

  function groupsForSection(doc, section) {
    return allGroups(doc).filter((group) => sectionTitleForGroup(group) === section);
  }

  function repeaterFor(element, context, sectionInfo) {
    const group = sectionInfo.group || groupOf(element);
    const requestedSectionKey = context && context.sectionKey;
    if (requestedSectionKey && requestedSectionKey !== sectionInfo.sectionKey) {
      return { itemIndex: null, itemElement: null };
    }
    const sectionKey = requestedSectionKey || sectionInfo.sectionKey;
    const definition = SECTION_BY_LABEL[sectionInfo.section];
    if (!group || !definition || !definition.repeatable || !sectionKey || sectionKey === "_flat") {
      return { itemIndex: null, itemElement: null };
    }
    const doc = docOf(context);
    const groups = groupsForSection(doc, sectionInfo.section);
    if (!groups.includes(group)) return { itemIndex: null, itemElement: null };
    const itemIndex = groups.indexOf(group);
    if (itemIndex < 0) return { itemIndex: null, itemElement: null };
    return { itemIndex, itemElement: group };
  }

  function descriptorForItem(item, context) {
    const labels = itemLabel(item);
    const parts = controlParts(item);
    const info = sectionInfoForElement(item);
    const repeater = repeaterFor(item, context, info);
    const kind = kindOf(labels.label, parts, info.section);
    const itemIndex = repeater.itemIndex == null ? null : repeater.itemIndex;
    const descriptor = {
      provider: "beisen",
      section: info.section,
      sectionKey: info.sectionKey === "_flat" ? null : info.sectionKey,
      repeater,
      identity: { sectionKey: info.sectionKey === "_flat" ? null : info.sectionKey, itemIndex, fieldKey: labels.label },
      label: labels.label,
      rawLabel: labels.rawLabel,
      kind,
      container: item,
      controls: parts.controls,
      required: requiredOf(labels.titleNode, labels.rawLabel),
      confidence: kind === "unknown" ? 0.25 : 0.95,
      confidenceReason: "真实样本确认的 .form-item / label / control 结构",
      manualOnly: kind === "file",
      manualReason: kind === "file" ? "文件控件仅允许手动上传" : undefined,
      textControls: parts.textControls,
      selectComponents: parts.selectComponents,
      selectControls: parts.selectControls,
      radioControls: parts.radioControls,
      checkbox: parts.checkbox,
      fileControls: parts.fileControls,
    };
    if (kind === "search-select" && info.section === "个人信息" && labels.label === "籍贯") {
      descriptor.controlVariant = "area-selector";
    }
    if (kind === "radio" && info.section === "个人信息" && labels.label === "是否全日制") {
      // This is a provider default, not a Schema/global alias. It is only
      // offered when the exact real-form field is empty and remains subject to
      // the normal existing-value guard and double readback verification.
      descriptor.defaultValue = "是";
      descriptor.defaultAnswer = "是";
    }
    return descriptor;
  }

  function safetyDescriptor(label, section, kind, element, extra) {
    return Object.assign({
      provider: "beisen",
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
      confidenceReason: "真实样本确认的安全边界控件",
      manualOnly: true,
      manualReason: "Adapter 标记为 manual-only",
    }, extra || {});
  }

  function uploadLabel(element) {
    for (let parent = element && element.parentElement, depth = 0; parent && depth < 8; parent = parent.parentElement, depth++) {
      const text = normalize(textOf(parent));
      if (text.includes("上传简历")) return "上传简历";
      if (text.includes("证件照")) return "证件照";
    }
    return "附件上传";
  }

  function declarationDescriptor(doc, covered) {
    const checkbox = qsa(doc, 'input[type="checkbox"]').find((element) => {
      if (covered.has(element) || groupOf(element) || closest(element, FORM_ITEM_SELECTOR)) return false;
      for (let parent = element.parentElement, depth = 0; parent && depth < 6; parent = parent.parentElement, depth++) {
        if (/声明|实际情况|调查核实/.test(textOf(parent))) return true;
      }
      return false;
    });
    if (!checkbox) return null;
    covered.add(checkbox);
    return safetyDescriptor("声明", "声明", "checkbox", checkbox, {
      checkbox,
      safetyRole: "declaration",
      manualReason: "声明/隐私类字段仅允许手动处理",
    });
  }

  function repeatCheckboxDescriptors(doc, covered, context) {
    const out = [];
    for (const checkbox of qsa(doc, 'input[type="checkbox"]')) {
      if (covered.has(checkbox) || !groupOf(checkbox) || closest(checkbox, FORM_ITEM_SELECTOR)) continue;
      const info = sectionInfoForElement(checkbox);
      const repeater = repeaterFor(checkbox, context, info);
      covered.add(checkbox);
      out.push(Object.assign(safetyDescriptor("至今", info.section, "checkbox", checkbox, { checkbox, manualOnly: false }), {
        sectionKey: info.sectionKey === "_flat" ? null : info.sectionKey,
        repeater,
        identity: { sectionKey: info.sectionKey === "_flat" ? null : info.sectionKey, itemIndex: repeater.itemIndex, fieldKey: "至今" },
        confidenceReason: "真实样本确认的重复经历结束状态 checkbox",
      }));
    }
    return out;
  }

  function outsideFileDescriptors(doc, covered) {
    const out = [];
    for (const file of qsa(doc, 'input[type="file"]')) {
      if (covered.has(file)) continue;
      covered.add(file);
      const label = uploadLabel(file);
      out.push(safetyDescriptor(label, label === "上传简历" ? "上传简历" : "", "file", file, {
        fileControls: [file],
        manualOnly: true,
        safetyRole: "file",
        manualReason: "文件控件仅允许手动上传",
      }));
    }
    return out;
  }

  function submitDescriptor(doc, covered) {
    const button = qsa(doc, 'button, input[type="submit"], [role="button"]').find((element) => {
      if (covered.has(element) || !isVisible(element)) return false;
      return /提交申请|预览并提交|最终确认/.test(normalize(textOf(element)));
    });
    if (!button) return null;
    covered.add(button);
    return safetyDescriptor(normalize(textOf(button)), "提交", "unknown", button, {
      safetyRole: "submit",
      manualReason: "提交类控件仅允许手动处理",
    });
  }

  function captchaDescriptor(doc, covered) {
    const input = qsa(doc, "input").find((element) => {
      if (covered.has(element)) return false;
      const hint = normalize(`${element.placeholder || ""} ${textOf(element.parentElement)}`);
      return hint.includes("验证码");
    });
    if (!input) return null;
    covered.add(input);
    return safetyDescriptor("验证码", "安全校验", "unknown", input, {
      safetyRole: "captcha",
      manualReason: "验证码仅允许手动处理",
    });
  }

  function formEvidence(context) {
    const doc = docOf(context);
    const loc = locationOf(context);
    const pathname = String(loc.pathname || "");
    const hasWrapper = Boolean(doc && typeof doc.querySelector === "function" && doc.querySelector(".form-item .form-item__text") && doc.querySelector(".form-item .form-item__control"));
    const groups = doc ? allGroups(doc) : [];
    const profiles = Array.from(new Set(groups.map((group) => {
      const profile = profileForGroup(group);
      return profile && profile.key;
    }).filter(Boolean)));
    const hasGeneratedGroup = groups.length > 0;
    const hasPhoenix = Boolean(doc && typeof doc.querySelector === "function" && doc.querySelector('[class*="phoenix-"]'));
    const hasBrand = Boolean(doc && doc.body && /Powered\s+by\s+Beisen/i.test(doc.body.textContent || ""));
    const pathLooksLikeForm = pathname === "/form" || /\/form\/$/.test(pathname);
    let status = "BEISEN_UNCERTAIN";
    if (isBeisenHost(context) && !pathLooksLikeForm) status = "BEISEN_SITE_NON_FORM";
    else if (isBeisenHost(context) && pathLooksLikeForm && hasWrapper && (hasGeneratedGroup || hasPhoenix || hasBrand)) status = "BEISEN_FORM_CONFIRMED";
    return {
      status,
      evidence: { pathLooksLikeForm, hasWrapper, hasGeneratedGroup, hasPhoenix, hasBrand, profiles },
    };
  }

  function dateParts(value) {
    if (NS.parseYearMonth) return NS.parseYearMonth(value);
    const match = String(value || "").trim().match(/^(\d{4})\s*[.\-/年]\s*(\d{1,2})(?:\s*[.\-/月]\s*(\d{1,2}))?/);
    if (!match) return null;
    return { y: match[1], m: String(Number(match[2])), d: match[3] ? String(Number(match[3])) : null };
  }

  function normalizeDate(value) {
    if (NS.normalizeDate) return NS.normalizeDate(value);
    const parsed = dateParts(value);
    if (!parsed) return normalize(value);
    const base = `${parsed.y}.${String(parsed.m).padStart(2, "0")}`;
    return parsed.d == null ? base : `${base}.${String(parsed.d).padStart(2, "0")}`;
  }

  function dateMatches(actual, expected, variant) {
    const a = dateParts(actual);
    const e = dateParts(expected);
    if (!a || !e || a.y !== e.y || String(Number(a.m)) !== String(Number(e.m))) return false;
    if (variant === "month-picker") return true;
    return e.d == null || (a.d != null && String(Number(a.d)) === String(Number(e.d)));
  }

  function selectShownText(field) {
    const component = field.selectComponents && field.selectComponents[0]
      ? field.selectComponents[0]
      : (field.selectControls && field.selectControls[0] ? closest(field.selectControls[0], SELECT_SELECTOR) : null);
    const candidates = component ? qsa(component, ".phoenix-select__placeHolder, .phoenix-select__singleLabel, .phoenix-select__value, .phoenix-select__content") : [];
    for (const candidate of candidates) {
      const text = normalize(textOf(candidate));
      if (text && !/^(请选择|选择|请填写)$/.test(text)) return text;
    }
    const input = field.selectControls && field.selectControls[0];
    const value = normalize(input && input.value);
    return /^(请选择|选择|请填写)$/.test(value) ? "" : value;
  }

  function componentFor(field) {
    return field && field.selectComponents && field.selectComponents[0]
      ? field.selectComponents[0]
      : (field && field.selectControls && field.selectControls[0] ? closest(field.selectControls[0], SELECT_SELECTOR) : null);
  }

  function visibleElements(root, selector) {
    return qsa(root, selector).filter(isVisible);
  }

  function normalizedLocation(value) {
    return normalize(String(value || "")).replace(/[>\\/、,，]/g, "");
  }

  function locationSearchTerm(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const pieces = raw.split(/[\s>\/、,，]+/).filter(Boolean);
    if (pieces.length > 1) return pieces[pieces.length - 1];
    // The real sample uses a compact path such as 省 + 市. Prefer the last
    // administrative unit instead of searching the whole concatenated path.
    const compact = raw.match(/(?:省|自治区|自治州|地区|盟)([^省市县区旗盟州]+(?:市|县|区|旗|盟|州))$/);
    return compact ? compact[1] : raw;
  }

  function locationItemName(item) {
    return textOf(first(item, ".area-text-label") || first(item, ".area-item-name") || item);
  }

  function locationItemPath(item) {
    return textOf(first(item, ".area-item-path"));
  }

  function locationItemFullText(item) {
    return `${locationItemPath(item)}${locationItemName(item)}`;
  }

  function locationItemSelected(item) {
    const classes = classText(item);
    if (/(selected|checked|active)/i.test(classes)) return true;
    return Boolean(first(item, ".area-icon-RadioChecked, .area-icon-RadioCheckedDisabled, [aria-checked=\"true\"], [data-selected=\"true\"]"));
  }

  function setTextValue(input, value) {
    if (!input) return false;
    try {
      if (typeof input.focus === "function") input.focus();
      const proto = String(input.tagName || "").toUpperCase() === "TEXTAREA"
        ? (typeof HTMLTextAreaElement !== "undefined" && HTMLTextAreaElement.prototype)
        : (typeof HTMLInputElement !== "undefined" && HTMLInputElement.prototype);
      const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor && descriptor.set) descriptor.set.call(input, String(value));
      else input.value = String(value);
      if (typeof NS.emitInputEvents === "function") NS.emitInputEvents(input);
      else if (input.dispatchEvent && typeof Event !== "undefined") {
        input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      }
      // The real Phoenix area search also reacts to the keyboard completion
      // event. Native setter + input/change is not sufficient in every build.
      if (input.dispatchEvent && typeof KeyboardEvent !== "undefined") {
        input.dispatchEvent(new KeyboardEvent("keyup", { key: "Unidentified", bubbles: true, composed: true }));
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function locationPopupFor(doc, component) {
    if (!doc || !component || !activeComponent(doc, component)) return null;
    const containers = visibleElements(doc, ".area-selector-container").filter((container) => Boolean(closest(container, ".common-unmodeled-layer")));
    if (containers.length !== 1) return null;
    const container = containers[0];
    const root = closest(container, ".common-unmodeled-layer") || container;
    const searches = visibleElements(root, 'input[placeholder="搜索"]');
    if (searches.length !== 1) return null;
    return { root, container, search: searches[0] };
  }

  async function openLocationPopup(field, context) {
    const doc = docOf(context);
    const component = componentFor(field);
    if (!doc || !component || !dispatchClick(component)) return null;
    return waitForValue(() => locationPopupFor(doc, component), 40);
  }

  function locationCandidates(popup, term, expected) {
    if (!popup) return [];
    const normalizedTerm = normalize(term);
    const normalizedExpected = normalizedLocation(expected);
    return visibleElements(popup.container, ".area-item-container").filter((item) => {
      if (normalize(locationItemName(item)) !== normalizedTerm) return false;
      if (!normalizedExpected) return true;
      const full = normalizedLocation(locationItemFullText(item));
      return full === normalizedExpected || normalizedLocation(locationItemName(item)) === normalizedExpected;
    });
  }

  function exactTextNodes(root, selector, value) {
    const want = normalize(value);
    return visibleElements(root, selector).filter((element) => normalize(textOf(element)) === want);
  }

  function locationSelectionCount(popup) {
    const text = normalize(textOf(popup && popup.container));
    const match = text.match(/已选地区(\d+)\/(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function readLocation(field) {
    return selectShownText(field);
  }

  function locationMatches(actual, expected, field) {
    const a = normalizedLocation(actual);
    const e = normalizedLocation(expected);
    if (!a || !e) return false;
    if (a === e) return true;
    // Phoenix displays only the leaf in the main select after confirmation.
    // The exact full path was already proven by the unique popup candidate;
    // keep that proof on the runtime FieldDescriptor for the final readback.
    const confirmed = field && field._beisenConfirmedLocation;
    const leaf = normalizedLocation(locationSearchTerm(expected));
    return Boolean(confirmed && confirmed === e && a === leaf);
  }

  async function writeLocation(field, value, context) {
    const expected = String(value || "").trim();
    const term = locationSearchTerm(expected);
    if (!expected || !term) return false;
    const popup = await openLocationPopup(field, context || {});
    if (!popup || !setTextValue(popup.search, term)) {
      closePopup(docOf(context));
      return false;
    }
    const found = await waitForValue(() => {
      const matches = locationCandidates(popup, term, expected);
      return matches.length ? matches : null;
    }, 40);
    if (!found || found.length !== 1 || !dispatchClick(found[0])) {
      closePopup(docOf(context));
      return false;
    }
    const selected = await waitForValue(() => {
      const count = locationSelectionCount(popup);
      return count === 1 || locationItemSelected(found[0]) ? true : null;
    }, 30);
    if (!selected) {
      closePopup(docOf(context));
      return false;
    }
    const confirm = exactTextNodes(popup.root, ".phoenix-button__content, button, [role=\"button\"]", "确定");
    if (confirm.length !== 1 || !dispatchClick(confirm[0])) {
      closePopup(docOf(context));
      return false;
    }
    const closed = await waitForValue(() => locationPopupFor(docOf(context), componentFor(field)) ? null : true, 30);
    if (!closed) return false;
    field._beisenConfirmedLocation = normalizedLocation(expected);
    const verified = await waitForValue(() => locationMatches(readLocation(field), expected, field) ? true : null, 30);
    if (!verified) delete field._beisenConfirmedLocation;
    return Boolean(verified);
  }

  async function clearLocation(field, context) {
    const current = readLocation(field);
    if (!current) return true;
    const component = componentFor(field);
    const clear = component && first(component, ".phoenix-select__clearIcon");
    if (clear && isVisible(clear) && dispatchClick(clear)) {
      const cleared = Boolean(await waitForValue(() => !readLocation(field) ? true : null, 30));
      if (cleared) delete field._beisenConfirmedLocation;
      return cleared;
    }
    const popup = await openLocationPopup(field, context || {});
    if (!popup) return false;
    const clearButtons = exactTextNodes(popup.root, ".area-footer-button, .phoenix-button__content, button, [role=\"button\"], [class*=\"clear\"], [class*=\"Clear\"]", "清空已选");
    const confirm = exactTextNodes(popup.root, ".phoenix-button__content, button, [role=\"button\"]", "确定");
    if (clearButtons.length !== 1 || confirm.length !== 1 || !dispatchClick(clearButtons[0]) || !dispatchClick(confirm[0])) {
      closePopup(docOf(context));
      return false;
    }
    const cleared = Boolean(await waitForValue(() => !readLocation(field) ? true : null, 30));
    if (cleared) delete field._beisenConfirmedLocation;
    return cleared;
  }

  function activeComponent(doc, component) {
    if (!doc || !component) return false;
    const active = visibleElements(doc, `${SELECT_SELECTOR}.phoenix-select--active`);
    return active.length === 1 && active[0] === component;
  }

  async function waitForValue(read, attempts) {
    const count = Number.isInteger(attempts) ? attempts : 40;
    for (let i = 0; i < count; i += 1) {
      const value = read();
      if (value) return value;
      if (NS.sleep) await NS.sleep(60);
    }
    return null;
  }

  async function openSelectPopup(field, context) {
    const doc = docOf(context);
    const component = componentFor(field);
    if (!doc || !component || !dispatchClick(component)) return null;
    return waitForValue(() => {
      if (!activeComponent(doc, component)) return null;
      const popups = visibleElements(doc, ".phoenix-selectList");
      return popups.length === 1 ? popups[0] : null;
    });
  }

  async function openDatePopup(field, context) {
    const doc = docOf(context);
    const component = componentFor(field);
    if (!doc || !component || !dispatchClick(component)) return null;
    return waitForValue(() => {
      if (!activeComponent(doc, component)) return null;
      const popups = visibleElements(doc, ".phoenix-date-picker__wrap");
      return popups.length === 1 ? popups[0] : null;
    });
  }

  function dateVariantOf(popup) {
    if (!popup) return null;
    const monthPanels = visibleElements(popup, ".phoenix-calendar-month-panel");
    const dayTables = visibleElements(popup, ".phoenix-calendar-table");
    if (monthPanels.length === 1 && dayTables.length === 0) return "month-picker";
    if (dayTables.length === 1 && monthPanels.length === 0) return "date-picker";
    return null;
  }

  function pickerMode(variant) {
    if (variant === "month-picker") return "month";
    if (variant === "date-picker") return "day";
    return null;
  }

  // Variant detection is deliberately DOM-based. Labels only tell scanFields
  // that a field is date-like; they never decide whether it is month-only or
  // a full date picker.
  async function detectDateVariant(field, context) {
    const popup = await openDatePopup(field, context || {});
    if (!popup) return null;
    const variant = dateVariantOf(popup);
    if (!variant) closePopup(docOf(context));
    return variant ? { popup, variant } : null;
  }

  function yearText(value) {
    const match = String(value || "").match(/\b(\d{4})\b/);
    return match ? match[1] : null;
  }

  function monthNumber(value) {
    const match = String(value || "").trim().match(/^(\d{1,2})\s*月?$/);
    return match ? String(Number(match[1])) : null;
  }

  function dayNumber(value) {
    const match = String(value || "").trim().match(/^(\d{1,2})$/);
    return match ? String(Number(match[1])) : null;
  }

  async function chooseDateYear(popup, year, mode) {
    const buttonSelector = mode === "month"
      ? ".phoenix-calendar-month-panel-year-select"
      : ".phoenix-calendar-year-select";
    const buttons = visibleElements(popup, buttonSelector);
    if (buttons.length !== 1) return false;
    if (yearText(textOf(buttons[0])) === year) return true;
    if (!dispatchClick(buttons[0])) return false;
    const yearPanel = await waitForValue(() => {
      const panels = visibleElements(popup, ".phoenix-calendar-year-panel");
      return panels.length === 1 ? panels[0] : null;
    });
    if (!yearPanel) return false;
    const matches = visibleElements(yearPanel, ".phoenix-calendar-year-panel-cell").filter((cell) => yearText(textOf(cell)) === year);
    if (matches.length !== 1 || !dispatchClick(matches[0])) return false;
    return Boolean(await waitForValue(() => {
      const panels = visibleElements(popup, ".phoenix-calendar-year-panel");
      return panels.length === 0 ? true : null;
    }));
  }

  async function chooseDateMonth(popup, month) {
    if (visibleElements(popup, ".phoenix-calendar-month-panel").length === 0) {
      const buttons = visibleElements(popup, ".phoenix-calendar-month-select");
      if (buttons.length !== 1 || !dispatchClick(buttons[0])) return false;
      if (!await waitForValue(() => visibleElements(popup, ".phoenix-calendar-month-panel").length === 1 ? true : null)) return false;
    }
    const matches = visibleElements(popup, ".phoenix-calendar-month-panel-cell").filter((cell) => monthNumber(textOf(cell)) === month);
    if (matches.length !== 1) return false;
    return dispatchClick(matches[0]);
  }

  function chooseDateDay(popup, day) {
    const matches = visibleElements(popup, ".phoenix-calendar-table td.phoenix-calendar-cell").filter((cell) => {
      const cls = classText(cell);
      if (/last-month|next-month/.test(cls)) return false;
      return dayNumber(textOf(cell)) === day;
    });
    if (matches.length !== 1) return false;
    return dispatchClick(matches[0]);
  }

  function readDate(field) {
    const value = selectShownText(field);
    return value ? normalizeDate(value) : "";
  }

  async function writeDate(field, value, context) {
    const expected = dateParts(value);
    if (!expected || !expected.y || !expected.m) return false;
    const detected = await detectDateVariant(field, context || {});
    const popup = detected && detected.popup;
    const variant = detected && detected.variant;
    const mode = pickerMode(variant);
    if (!popup || !mode) return false;
    // A full date picker cannot safely invent a day from a month-only value.
    // A month picker may receive a value that also contains a day; the page's
    // confirmed precision wins and readback verifies only year/month.
    if (mode === "day" && expected.d == null) {
      closePopup(docOf(context));
      return false;
    }
    field._beisenDateVariant = variant;
    if (!await chooseDateYear(popup, expected.y, mode)) {
      closePopup(docOf(context));
      return false;
    }
    if (!await chooseDateMonth(popup, expected.m)) {
      closePopup(docOf(context));
      return false;
    }
    if (mode === "day" && !chooseDateDay(popup, expected.d)) {
      closePopup(docOf(context));
      return false;
    }
    const verified = await waitForValue(() => dateMatches(readDate(field), value, variant) ? true : null, 20);
    return Boolean(verified);
  }

  async function clearDate(field, context) {
    const current = readDate(field);
    if (!current) return true;
    const component = componentFor(field);
    const clear = component && first(component, ".phoenix-select__clearIcon");
    if (!clear || !isVisible(clear) || !dispatchClick(clear)) return false;
    const cleared = await waitForValue(() => !readDate(field) ? true : null, 20);
    return Boolean(cleared);
  }

  function radioOptionText(element) {
    return normalize(textOf(first(element, ".phoenix-radio__radio-text") || element));
  }

  function radioState(element) {
    const native = first(element, 'input[type="radio"]');
    if (native) return Boolean(native.checked);
    const nodes = [element, first(element, ".phoenix-radio")].filter(Boolean);
    for (const node of nodes) {
      if (node.getAttribute && (node.getAttribute("aria-checked") === "true" || node.getAttribute("data-checked") === "true" || node.getAttribute("data-selected") === "true")) return true;
      if (node.getAttribute && (node.getAttribute("aria-checked") === "false" || node.getAttribute("data-checked") === "false" || node.getAttribute("data-selected") === "false")) return false;
      const tokens = classText(node).split(/\s+/).filter(Boolean);
      if (tokens.some((token) => /(^|--)(checked|selected|is-checked|isSelected|active)$/.test(token) || /phoenix-radio--(checked|selected|active)/.test(token))) return true;
      if (tokens.some((token) => /(^|--)(unchecked|unselected|is-unchecked)$/.test(token))) return false;
    }
    return null;
  }

  function radioClickableNode(option) {
    for (const selector of [
      ".phoenix-radio__circle-wrapper",
      ".phoenix-radio__circle",
      ".phoenix-radio__radio-text",
      ".phoenix-radio",
    ]) {
      const node = first(option, selector);
      if (node) return node;
    }
    return option;
  }

  function readRadio(field) {
    let unknown = false;
    let selected = null;
    for (const option of field.radioControls || []) {
      const state = radioState(option);
      if (state === null) unknown = true;
      if (state === true) selected = radioOptionText(option);
    }
    field.readStateUnknown = unknown && !selected;
    // null is an intentional provider result. Registry treats undefined as
    // "method unavailable" and would fall back to Generic, which cannot read
    // this custom radio. The caller treats null as empty-but-unverified.
    return selected || (unknown ? null : "");
  }

  function readControl(field) {
    if (!field) return undefined;
    if (field.kind === "text" || field.kind === "textarea") {
      const input = field.textControls && field.textControls[0];
      return input ? String(input.value || "").trim() : "";
    }
    if (field.kind === "select") return selectShownText(field);
    if (field.kind === "search-select" && field.controlVariant === "area-selector") return readLocation(field);
    if (field.kind === "date") return readDate(field);
    if (field.kind === "radio") return readRadio(field);
    if (field.kind === "checkbox") return Boolean(field.checkbox && field.checkbox.checked);
    if (field.kind === "file") return Boolean((field.fileControls || []).some((input) => input.files && input.files.length));
    return undefined;
  }

  function dispatchClick(element) {
    if (!element || typeof element.click !== "function") return false;
    try {
      if (typeof MouseEvent !== "undefined" && element.dispatchEvent) element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    } catch (e) { /* click below is the important operation */ }
    element.click();
    return true;
  }

  function closePopup(doc) {
    try {
      const active = doc && doc.activeElement;
      if (active && active.dispatchEvent && typeof KeyboardEvent !== "undefined") {
        active.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      }
    } catch (e) { /* do not click the page body: that could affect another field */ }
  }

  async function pickFromPopup(field, value, context) {
    const doc = docOf(context);
    const popup = await openSelectPopup(field, context || {});
    if (!doc || !popup) return false;
    const want = normalize(NS.toOptionText ? NS.toOptionText(context && context.merged || {}, value) : value);
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const options = qsa(popup, ".phoenix-selectList__listItem").filter(isVisible);
      const matches = options.filter((option) => {
        const optionText = normalize(textOf(option));
        return optionText === want;
      });
      if (matches.length === 1) return dispatchClick(matches[0]);
      if (matches.length > 1) { closePopup(doc); return false; }
      if (NS.sleep) await NS.sleep(60);
    }
    closePopup(doc);
    return false;
  }

  async function writeRadio(field, value, context) {
    const want = normalize(NS.toOptionText ? NS.toOptionText(context && context.merged || {}, value) : value);
    const matches = (field.radioControls || []).filter((option) => radioOptionText(option) === want);
    if (matches.length !== 1) return false;
    const clickable = radioClickableNode(matches[0]);
    if (!dispatchClick(clickable)) return false;
    return Boolean(await waitForValue(() => {
      const actual = readRadio(field);
      return actual != null && normalize(actual) === want ? true : null;
    }, 30));
  }

  function clearRadio(field) {
    const options = field && field.radioControls || [];
    const nativeInputs = options.map((option) => first(option, 'input[type="radio"]'));
    // The confirmed Phoenix radio has no safe unselect operation. Only allow
    // clearing a real native radio group when every option exposes one.
    if (!options.length || nativeInputs.some((input) => !input)) return false;
    for (const input of nativeInputs) {
      if (input.checked) {
        input.checked = false;
        if (typeof NS.emitInputEvents === "function") NS.emitInputEvents(input);
      }
    }
    return readRadio(field) === "";
  }

  function verifyControl(field, value, context) {
    const actual = context && Object.prototype.hasOwnProperty.call(context, "actual") ? context.actual : readControl(field);
    if (actual === undefined) return false;
    const kind = (context && context.kind) || field.kind;
    if (kind === "text" || kind === "textarea") return String(actual).trim() === String(value).trim();
    if (kind === "select" || kind === "radio") return normalize(actual) === normalize(NS.toOptionText ? NS.toOptionText(context && context.merged || {}, value) : value);
    if (kind === "search-select" && field && field.controlVariant === "area-selector") return locationMatches(actual, value, field);
    if (kind === "date") return dateMatches(actual, value, field && field._beisenDateVariant);
    if (kind === "checkbox") return Boolean(actual) === Boolean(value);
    return false;
  }

  async function clearSelect(field, context) {
    const current = selectShownText(field);
    if (!current) return true;
    const component = field.selectComponents && field.selectComponents[0];
    const clear = component && first(component, ".phoenix-select__clearIcon");
    if (!clear || !isVisible(clear) || !dispatchClick(clear)) return false;
    if (NS.sleep) await NS.sleep(80);
    return !selectShownText(field);
  }

  const beisen = {
    key: "beisen",
    capabilities: {
      addItem: {
        education: false, work: false, internship: false, project: false,
        award: false, skills: false, certificates: false, language: false,
      },
    },

    getFormState(context) {
      return formEvidence(context || {});
    },

    scanFields(context) {
      const ctx = context || {};
      const state = formEvidence(ctx);
      if (state.status !== "BEISEN_FORM_CONFIRMED") return isBeisenHost(ctx) ? [] : undefined;
      const doc = docOf(ctx);
      const fields = [];
      const covered = new Set();
      for (const item of qsa(doc, FORM_ITEM_SELECTOR)) {
        if (!isVisible(item)) continue;
        // Only scan form items belonging to a validated Beisen profile. This
        // prevents unrelated Phoenix widgets elsewhere on a zhiye page from
        // becoming fields, while keeping unknown valid controls visible in a
        // confirmed group.
        if (!groupOf(item)) continue;
        covered.add(item);
        for (const control of qsa(item, "input, textarea, select, .phoenix-select, .phoenix-radio-group__radioItem")) covered.add(control);
        fields.push(descriptorForItem(item, ctx));
      }
      fields.push(...repeatCheckboxDescriptors(doc, covered, ctx));
      const declaration = declarationDescriptor(doc, covered);
      if (declaration) fields.push(declaration);
      fields.push(...outsideFileDescriptors(doc, covered));
      const captcha = captchaDescriptor(doc, covered);
      if (captcha) fields.push(captcha);
      const submit = submitDescriptor(doc, covered);
      if (submit) fields.push(submit);
      return fields;
    },

    getFieldContainers(context) {
      if (formEvidence(context || {}).status !== "BEISEN_FORM_CONFIRMED") return [];
      const doc = docOf(context);
      return qsa(doc, FORM_ITEM_SELECTOR).filter((item) => isVisible(item) && Boolean(groupOf(item)));
    },

    getSection(container, context) {
      const field = context && context.field;
      if (field && field.safetyRole) return { section: field.section || "", sectionKey: "_flat" };
      const info = sectionInfoForElement(container);
      if (!info.section && field) return { section: field.section || "", sectionKey: field.sectionKey || null };
      return { section: info.section, sectionKey: info.sectionKey };
    },

    getRepeaterItem(container, context) {
      const field = context && context.field;
      if (field && field.safetyRole) return { itemIndex: null, itemElement: null };
      const info = sectionInfoForElement(container);
      return repeaterFor(container, context || {}, info);
    },

    classifyControl(field) {
      return field && field.kind ? field.kind : "unknown";
    },

    readControl(field) {
      return readControl(field);
    },

    readDate(field) {
      return readDate(field);
    },

    captureControl(field) {
      return readControl(field);
    },

    async writeControl(field, value, context) {
      if (!field || field.manualOnly || field.safetyRole === "file" || field.safetyRole === "submit" || field.safetyRole === "declaration" || field.safetyRole === "captcha") return false;
      const kind = (context && context.kind) || field.kind;
      if (kind === "text" || kind === "textarea" || kind === "checkbox") {
        return Boolean(NS.writeControlCore && await NS.writeControlCore(field, value, Object.assign({}, context || {}, { kind })));
      }
      if (kind === "select") return pickFromPopup(field, value, context || {});
      if (kind === "search-select" && field.controlVariant === "area-selector") return writeLocation(field, value, context || {});
      if (kind === "date") return writeDate(field, value, context || {});
      if (kind === "radio") return writeRadio(field, value, context || {});
      return false;
    },

    verifyControl(field, value, context) {
      return verifyControl(field, value, context || {});
    },

    verifyDate(field, value, context) {
      return verifyControl(field, value, Object.assign({}, context || {}, { kind: "date" }));
    },

    readLocation(field) {
      return readLocation(field);
    },

    verifyLocation(field, value, context) {
      return verifyControl(field, value, Object.assign({}, context || {}, { kind: "search-select", controlVariant: "area-selector" }));
    },

    clearRadio(field) {
      return clearRadio(field);
    },

    async clearControl(field, context) {
      if (!field || field.manualOnly || field.safetyRole) return false;
      const kind = (context && context.kind) || field.kind;
      if (kind === "text" || kind === "textarea" || kind === "checkbox") {
        return Boolean(NS.clearControlCore && await NS.clearControlCore(field, Object.assign({}, context || {}, { kind })));
      }
      if (kind === "select") return clearSelect(field, context || {});
      if (kind === "search-select" && field.controlVariant === "area-selector") return clearLocation(field, context || {});
      if (kind === "date") return clearDate(field, context || {});
      if (kind === "radio") return clearRadio(field);
      return false;
    },

    clearDate(field, context) {
      return clearDate(field, context || {});
    },

    clearLocation(field, context) {
      return clearLocation(field, context || {});
    },

    // Add buttons are visible in the real sample, but auto-add is deliberately
    // disabled until a later round proves click, rescan and verification.
    findAddButton() {
      return null;
    },
  };

  NS.beisenFormState = formEvidence;
  NS.adapterDefinitions.beisen = beisen;
})();
