/* Real-form-informed Beisen Adapter tests. Run with: node tests/beisen-adapter.test.js */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "extension/rules/seed.json"), "utf8"));

class FakeElement {
  constructor(tagName, options = {}) {
    this.tagName = String(tagName || "div").toUpperCase();
    this._className = options.className || "";
    this.id = options.id || "";
    this._text = options.text || "";
    this.type = options.type || (this.tagName === "INPUT" ? "text" : "");
    this.value = options.value == null ? "" : options.value;
    this.checked = Boolean(options.checked);
    this.files = options.files || [];
    this.placeholder = options.placeholder || "";
    this.style = Object.assign({}, options.style || {});
    this.attributesMap = Object.assign({}, options.attributes || {});
    this.children = [];
    this.parentElement = null;
    this.clicked = false;
    this.onClick = null;
    this.onEvent = null;
  }

  get className() { return this._className; }
  set className(value) { this._className = String(value || ""); }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value || ""); this.children = []; }
  get isConnected() { return true; }
  get classList() {
    return {
      contains: (name) => this._className.split(/\s+/).includes(name),
      add: (...names) => { this._className = Array.from(new Set(this._className.split(/\s+/).concat(names).filter(Boolean))).join(" "); },
      remove: (...names) => { this._className = this._className.split(/\s+/).filter((name) => !names.includes(name)).join(" "); },
    };
  }

  append(...children) {
    for (const child of children.flat()) {
      if (!child) continue;
      child.parentElement = this;
      this.children.push(child);
    }
    return this;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  contains(element) {
    if (this === element) return true;
    return this.children.some((child) => child.contains(element));
  }

  getAttribute(name) {
    if (name === "class") return this.className;
    if (name === "id") return this.id || null;
    if (name === "type") return this.type || null;
    if (name === "value") return this.value;
    if (name === "placeholder") return this.placeholder || null;
    return Object.prototype.hasOwnProperty.call(this.attributesMap, name) ? this.attributesMap[name] : null;
  }

  setAttribute(name, value) {
    if (name === "class") this.className = value;
    else if (name === "id") this.id = value;
    else this.attributesMap[name] = String(value);
  }

  getBoundingClientRect() {
    return this.style.display === "none" || this.style.visibility === "hidden"
      ? { width: 0, height: 0 }
      : { width: 100, height: 20 };
  }

  dispatchEvent(event) {
    if (this.onEvent) this.onEvent(event);
    return true;
  }

  click() {
    this.clicked = true;
    if (this.onClick) this.onClick(this);
  }

  scrollIntoView() {}
  focus() {}
  blur() {}

  matches(selector) {
    return selector.split(",").some((part) => this.matchesCompound(part.trim()));
  }

  matchesCompound(selector) {
    if (!selector) return false;
    const parts = selector.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      if (!this.matchesSimple(parts[parts.length - 1])) return false;
      let parent = this.parentElement;
      for (let i = parts.length - 2; i >= 0; i--) {
        while (parent && !parent.matchesSimple(parts[i])) parent = parent.parentElement;
        if (!parent) return false;
        parent = parent.parentElement;
      }
      return true;
    }
    return this.matchesSimple(selector);
  }

  matchesSimple(selector) {
    let current = selector.trim();
    const nots = [];
    current = current.replace(/:not\(([^)]+)\)/g, (_all, inner) => { nots.push(inner); return ""; });
    if (nots.some((inner) => this.matchesSimple(inner))) return false;
    const tag = current.match(/^([a-zA-Z][\w-]*|\*)/);
    if (tag && tag[1] !== "*" && this.tagName !== tag[1].toUpperCase()) return false;
    for (const cls of [...current.matchAll(/\.([\w-]+)/g)]) {
      if (!this.classList.contains(cls[1])) return false;
    }
    for (const attr of [...current.matchAll(/\[([^\]=~*]+)(?:(\*|=)"?([^\]]*)"?)?\]/g)]) {
      const name = attr[1].trim();
      const actual = this.getAttribute(name);
      if (actual == null) return false;
      if (attr[2] === "=" && String(actual) !== attr[3].replace(/"$/, "")) return false;
      if (attr[2] === "*" && !String(actual).includes(attr[3].replace(/"$/, ""))) return false;
    }
    return true;
  }

  querySelectorAll(selector) {
    const out = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  closest(selector) {
    for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current;
    return null;
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super("document");
    this.body = new FakeElement("body");
    this.append(this.body);
    this.activeElement = null;
  }
}

function el(tag, options, ...children) {
  const node = new FakeElement(tag, options);
  return node.append(...children);
}

function formItem(label, control) {
  return el("div", { className: "form-item form-item--phoenix" },
    el("div", { className: "form-item__title form-item__title--right", text: `* ${label}` }, el("span", { className: "form-item__text", text: `* ${label}` })),
    el("div", { className: "form-item__control" }, control));
}

function input(value = "") { return el("input", { className: "phoenix-input__input", type: "text", value }); }

function select(doc, options = ["本科", "硕士研究生"]) {
  const inputNode = el("input", { className: "phoenix-select__input", type: "text", value: "" });
  const placeholder = el("div", { className: "phoenix-select__placeHolder", text: "请选择" });
  const clear = el("div", { className: "phoenix-select__clearIcon" });
  const component = el("div", { className: "phoenix-select phoenix-select--editable" }, inputNode, placeholder, clear);
  component.onClick = () => {
    component.classList.add("phoenix-select--active");
    const popup = el("div", { className: "common-unmodeled-layer phoenix-selectList" });
    for (const value of options) {
      const option = el("li", { className: "phoenix-selectList__listItem", text: value });
      option.onClick = () => { placeholder._text = value; component.classList.remove("phoenix-select--active"); popup.remove(); };
      popup.append(option);
    }
    doc.body.append(popup);
  };
  clear.onClick = () => { placeholder._text = "请选择"; };
  return { component, input: inputNode, placeholder, clear };
}

function locationSelect(doc, options = [{ name: "邵阳市", path: "湖南省" }]) {
  const inputNode = el("input", { className: "phoenix-select__input", type: "text", value: "" });
  const placeholder = el("div", { className: "phoenix-select__placeHolder", text: "请选择" });
  const clear = el("div", { className: "phoenix-select__clearIcon" });
  const component = el("div", { className: "phoenix-select phoenix-select--editable" }, inputNode, placeholder, clear);
  const searchValues = [];
  const selectedValues = [];
  let popup = null;
  let selected = null;

  function renderItems(query) {
    if (!popup) return;
    const list = popup.list;
    list.children = [];
    const want = String(query || "").trim();
    const matches = options.filter((item) => !want || item.name === want);
    for (const item of matches) {
      const icon = el("span", { className: "icon-container visible area-icon-RadioUnchecked" });
      const label = el("span", { className: "area-text-label no-hover", text: item.name });
      const path = el("div", { className: "area-item-path", text: item.path || "" });
      const candidate = el("div", { className: "area-item-container" },
        el("div", { className: "area-item-name" }, icon, label), path);
      candidate.onClick = () => {
        selected = item;
        selectedValues.push(`${item.path || ""}${item.name}`);
        icon.classList.remove("area-icon-RadioUnchecked");
        icon.classList.add("area-icon-RadioChecked");
        popup.count._text = "已选地区1/1";
      };
      list.append(candidate);
    }
  }

  component.onClick = () => {
    component.classList.add("phoenix-select--active");
    const search = el("input", { className: "phoenix-input__input phoenix-input__input--hasPrefix", type: "text", placeholder: "搜索", value: "" });
    const list = el("div", { className: "area-data-container" });
    const count = el("div", { className: "area-selected-count", text: "已选地区0/1" });
    const clearSelected = el("div", { className: "area-clear-selected", text: "清空已选" });
    const cancel = el("div", { className: "phoenix-button__content", text: "取消" });
    const confirm = el("div", { className: "phoenix-button__content", text: "确定" });
    const footer = el("div", { className: "area-footer-button" }, count, clearSelected, cancel, confirm);
    const content = el("div", { className: "common-unmodeled-layer__layerContent area-selector-container" },
      el("div", { className: "area-search-input" }, search), list, footer);
    const root = el("div", { className: "common-unmodeled-layer" }, content);
    popup = { root, container: content, list, count, search };
    search.onEvent = (event) => {
      if (event && event.type === "input") {
        searchValues.push(search.value);
        renderItems(search.value);
      }
    };
    clearSelected.onClick = () => {
      selected = null;
      count._text = "已选地区0/1";
      renderItems(search.value);
    };
    cancel.onClick = () => {
      component.classList.remove("phoenix-select--active");
      root.remove();
      popup = null;
    };
    confirm.onClick = () => {
      if (!selected) return;
      // Real Phoenix keeps only the leaf in the main select. The full path is
      // visible in the area popup and is used for unique candidate proof.
      placeholder._text = selected.name;
      component.classList.remove("phoenix-select--active");
      root.remove();
      popup = null;
    };
    doc.body.append(root);
    renderItems("");
  };
  clear.onClick = () => { placeholder._text = "请选择"; };
  return { component, input: inputNode, placeholder, clear, searchValues, selectedValues };
}

function dateSelect(doc, mode = "month", options = {}) {
  const inputNode = el("input", { className: "phoenix-select__input", type: "text", value: "" });
  const placeholder = el("div", { className: "phoenix-select__placeHolder", text: "请选择" });
  const clear = el("div", { className: "phoenix-select__clearIcon" });
  const component = el("div", { className: "phoenix-select phoenix-select--editable" }, inputNode, placeholder, clear);
  let popup = null;
  let year = String(options.initialYear || "2026");
  let month = String(options.initialMonth || "9");
  const years = (options.years || ["2000", "2001", "2002", "2003", "2004", "2005", "2024", "2025", "2026", "2027"]).map(String);
  const months = (options.months || ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]).map(String);
  const days = (options.days || Array.from({ length: 31 }, (_v, index) => String(index + 1))).map(String);

  function clearPopupChildren() {
    if (popup) popup.children = [];
  }

  function buildYearPanel(next) {
    clearPopupChildren();
    const panel = el("div", { className: "phoenix-calendar-year-panel" });
    for (const value of years) {
      const cell = el("td", { className: "phoenix-calendar-year-panel-cell", text: value });
      cell.onClick = () => { year = value; next(); };
      panel.append(cell);
    }
    popup.append(panel);
  }

  function buildMonthPanel() {
    clearPopupChildren();
    const panel = el("div", { className: "phoenix-calendar-month-panel" });
    const yearButton = el("a", { className: "phoenix-calendar-month-panel-year-select", text: year });
    yearButton.onClick = () => buildYearPanel(buildMonthPanel);
    panel.append(yearButton);
    for (const value of months) {
      const cell = el("td", { className: "phoenix-calendar-month-panel-cell" }, el("a", { className: "phoenix-calendar-month-panel-month", text: `${Number(value)}月` }));
      cell.onClick = () => {
        month = value;
        if (mode === "day") {
          buildDayPanel();
        } else {
          placeholder._text = `${year}年${String(Number(month)).padStart(2, "0")}月`;
          component.classList.remove("phoenix-select--active");
          popup.remove();
        }
      };
      panel.append(cell);
    }
    popup.append(panel);
  }

  function buildDayPanel() {
    clearPopupChildren();
    const calendar = el("div", { className: "phoenix-calendar-table" });
    const yearButton = el("a", { className: "phoenix-calendar-year-select", text: `${year}年` });
    yearButton.onClick = () => buildYearPanel(buildDayPanel);
    const monthButton = el("a", { className: "phoenix-calendar-month-select", text: `${Number(month)}月` });
    monthButton.onClick = buildMonthPanel;
    calendar.append(yearButton, monthButton);
    for (const value of days) {
      const cell = el("td", { className: "phoenix-calendar-cell", text: value });
      cell.onClick = () => {
        placeholder._text = `${year}年${String(Number(month)).padStart(2, "0")}月${String(Number(value)).padStart(2, "0")}日`;
        component.classList.remove("phoenix-select--active");
        popup.remove();
      };
      calendar.append(cell);
    }
    popup.append(calendar);
  }

  component.onClick = () => {
    component.classList.add("phoenix-select--active");
    popup = el("div", { className: "phoenix-date-picker__wrap" });
    doc.body.append(popup);
    if (mode === "day") buildDayPanel();
    else buildMonthPanel();
  };
  clear.onClick = () => { placeholder._text = "请选择"; };
  return { component, input: inputNode, placeholder, clear, mode };
}

function radioGroup(values) {
  const items = values.map((value) => {
    const root = el("div", { className: "phoenix-radio phoenix-radio--withLabel" },
      el("div", { className: "phoenix-radio__circle-wrapper" }),
      el("span", { className: "phoenix-radio__radio-text", text: value }));
    return el("div", { className: "phoenix-radio-group__radioItem" }, root);
  });
  const select = (item) => items.forEach((other) => {
      const root = other.querySelector(".phoenix-radio");
      root.classList.remove("phoenix-radio--checked");
      if (other === item) root.classList.add("phoenix-radio--checked");
    });
  items.forEach((item) => {
    item.onClick = () => select(item);
    item.querySelector(".phoenix-radio__circle-wrapper").onClick = () => select(item);
    item.querySelector(".phoenix-radio__radio-text").onClick = () => select(item);
  });
  return items;
}

function group(doc, title, key, children) {
  const shell = el("div", { className: "section-shell" }, el("div", { className: "section-title", text: title }));
  const form = el("div", { className: "form", id: `fixture_Recruitment_extPerfect_${key}` });
  form.append(...children);
  shell.append(form);
  doc.body.append(shell);
  return form;
}

function profileBGroup(doc, title, moduleMarker, children) {
  const formId = `fixture_${moduleMarker}`;
  const titleNode = el("div", { className: "profile-section-title", id: formId, text: title });
  const form = el("div", { className: "form twoLineFormStyleLong formStyleLeftAndRight", id: formId });
  form.append(...children);
  const shell = el("div", { className: "profile-section" }, titleNode,
    el("div", { className: "ux-standard-form" }, form));
  doc.body.append(shell);
  return form;
}

function buildProfileBFixture() {
  const doc = new FakeDocument();
  doc.body.append(el("div", { text: "Powered by Beisen" }));
  profileBGroup(doc, "个人信息", "Recruitment_PersonProfilePerfectResumeDefaultForm", [
    formItem("姓名", input()),
    formItem("邮箱", input()),
    formItem("性别", el("div", {}, ...radioGroup(["男", "女"]))),
  ]);
  profileBGroup(doc, "求职意向", "Recruitment_ApplicantObjectivePerfectResumeDefaultForm", [
    formItem("期望从事职业", input()),
    formItem("期望工作城市", input()),
  ]);
  for (let i = 0; i < 2; i += 1) {
    profileBGroup(doc, "教育经历", "Recruitment_ApplicantEducationPerfectResumeDefaultForm", [
      formItem("学校名称", input()),
      formItem("专业名称", input()),
      formItem("学历", select(doc).component),
      formItem("开始时间", dateSelect(doc, "month").component),
      formItem("结束时间", dateSelect(doc, "month").component),
    ]);
  }
  profileBGroup(doc, "工作经历", "Recruitment_ApplicantWorkExperiencePerfectResumeDefaultForm", [
    formItem("公司名称", input()),
    formItem("职位名称", input()),
    formItem("开始时间", dateSelect(doc, "month").component),
    formItem("结束时间", dateSelect(doc, "month").component),
    formItem("工作职责", el("textarea", { className: "phoenix-textarea__realTextarea", value: "" })),
  ]);
  for (let i = 0; i < 2; i += 1) {
    profileBGroup(doc, "项目经历", "Recruitment_ApplicantProjectPerfectResumeDefaultForm", [
      formItem("项目名称", input()),
      formItem("职务", input()),
      formItem("开始时间", dateSelect(doc, "month").component),
      formItem("结束时间", dateSelect(doc, "month").component),
      formItem("项目描述", el("textarea", { className: "phoenix-textarea__realTextarea", value: "" })),
    ]);
  }
  return { doc };
}

function buildFixture() {
  const doc = new FakeDocument();
  doc.body.append(el("div", { text: "Powered by Beisen" }));
  const resumeFile = el("input", { type: "file", style: { display: "none" } });
  doc.body.append(el("div", { className: "upload-resume" }, el("div", { text: "上传简历" }), resumeFile));
  const personalSelect = select(doc);
  const hometownSelect = locationSelect(doc);
  const birthdayDate = dateSelect(doc, "day");
  const fulltimeRadio = radioGroup(["是", "否"]);
  group(doc, "个人信息", "personal", [
    formItem("姓名", input()),
    formItem("性别", el("div", {}, ...radioGroup(["男", "女", "保密"]))),
    formItem("证件照", el("div", { className: "file-uploader__wrapper" }, el("input", { type: "file", style: { display: "none" } }))),
    formItem("出生日期", birthdayDate.component),
    formItem("籍贯", hometownSelect.component),
    formItem("最高学历", personalSelect.component),
    formItem("是否全日制", el("div", {}, ...fulltimeRadio)),
    formItem("是否可提前实习", el("div", {}, ...radioGroup(["是", "否"]))),
  ]);
  const schoolOne = input();
  const startOne = dateSelect(doc, "month");
  const educationOne = group(doc, "教育经历", "education_0", [formItem("学校名称", schoolOne), formItem("开始时间", startOne.component), el("input", { type: "checkbox" }), el("span", { text: "至今" })]);
  const schoolTwo = input();
  group(doc, "教育经历", "education_1", [formItem("学校名称", schoolTwo)]);
  const awardDate = dateSelect(doc, "day");
  const awardLevel = select(doc, ["班组级", "院校级", "县市级", "省区级", "国家级", "国际级", "公司级", "集团级"]);
  group(doc, "获奖情况", "award_0", [
    formItem("获奖项", input()),
    formItem("获奖时间", awardDate.component),
    formItem("获奖级别", awardLevel.component),
  ]);
  const certificateDate = dateSelect(doc, "day");
  group(doc, "证书", "certificate_0", [
    formItem("证书名称", input()),
    formItem("获得时间", certificateDate.component),
  ]);
  const declaration = el("input", { type: "checkbox" });
  doc.body.append(el("div", { className: "statement" }, el("span", { text: "声明：以上所填均属本人实际情况" }), declaration));
  const submit = el("button", { text: "预览并提交" });
  doc.body.append(submit);
  return { doc, resumeFile, personalSelect, hometownSelect, birthdayDate, fulltimeRadio, schoolOne, schoolTwo, startOne, educationOne, awardDate, awardLevel, certificateDate, declaration, submit };
}

function loadScript(file, context) {
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
}

function makeContext(fixture, hostname = "flyaitalent.zhiye.com") {
  const ctx = {
    window: { __WSZ: {} },
    document: fixture.doc,
    location: { hostname, pathname: "/form", hash: "", search: "" },
    setTimeout,
    clearTimeout,
    Date,
    getComputedStyle: (node) => ({ display: node.style.display || "", visibility: node.style.visibility || "" }),
    Event: class { constructor(type, init) { this.type = type; Object.assign(this, init || {}); } },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init || {}); } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init || {}); } },
  };
  vm.createContext(ctx);
  loadScript("extension/lib/util.js", ctx);
  loadScript("extension/lib/schema.js", ctx);
  loadScript("extension/content/detect.js", ctx);
  loadScript("extension/content/scanner.js", ctx);
  loadScript("extension/content/adapters/generic.js", ctx);
  loadScript("extension/content/adapters/moka.js", ctx);
  loadScript("extension/content/adapters/beisen.js", ctx);
  loadScript("extension/content/adapters/registry.js", ctx);
  loadScript("extension/content/matcher.js", ctx);
  loadScript("extension/content/writer.js", ctx);
  loadScript("extension/content/learn.js", ctx);
  ctx.window.__WSZ.sleep = async () => {};
  ctx.window.__WSZ.emitInputEvents = (element) => {
    if (element && element.dispatchEvent) {
      element.dispatchEvent({ type: "input" });
      element.dispatchEvent({ type: "change" });
    }
  };
  return ctx;
}

function testPlatformEvidenceAndBoundaries(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  assert.equal(NS.detectProvider(seed).key, "beisen");
  assert.equal(NS.beisenFormState({ document: fixture.doc, location: ctx.location }).status, "BEISEN_FORM_CONFIRMED");
  ctx.location.pathname = "/job/detail";
  assert.equal(NS.beisenFormState({ document: fixture.doc, location: ctx.location }).status, "BEISEN_SITE_NON_FORM");
  ctx.location.pathname = "/form";
  ctx.location.hostname = "fake-zhiye.com";
  assert.equal(NS.detectProvider(seed).key, null);
  assert.equal(NS.beisenFormState({ document: fixture.doc, location: ctx.location }).status, "BEISEN_UNCERTAIN");
  ctx.location.hostname = "flyaitalent.zhiye.com";
  assert.equal(NS.beisenFormState({ document: fixture.doc, location: ctx.location }).status, "BEISEN_FORM_CONFIRMED");
  assert.equal(fixture.doc.querySelectorAll(".form-item").length, 16);
}

function testScanIdentityAndSafety(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  const merged = NS.mergedRules(seed, "beisen");
  const fields = NS.adapterRegistry.scanFields("beisen", { document: fixture.doc, location: ctx.location, mergedRules: merged, provider: { key: "beisen" } });
  const schools = fields.filter((field) => field.label === "学校名称");
  assert.equal(schools.length, 2);
  assert.equal(JSON.stringify(schools.map((field) => field.repeater.itemIndex)), JSON.stringify([0, 1]));
  assert.equal(JSON.stringify(schools.map((field) => field.identity)), JSON.stringify([
    { sectionKey: "education", itemIndex: 0, fieldKey: "学校名称" },
    { sectionKey: "education", itemIndex: 1, fieldKey: "学校名称" },
  ]));
  assert.equal(fields.filter((field) => field.label === "性别").length, 1);
  assert.equal(fields.find((field) => field.label === "性别").kind, "radio");
  assert.equal(fields.find((field) => field.label === "最高学历").kind, "select");
  assert.equal(fields.find((field) => field.label === "籍贯").kind, "search-select");
  assert.equal(fields.find((field) => field.label === "籍贯").controlVariant, "area-selector");
  assert.equal(fields.find((field) => field.label === "籍贯").defaultValue, undefined);
  assert.equal(fields.find((field) => field.label === "是否全日制").defaultValue, "是");
  assert.equal(fields.find((field) => field.label === "开始时间").kind, "date");
  assert.equal(fields.find((field) => field.label === "获奖时间").kind, "date");
  assert.equal(fields.find((field) => field.label === "获得时间").kind, "date");
  assert.equal(fields.filter((field) => field.kind === "file").length, 2);
  assert.equal(fields.filter((field) => field.label === "声明").length, 1);
  assert.equal(fields.filter((field) => field.safetyRole === "submit").length, 1);
  assert.equal(fields.some((field) => field.label === "预览并提交" && field.kind !== "unknown"), false);
  assert.equal(fields.some((field) => field.label === "姓名" && field.container === field.controls[0]), false);
  assert.equal(NS.resolvePath(fields.find((field) => field.label === "学校名称"), merged), "education[0].school");
  assert.equal(NS.resolvePath(fields.find((field) => field.label === "开始时间"), merged), "education[0].start");
  assert.equal(NS.resolvePath(fields.find((field) => field.label === "籍贯"), merged), "basicInfo.nativePlace");
  assert.equal(NS.resolvePath({ label: "籍贯", section: "未识别区块", kind: "text" }, merged), null);
  assert.equal(NS.resolvePath({ label: "籍贯", section: "求职意向", kind: "text" }, merged), null);
  const plan = NS.buildPlan(fields.filter((field) => field.kind === "file" || field.safetyRole === "submit" || field.safetyRole === "declaration"), merged, NS.emptySnapshot());
  assert.equal(plan.plan.length, 0);
  assert.equal(plan.manual.length, 4);
}

function testRepeaterSafetyAndCoreBoundary(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  const merged = NS.mergedRules(seed, "beisen");
  const educationItem = fixture.educationOne.querySelector(".form-item");
  const wrongSection = NS.adapterRegistry.invoke("beisen", "getRepeaterItem", [educationItem, { sectionKey: "work" }]);
  assert.equal(wrongSection.itemIndex, null);
  assert.equal(wrongSection.itemElement, null);

  const detachedGroup = el("div", { className: "form", id: "fixture_Recruitment_extPerfect_detached" });
  const detachedItem = formItem("学校名称", input());
  detachedGroup.append(detachedItem);
  const missingGroup = NS.adapterRegistry.invoke("beisen", "getRepeaterItem", [detachedItem, { sectionKey: "education" }]);
  assert.equal(missingGroup.itemIndex, null);
  assert.equal(missingGroup.itemElement, null);

  const unresolved = {
    label: "学校名称",
    section: "教育经历",
    sectionKey: "education",
    repeater: { itemIndex: null, itemElement: null },
    index: 0,
    kind: "text",
  };
  assert.equal(NS.resolvePath(unresolved, merged), null);
  assert.equal(NS.buildPlan([unresolved], merged, { education: [{ school: "不应读取" }] }).plan.length, 0);

  const detectSource = fs.readFileSync(path.join(ROOT, "extension/content/detect.js"), "utf8");
  const mainSource = fs.readFileSync(path.join(ROOT, "extension/content/main.js"), "utf8");
  assert.doesNotMatch(detectSource, /BEISEN_FORM_CONFIRMED|BEISEN_SITE_NON_FORM|phoenix|Recruitment_extPerfect|\/form/);
  assert.doesNotMatch(mainSource, /provider\.key\s*===\s*["']beisen["']|BEISEN_|phoenix|\/form/);
}

async function testProviderReadWriteVerifyAndCapture(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  const merged = NS.mergedRules(seed, "beisen");
  const fields = NS.adapterRegistry.scanFields("beisen", { document: fixture.doc, location: ctx.location, mergedRules: merged });
  const gender = fields.find((field) => field.label === "性别");
  const initialGender = NS.adapterRegistry.invoke("beisen", "readControl", [gender, {}]);
  assert.equal(initialGender, null);
  assert.equal(gender.readStateUnknown, true);
  const male = gender.radioControls[0].querySelector(".phoenix-radio");
  male.classList.add("phoenix-radio--checked");
  assert.equal(NS.adapterRegistry.invoke("beisen", "readControl", [gender, {}]), "男");
  male.classList.remove("phoenix-radio--checked");
  const writeGender = await NS.adapterRegistry.invoke("beisen", "writeControl", [gender, "女", { merged, kind: "radio" }]);
  assert.equal(writeGender, true);
  assert.equal(await NS.adapterRegistry.invoke("beisen", "readControl", [gender, {}]), "女");
  assert.equal(await NS.adapterRegistry.invoke("beisen", "verifyControl", [gender, "女", { merged, kind: "radio", actual: "女" }]), true);
  for (const answer of ["男", "女", "保密"]) {
    const radioWrite = await NS.adapterRegistry.invoke("beisen", "writeControl", [gender, answer, { merged, kind: "radio" }]);
    assert.equal(radioWrite, true);
    assert.equal(NS.adapterRegistry.invoke("beisen", "readControl", [gender, {}]), answer);
    assert.equal(await NS.adapterRegistry.invoke("beisen", "verifyControl", [gender, answer, { merged, kind: "radio" }]), true);
  }
  assert.equal(await NS.adapterRegistry.invoke("beisen", "clearRadio", [gender, {}]), false);

  const fulltime = fields.find((field) => field.label === "是否全日制");
  assert.equal(NS.adapterRegistry.invoke("beisen", "readControl", [fulltime, {}]), null);
  const defaultPlan = NS.buildPlan([fulltime], merged, NS.emptySnapshot());
  assert.equal(defaultPlan.plan.length, 1);
  assert.equal(defaultPlan.plan[0].value, "是");
  const defaultResult = await NS.executePlan(defaultPlan.plan, merged, {
    delayMs: 0, adapterRegistry: NS.adapterRegistry, providerKey: "beisen",
  });
  assert.equal(defaultResult.verified, 1);
  assert.equal(NS.adapterRegistry.invoke("beisen", "readControl", [fulltime, {}]), "是");
  await NS.adapterRegistry.invoke("beisen", "writeControl", [fulltime, "否", { merged, kind: "radio" }]);
  const existingDefaultResult = await NS.executePlan(defaultPlan.plan, merged, {
    delayMs: 0, adapterRegistry: NS.adapterRegistry, providerKey: "beisen",
  });
  assert.equal(existingDefaultResult.skipped, 1);
  assert.equal(NS.adapterRegistry.invoke("beisen", "readControl", [fulltime, {}]), "否");

  const earlyInternship = fields.find((field) => field.label === "是否可提前实习");
  const earlyPlan = NS.buildPlan([earlyInternship], merged, NS.emptySnapshot());
  assert.equal(earlyPlan.plan.length, 0);
  assert.equal(earlyPlan.unmatched.length, 1);

  const hometown = fields.find((field) => field.label === "籍贯");
  assert.equal(NS.adapterRegistry.invoke("beisen", "readLocation", [hometown, {}]), "");
  const hometownWrite = await NS.adapterRegistry.invoke("beisen", "writeControl", [hometown, "湖南省邵阳市", { merged, kind: "search-select" }]);
  assert.equal(hometownWrite, true);
  assert.deepEqual(fixture.hometownSelect.searchValues, ["邵阳市"]);
  assert.equal(fixture.hometownSelect.placeholder._text, "邵阳市");
  assert.equal(NS.adapterRegistry.invoke("beisen", "readLocation", [hometown, {}]), "邵阳市");
  assert.equal(await NS.adapterRegistry.invoke("beisen", "verifyLocation", [hometown, "湖南省邵阳市", { merged }]), true);
  assert.equal(await NS.adapterRegistry.invoke("beisen", "clearLocation", [hometown, {}]), true);
  assert.equal(NS.adapterRegistry.invoke("beisen", "readLocation", [hometown, {}]), "");
  assert.equal(hometown._beisenConfirmedLocation, undefined);
  // moka 在 providers.moka 有显式别名「籍贯 → basicInfo.nativePlace」，新 matcher 的
  // provider-ambiguous-override 放行显式别名（该字段为 manual-only，仅供 capture/规则视图）；
  // generic 无别名仍必须拦截
  assert.equal(NS.resolvePath({ label: "籍贯", section: "个人信息", kind: "text" }, NS.mergedRules(seed, "moka")), "basicInfo.nativePlace");
  assert.equal(NS.resolvePath({ label: "籍贯", section: "个人信息", kind: "text" }, NS.mergedRules(seed, "generic")), null);

  const pendingLocation = locationSelect(fixture.doc);
  const pendingField = Object.assign({}, hometown, {
    controls: [pendingLocation.input],
    selectComponents: [pendingLocation.component],
    selectControls: [pendingLocation.input],
  });
  pendingLocation.component.click();
  const pendingCandidate = fixture.doc.querySelector(".area-item-container");
  assert.ok(pendingCandidate);
  pendingCandidate.click();
  assert.equal(await NS.adapterRegistry.invoke("beisen", "verifyLocation", [pendingField, "湖南省邵阳市", { merged }]), false);
  const pendingPopup = fixture.doc.querySelector(".common-unmodeled-layer");
  if (pendingPopup) pendingPopup.remove();
  pendingLocation.component.classList.remove("phoenix-select--active");

  const ambiguousLocation = locationSelect(fixture.doc, [
    { name: "邵阳市", path: "湖南省" },
    { name: "邵阳市", path: "广东省" },
  ]);
  fixture.doc.body.append(ambiguousLocation.component);
  const ambiguousField = NS.adapterRegistry.normalizeField({
    provider: "beisen", label: "籍贯", rawLabel: "籍贯", section: "个人信息", kind: "search-select", controlVariant: "area-selector",
    controls: [ambiguousLocation.input], selectComponents: [ambiguousLocation.component], selectControls: [ambiguousLocation.input], textControls: [],
  }, { providerKey: "beisen", mergedRules: merged });
  assert.equal(await NS.adapterRegistry.invoke("beisen", "writeControl", [ambiguousField, "邵阳市", { merged, kind: "search-select" }]), false);
  ambiguousLocation.component.remove();

  const highest = fields.find((field) => field.label === "最高学历");
  const writeSelect = await NS.adapterRegistry.invoke("beisen", "writeControl", [highest, "本科", { merged, kind: "select" }]);
  assert.equal(writeSelect, true);
  assert.equal(await NS.adapterRegistry.invoke("beisen", "readControl", [highest, {}]), "本科");
  assert.equal(await NS.adapterRegistry.invoke("beisen", "verifyControl", [highest, "本科", { merged, kind: "select", actual: "本科" }]), true);
  assert.equal(await NS.adapterRegistry.invoke("beisen", "clearControl", [highest, { kind: "select" }]), true);
  assert.equal(await NS.adapterRegistry.invoke("beisen", "readControl", [highest, {}]), "");

  const birthday = fields.find((field) => field.label === "出生日期");
  assert.equal(NS.adapterRegistry.invoke("beisen", "readDate", [birthday, {}]), "");
  assert.equal(await NS.adapterRegistry.invoke("beisen", "writeControl", [birthday, "2002-02-19", { merged, kind: "date" }]), true);
  assert.equal(NS.adapterRegistry.invoke("beisen", "readDate", [birthday, {}]), "2002.02.19");
  assert.equal(await NS.adapterRegistry.invoke("beisen", "verifyDate", [birthday, "2002-02-19", { merged }]), true);
  assert.equal(await NS.adapterRegistry.invoke("beisen", "clearControl", [birthday, { kind: "date" }]), true);
  assert.equal(NS.adapterRegistry.invoke("beisen", "readDate", [birthday, {}]), "");

  const educationStart = fields.find((field) => field.label === "开始时间");
  assert.equal(await NS.adapterRegistry.invoke("beisen", "writeControl", [educationStart, "2024-09", { merged, kind: "date" }]), true);
  assert.equal(NS.adapterRegistry.invoke("beisen", "readDate", [educationStart, {}]), "2024.09");
  assert.equal(await NS.adapterRegistry.invoke("beisen", "verifyDate", [educationStart, "2024-09", { merged }]), true);
  assert.equal(await NS.adapterRegistry.invoke("beisen", "clearDate", [educationStart, {}]), true);
  assert.equal(await NS.adapterRegistry.invoke("beisen", "writeControl", [educationStart, "2024-09-19", { merged, kind: "date" }]), true);
  assert.equal(educationStart._beisenDateVariant, "month-picker");
  assert.equal(NS.adapterRegistry.invoke("beisen", "readDate", [educationStart, {}]), "2024.09");
  assert.equal(await NS.adapterRegistry.invoke("beisen", "verifyDate", [educationStart, "2024-09-19", { merged }]), true);
  assert.equal(await NS.adapterRegistry.invoke("beisen", "clearDate", [educationStart, {}]), true);

  const missingDate = dateSelect(fixture.doc, "month", { months: ["8"] });
  fixture.doc.body.append(missingDate.component);
  const missingDateField = NS.adapterRegistry.normalizeField({
    provider: "beisen", label: "开始时间", rawLabel: "开始时间", section: "教育经历", sectionKey: "education", kind: "date",
    controls: [missingDate.input], selectComponents: [missingDate.component], selectControls: [missingDate.input], textControls: [],
    repeater: { itemIndex: 0, itemElement: null },
  }, { providerKey: "beisen", mergedRules: merged });
  assert.equal(await NS.adapterRegistry.invoke("beisen", "writeControl", [missingDateField, "2024-09", { merged, kind: "date" }]), false);
  const missingPopup = fixture.doc.querySelector(".phoenix-date-picker__wrap");
  if (missingPopup) missingPopup.remove();
  missingDate.component.classList.remove("phoenix-select--active");

  const duplicateDate = dateSelect(fixture.doc, "month", { months: ["9", "9"] });
  fixture.doc.body.append(duplicateDate.component);
  const duplicateDateField = Object.assign({}, missingDateField, {
    controls: [duplicateDate.input], selectComponents: [duplicateDate.component], selectControls: [duplicateDate.input],
  });
  assert.equal(await NS.adapterRegistry.invoke("beisen", "writeControl", [duplicateDateField, "2024-09", { merged, kind: "date" }]), false);
  const duplicateDatePopup = fixture.doc.querySelector(".phoenix-date-picker__wrap");
  if (duplicateDatePopup) duplicateDatePopup.remove();
  duplicateDate.component.classList.remove("phoenix-select--active");

  const awardDateField = fields.find((field) => field.label === "获奖时间");
  assert.equal(await NS.adapterRegistry.invoke("beisen", "writeControl", [awardDateField, "2024-09-19", { merged, kind: "date" }]), true);
  assert.equal(awardDateField._beisenDateVariant, "date-picker");
  assert.equal(NS.adapterRegistry.invoke("beisen", "readDate", [awardDateField, {}]), "2024.09.19");
  assert.equal(await NS.adapterRegistry.invoke("beisen", "verifyDate", [awardDateField, "2024-09-19", { merged }]), true);
  assert.equal(await NS.adapterRegistry.invoke("beisen", "clearDate", [awardDateField, {}]), true);

  const certificateDateField = fields.find((field) => field.label === "获得时间");
  assert.equal(await NS.adapterRegistry.invoke("beisen", "writeControl", [certificateDateField, "2024-09-19", { merged, kind: "date" }]), true);
  assert.equal(certificateDateField._beisenDateVariant, "date-picker");
  assert.equal(NS.adapterRegistry.invoke("beisen", "readDate", [certificateDateField, {}]), "2024.09.19");
  assert.equal(await NS.adapterRegistry.invoke("beisen", "verifyDate", [certificateDateField, "2024-09-19", { merged }]), true);
  assert.equal(await NS.adapterRegistry.invoke("beisen", "clearDate", [certificateDateField, {}]), true);

  const dayWithoutDate = dateSelect(fixture.doc, "day");
  fixture.doc.body.append(dayWithoutDate.component);
  const dayWithoutDateField = NS.adapterRegistry.normalizeField({
    provider: "beisen", label: "获奖时间", rawLabel: "获奖时间", section: "获奖情况", sectionKey: "award", kind: "date",
    controls: [dayWithoutDate.input], selectComponents: [dayWithoutDate.component], selectControls: [dayWithoutDate.input], textControls: [],
    repeater: { itemIndex: 0, itemElement: null },
  }, { providerKey: "beisen", mergedRules: merged });
  assert.equal(await NS.adapterRegistry.invoke("beisen", "writeControl", [dayWithoutDateField, "2024-09", { merged, kind: "date" }]), false);
  const dayWithoutDatePopup = fixture.doc.querySelector(".phoenix-date-picker__wrap");
  if (dayWithoutDatePopup) dayWithoutDatePopup.remove();
  dayWithoutDate.component.classList.remove("phoenix-select--active");
  dayWithoutDate.component.remove();

  const multiDateA = dateSelect(fixture.doc, "month");
  const multiDateB = dateSelect(fixture.doc, "month");
  fixture.doc.body.append(multiDateA.component, multiDateB.component);
  multiDateA.component.click();
  multiDateB.component.click();
  const multiDateField = Object.assign({}, missingDateField, {
    controls: [multiDateA.input], selectComponents: [multiDateA.component], selectControls: [multiDateA.input],
  });
  assert.equal(await NS.adapterRegistry.invoke("beisen", "writeControl", [multiDateField, "2024-09", { merged, kind: "date" }]), false);
  while (fixture.doc.querySelector(".phoenix-date-picker__wrap")) fixture.doc.querySelector(".phoenix-date-picker__wrap").remove();
  multiDateA.component.classList.remove("phoenix-select--active");
  multiDateB.component.classList.remove("phoenix-select--active");

  const internship0 = { label: "单位名称", rawLabel: "单位名称", section: "实习经历", sectionKey: "internship", kind: "text", repeater: { itemIndex: 0, itemElement: null } };
  const internship1 = { label: "单位名称", rawLabel: "单位名称", section: "实习经历", sectionKey: "internship", kind: "text", repeater: { itemIndex: 1, itemElement: null } };
  assert.equal(NS.resolvePath(internship0, merged), "internship[0].company");
  assert.equal(NS.resolvePath(internship1, merged), "internship[1].company");
  for (const [label, field] of [["职位名称", "title"], ["开始时间", "start"], ["结束时间", "end"], ["实习内容", "desc"]]) {
    assert.equal(NS.resolvePath({ label, section: "实习经历", sectionKey: "internship", kind: "text", repeater: { itemIndex: 0, itemElement: null } }, merged), `internship[0].${field}`);
    assert.equal(NS.resolvePath({ label, section: "实习经历", sectionKey: "internship", kind: "text", repeater: { itemIndex: 1, itemElement: null } }, merged), `internship[1].${field}`);
  }
  assert.equal(NS.resolvePath({ label: "单位名称", section: "其他经历", kind: "text" }, merged), null);

  const awardOptions = select(fixture.doc, ["班组级", "院校级", "县市级", "省区级", "国家级", "国际级", "公司级", "集团级"]);
  fixture.doc.body.append(awardOptions.component);
  const awardField = NS.adapterRegistry.normalizeField({
    provider: "beisen", label: "获奖级别", rawLabel: "获奖级别", section: "获奖情况", sectionKey: "award", kind: "select",
    controls: [awardOptions.input], selectComponents: [awardOptions.component], selectControls: [awardOptions.input], textControls: [],
    repeater: { itemIndex: 0, itemElement: null },
  }, { providerKey: "beisen", mergedRules: merged });
  assert.equal(NS.toOptionText(merged, "省级"), "省区级");
  assert.equal(await NS.adapterRegistry.invoke("beisen", "writeControl", [awardField, "省级", { merged, kind: "select" }]), true);
  assert.equal(NS.adapterRegistry.invoke("beisen", "readControl", [awardField, {}]), "省区级");
  awardOptions.component.remove();

  const missingAwardOptions = select(fixture.doc, ["国家级"]);
  fixture.doc.body.append(missingAwardOptions.component);
  const missingAwardField = Object.assign({}, awardField, {
    controls: [missingAwardOptions.input], selectComponents: [missingAwardOptions.component], selectControls: [missingAwardOptions.input],
  });
  assert.equal(await NS.adapterRegistry.invoke("beisen", "writeControl", [missingAwardField, "省级", { merged, kind: "select" }]), false);
  missingAwardOptions.component.remove();
  const missingAwardPopup = fixture.doc.querySelector(".phoenix-selectList");
  if (missingAwardPopup) missingAwardPopup.remove();

  const name = fields.find((field) => field.label === "姓名");
  name.textControls[0].value = "已有值";
  const result = await NS.executePlan([{ field: name, kind: "text", path: "basicInfo.name", value: "不应覆盖" }], merged, { delayMs: 0, adapterRegistry: NS.adapterRegistry, providerKey: "beisen" });
  assert.equal(result.skipped, 1);
  assert.equal(name.textControls[0].value, "已有值");
  const snapshot = NS.emptySnapshot();
  const captured = await NS.captureSnapshot([name], merged, snapshot, { adapterRegistry: NS.adapterRegistry, providerKey: "beisen" });
  assert.equal(captured.updated, 1);
  assert.equal(snapshot.basicInfo.name, "已有值");

  const duplicateSelect = select(fixture.doc, ["本科", "本科"]);
  fixture.doc.body.append(duplicateSelect.component);
  const duplicateField = NS.adapterRegistry.normalizeField({
    provider: "beisen", label: "最高学历", rawLabel: "最高学历", section: "个人信息", kind: "select",
    controls: [duplicateSelect.input], selectComponents: [duplicateSelect.component], selectControls: [duplicateSelect.input], textControls: [],
  }, { providerKey: "beisen", mergedRules: merged });
  assert.equal(await NS.adapterRegistry.invoke("beisen", "writeControl", [duplicateField, "本科", { merged, kind: "select" }]), false);
  duplicateSelect.component.remove();
  assert.equal(await NS.adapterRegistry.invoke("beisen", "clearControl", [{ kind: "unknown", controls: [] }, {}]), false);
  assert.equal(await NS.adapterRegistry.invoke("beisen", "clearControl", [{ kind: "file", manualOnly: true, controls: [] }, {}]), false);
}

async function testFallbackAndNonFormIsolation(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  const original = NS.scanFields;
  NS.scanFields = () => [{ label: "Generic字段", section: "个人信息", kind: "text", controls: [] }];
  ctx.location.hostname = "example.com";
  const fallback = NS.adapterRegistry.scanFields("beisen", { document: fixture.doc, location: ctx.location, mergedRules: NS.mergedRules(seed, "beisen") });
  assert.equal(fallback[0].label, "Generic字段");
  ctx.location.hostname = "flyaitalent.zhiye.com";
  ctx.location.pathname = "/job/detail";
  const nonForm = NS.adapterRegistry.scanFields("beisen", { document: fixture.doc, location: ctx.location, mergedRules: NS.mergedRules(seed, "beisen") });
  assert.equal(nonForm.length, 0);
  NS.scanFields = original;
}

function testProfileBStructure() {
  const fixture = buildProfileBFixture();
  const ctx = makeContext(fixture, "bestsemi.zhiye.com");
  const NS = ctx.window.__WSZ;
  const merged = NS.mergedRules(seed, "beisen");
  const state = NS.beisenFormState({ document: fixture.doc, location: ctx.location });
  assert.equal(state.status, "BEISEN_FORM_CONFIRMED");
  assert.equal(state.evidence.profiles.includes("perfectResumeDefault"), true);

  const fields = NS.adapterRegistry.scanFields("beisen", {
    document: fixture.doc,
    location: ctx.location,
    mergedRules: merged,
    provider: { key: "beisen" },
  });
  assert.equal(fields.length, 30);

  const personalName = fields.find((field) => field.section === "个人信息" && field.label === "姓名");
  assert.ok(personalName);
  assert.equal(personalName.sectionKey, null);
  assert.equal(personalName.repeater.itemIndex, null);
  assert.equal(NS.resolvePath(personalName, merged), "basicInfo.name");

  const educationSchools = fields.filter((field) => field.sectionKey === "education" && field.label === "学校名称");
  assert.equal(educationSchools.length, 2);
  assert.equal(JSON.stringify(educationSchools.map((field) => field.repeater.itemIndex)), JSON.stringify([0, 1]));
  assert.equal(JSON.stringify(educationSchools.map((field) => NS.resolvePath(field, merged))), JSON.stringify([
    "education[0].school",
    "education[1].school",
  ]));

  const workCompany = fields.find((field) => field.sectionKey === "work" && field.label === "公司名称");
  assert.ok(workCompany);
  assert.equal(workCompany.repeater.itemIndex, 0);
  assert.equal(NS.resolvePath(workCompany, merged), "work[0].company");

  const projectNames = fields.filter((field) => field.sectionKey === "project" && field.label === "项目名称");
  assert.equal(projectNames.length, 2);
  assert.equal(JSON.stringify(projectNames.map((field) => field.repeater.itemIndex)), JSON.stringify([0, 1]));
  assert.equal(JSON.stringify(projectNames.map((field) => NS.resolvePath(field, merged))), JSON.stringify([
    "project[0].name",
    "project[1].name",
  ]));

  assert.equal(fields.some((field) => ["实习经历", "获奖情况", "证书", "技能"].includes(field.section)), false);
  assert.equal(NS.adapterRegistry.canAddItem("beisen", "education"), false);

  // A supported Profile B id outside the current document cannot establish an
  // item position and must remain unmatched rather than becoming item 0.
  const detachedGroup = el("div", {
    className: "form",
    id: "detached_Recruitment_ApplicantEducationPerfectResumeDefaultForm",
  });
  const detachedItem = formItem("学校名称", input());
  detachedGroup.append(detachedItem);
  const detachedRepeater = NS.adapterRegistry.invoke("beisen", "getRepeaterItem", [
    detachedItem,
    { sectionKey: "education" },
  ]);
  assert.equal(detachedRepeater.itemIndex, null);
  assert.equal(detachedRepeater.itemElement, null);
  assert.equal(NS.resolvePath({
    label: "学校名称",
    section: "教育经历",
    sectionKey: "education",
    repeater: detachedRepeater,
    index: 0,
    kind: "text",
  }, merged), null);
}

async function main() {
  const fixture = buildFixture();
  const ctx = makeContext(fixture);
  testPlatformEvidenceAndBoundaries(ctx, fixture);
  ctx.location.hostname = "flyaitalent.zhiye.com";
  ctx.location.pathname = "/form";
  testScanIdentityAndSafety(ctx, fixture);
  testRepeaterSafetyAndCoreBoundary(ctx, fixture);
  await testProviderReadWriteVerifyAndCapture(ctx, fixture);
  await testFallbackAndNonFormIsolation(ctx, fixture);
  testProfileBStructure();
  console.log("PASS Beisen real-form adapter tests");
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exitCode = 1;
});
