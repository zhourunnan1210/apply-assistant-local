/* Real-form-informed Moka Adapter tests. Run with: node tests/moka-adapter.test.js */
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

  // 与真实 DOM 对齐：titleText 等逻辑依赖 cloneNode(true) 后剔除按钮等噪音元素
  cloneNode(deep) {
    const copy = new FakeElement(this.tagName, {
      className: this._className, id: this.id, text: this._text, type: this.type,
      value: this.value, placeholder: this.placeholder, attributes: this.attributesMap,
    });
    copy.checked = this.checked;
    copy.style = Object.assign({}, this.style);
    if (deep) for (const child of this.children) copy.append(child.cloneNode(true));
    return copy;
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
    // 类名匹配前剔除属性选择器，避免属性值里的点（如 sugar.select.label）被误当类名
    const withoutAttrs = current.replace(/\[[^\]]*\]/g, "");
    for (const cls of [...withoutAttrs.matchAll(/\.([\w-]+)/g)]) {
      if (!this.classList.contains(cls[1])) return false;
    }
    for (const attr of [...current.matchAll(/\[([^\]=~*]+)(?:(\*=|=)"?([^\]]*)"?)?\]/g)]) {
      const name = attr[1].trim();
      const actual = this.getAttribute(name);
      if (actual == null) return false;
      if (attr[2] === "=" && String(actual) !== attr[3].replace(/"$/, "")) return false;
      if (attr[2] === "*=" && !String(actual).includes(attr[3].replace(/"$/, ""))) return false;
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

// ---- Moka 结构构造器（语义类 + 随机哈希后缀，模仿真实页面） ----
function hash() { return Math.random().toString(36).slice(2, 12); }

function titleEl(text, required) {
  return el("div", { className: `title-${hash()}` },
    el("span", {}, el("span", { text })),
    required ? el("span", { className: `required-asterisk-${hash()}` }) : el("span", {}));
}

function textInput(placeholder) {
  return el("input", { className: `sd-Input-input-${hash()}`, type: "text", placeholder: placeholder || "" });
}

function stringField(label, required) {
  return el("div", { className: `apply-field-${hash()} string_info-${hash()} apply-filed-padding-${hash()}` },
    titleEl(label, required),
    el("div", { className: `ctrl-${hash()}` },
      el("label", { className: `sd-Input-container-${hash()} string_info` }, textInput(label))));
}

function textareaField(label) {
  return el("div", { className: `apply-field-${hash()} text_info-${hash()} apply-filed-padding-${hash()}` },
    titleEl(label),
    el("div", { className: `ctrl-${hash()}` },
      el("textarea", { className: `sd-Textarea-textarea-${hash()} text_info`, placeholder: "内容" })));
}

// Moka 自绘下拉：选项就地渲染在自己的 sd-Dropdown-container 内
function sdSelect(options, shown) {
  const display = el("span", { className: `sd-Input-display-value-${hash()}` }, el("span", { text: shown || "" }));
  const input = el("input", { className: `sd-Input-input-${hash()}`, type: "text", placeholder: "请选择" });
  const clear = el("span", { className: `sd-Input-clear-${hash()}` });
  const component = el("label", { className: `sd-Input-container-${hash()} sd-Select-container-${hash()}` }, display, input, clear);
  const dropdown = el("div", { className: `sd-Dropdown-container-${hash()}` }, component);
  let menu = null;
  component.onClick = () => {
    if (menu) return;
    menu = el("div", { className: `sd-Select-menu-${hash()}` });
    for (const value of options) {
      const option = el("span", { className: `option-label-${hash()}`, text: value });
      option.onClick = () => {
        display.children[0]._text = value;
        if (menu) { menu.remove(); menu = null; }
      };
      menu.append(option);
    }
    dropdown.append(menu);
  };
  clear.onClick = () => { display.children[0]._text = ""; };
  return { dropdown, component, display, input, clear };
}

// Moka 年月下拉：选项是 span[data-key="sugar.select.label"]（无 option-label 类），
// 年份列表为虚拟滚动——初始只渲染头部几项，向输入框键入文本过滤后目标年份才出现。
function sdYmSelect(allOptions, initialOptions) {
  const display = el("span", { className: `sd-Input-display-value-${hash()}` }, el("span", { text: "" }));
  const input = el("input", { className: `sd-Input-input-${hash()}`, type: "text", placeholder: "请选择" });
  const clear = el("span", { className: `sd-Input-clear-${hash()}` });
  const component = el("label", { className: `sd-Input-container-${hash()} sd-Select-container-${hash()}` }, display, input, clear);
  const dropdown = el("div", { className: `sd-Dropdown-container-${hash()}` }, component);
  let menu = null;
  const renderMenu = (values) => {
    if (menu) menu.remove();
    menu = el("div", { className: `sd-Select-menu-${hash()}` });
    for (const value of values) {
      const option = el("span", { attributes: { "data-key": "sugar.select.label" }, text: value });
      option.onClick = () => {
        display.children[0]._text = value;
        if (menu) { menu.remove(); menu = null; }
      };
      menu.append(option);
    }
    dropdown.append(menu);
  };
  component.onClick = () => { if (!menu) renderMenu(initialOptions || allOptions); };
  input.onEvent = (event) => {
    if (event.type !== "input" || !menu) return;
    const q = String(input.value || "").trim();
    renderMenu(q ? allOptions.filter((v) => v.includes(q)) : (initialOptions || allOptions));
  };
  clear.onClick = () => { display.children[0]._text = ""; };
  return { dropdown, component, display, input, clear };
}

// 年份虚拟列表：从 2126 倒序渲染，初始可见窗口不含求职相关年份
function virtualYears() {
  const all = [];
  for (let y = 2126; y >= 2018; y--) all.push(String(y));
  return { all, initial: all.slice(0, 3) };
}

function selectField(label, options, semantic) {
  const s = sdSelect(options);
  return { field: el("div", { className: `apply-field-${hash()} ${semantic || "Select"}-${hash()} apply-filed-padding-${hash()}` },
    titleEl(label), el("div", { className: `ctrl-${hash()}` }, s.dropdown)), select: s };
}

// date_info：单点年月（2 个下拉）；年份走虚拟列表（初始窗口不含 2024，必须输入过滤）
function monthField(label) {
  const years = virtualYears();
  const year = sdYmSelect(years.all, years.initial);
  const month = sdYmSelect(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
  return { field: el("div", { className: `apply-field-${hash()} date_info-${hash()} apply-filed-padding-${hash()}` },
    titleEl(label),
    el("div", { className: `ctrl-${hash()}` },
      el("div", { className: `month-range-select date_info wrapper-${hash()}` },
        el("div", { className: `item-half-${hash()}` }, year.dropdown),
        el("div", { className: `item-half-${hash()}` }, month.dropdown)))),
    year, month };
}

// date_info：起止年月（4 个下拉 + 至今 checkbox）；年月选项同为 data-key span
function rangeField(label) {
  const months = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
  const sy = sdYmSelect(["2022", "2021", "2020", "2019"]);
  const sm = sdYmSelect(months);
  const ey = sdYmSelect(["2023", "2022", "2021", "2020"]);
  const em = sdYmSelect(months);
  const forever = el("input", { type: "checkbox" });
  forever.onClick = () => { forever.checked = !forever.checked; };
  return { field: el("div", { className: `apply-field-${hash()} date_info-${hash()} apply-filed-padding-${hash()} full-width-field-${hash()}` },
    titleEl(label),
    el("div", { className: `ctrl-${hash()}` },
      el("div", { className: `month-range-select date_info wrapper-${hash()}` },
        el("div", { className: `item-${hash()}` }, sy.dropdown),
        el("div", { className: `item-${hash()}` }, sm.dropdown),
        el("span", { text: "-" }),
        el("div", { className: `item-${hash()}` }, ey.dropdown),
        el("div", { className: `item-${hash()}` }, em.dropdown)),
      el("label", {}, forever, el("span", { text: "至今" })))),
    sy, sm, ey, em, forever };
}

function dayField(label) {
  return el("div", { className: `apply-field-${hash()} day_info-${hash()} apply-filed-padding-${hash()}` },
    titleEl(label, true),
    el("div", { className: `ctrl-${hash()}` },
      el("label", { className: `sd-Input-container-${hash()} day_info` },
        el("input", { className: `sd-Input-input-${hash()}`, type: "text", placeholder: label, attributes: { readonly: "" } }))));
}

function cascaderField(label, semantic) {
  const s = sdSelect([]);
  return el("div", { className: `apply-field-${hash()} ${semantic}-${hash()} apply-filed-padding-${hash()}` },
    titleEl(label, true), el("div", { className: `ctrl-${hash()}` }, s.dropdown));
}

function fileField(label) {
  return el("div", { className: `apply-field-${hash()} file_upload-${hash()} apply-filed-padding-${hash()}` },
    titleEl(label, true),
    el("div", { className: `ctrl-${hash()}` },
      el("div", { className: "file_upload" },
        el("button", { text: label }),
        el("input", { type: "file", style: { display: "none" } }))));
}

function confirmField(label) {
  const box = el("input", { type: "checkbox" });
  return el("div", { className: `apply-field-${hash()} confirm_info-${hash()} apply-filed-padding-${hash()}` },
    titleEl(label),
    el("div", { className: `ctrl-${hash()}` }, el("label", {}, box, el("span", { text: "本人承诺以上信息属实" }))));
}

// 远程搜索下拉（学校/专业）：string_info 语义 + sd-Select-container 内的输入框；
// 键入文本（input 事件）后模拟服务端检索渲染候选行（外层 list-item + 内层 menu-item 嵌套，同真实结构）；
// 清除 × 仅 hover 时出现（sd-Input-clear-*）。
function searchComboField(label, options) {
  const display = el("span", { className: `sd-Input-display-value-${hash()}` }, el("span", { text: "" }));
  const input = el("input", { className: `sd-Input-input-${hash()}`, type: "text", placeholder: label });
  const clear = el("span", { className: `sd-Input-clear-${hash()}`, style: { display: "none" } });
  const component = el("label", { className: `sd-Input-container-${hash()} sd-Select-container-${hash()}` }, display, input, clear);
  const dropdown = el("div", { className: `sd-Dropdown-container-${hash()}` }, component);
  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  input.onEvent = (event) => {
    if (event.type !== "input") return;
    closeMenu();
    const q = String(input.value || "").trim();
    if (!q) return;
    menu = el("div", { className: `sd-Select-menu-${hash()}` });
    for (const opt of options.filter((o) => o.includes(q))) {
      const inner = el("div", { className: `sd-Menu-common-item-${hash()}`, text: opt });
      inner.onClick = () => { display.children[0]._text = opt; input.value = ""; closeMenu(); };
      menu.append(el("div", { className: `sd-list-item-${hash()}` }, inner));
    }
    menu.append(el("div", { className: `sd-footer-item-${hash()}`, text: "没有找到学校？添加学校全称" }));
    dropdown.append(menu);
  };
  component.onEvent = (event) => {
    if (event.type === "mouseover" || event.type === "mouseenter") clear.style.display = "";
  };
  clear.onClick = () => { display.children[0]._text = ""; };
  return { field: el("div", { className: `apply-field-${hash()} string_info-${hash()} apply-filed-padding-${hash()}` },
    titleEl(label), el("div", { className: `ctrl-${hash()}` }, dropdown)),
    combo: { dropdown, component, display, input, clear } };
}

// 基础信息（账号级只读）：basic-block + field-* 容器 + disabled 输入框
function disabledBasicField(label) {
  return el("div", { className: `field-${hash()}` },
    el("div", { className: `filed-title-${hash()}` }, el("span", { text: label })),
    el("input", { className: `sd-Input-input-${hash()}`, type: "text", placeholder: label, attributes: { disabled: "" } }));
}

function basicBlock(title, ...fields) {
  return el("div", { className: `basic-block-${hash()}` },
    el("div", { className: `blockTitle-${hash()}` }, el("span", { text: title })), ...fields);
}

function applyBlock(title, repeatable, ...wrappers) {
  const addBtn = repeatable ? el("button", { className: `add-btn-${hash()}`, text: "添加" }) : el("span", {});
  const titleNode = el("div", { className: `blockTitle-${hash()}` },
    el("span", { text: title }), addBtn);
  const block = el("div", { className: `apply-block-${hash()}` }, titleNode, ...wrappers);
  // 模拟真实页面：点「添加」追加一个空 item
  block.setItemFactory = (factory) => { addBtn.onClick = () => block.append(factory()); };
  return block;
}

function itemWrapper(...fields) {
  return el("div", { className: `apply-fields-${hash()} multi-${hash()}` }, ...fields);
}

function buildFixture() {
  const doc = new FakeDocument();

  const positionCascader = cascaderField("应聘岗位", "cascader");
  doc.body.append(applyBlock("申请信息", false, itemWrapper(positionCascader)));

  const upload = fileField("上传简历");
  doc.body.append(applyBlock("上传", false, itemWrapper(upload)));

  const gender = selectField("性别", ["男", "女"]);
  const degree = selectField("学历", ["本科", "硕士"]);
  const orgTime = monthField("参加组织时间");
  const birthday = dayField("出生日期 (年龄)");
  const nativePlace = cascaderField("籍贯", "location_info");
  doc.body.append(applyBlock("个人信息", false, itemWrapper(
    stringField("姓名", true), gender.field, birthday, nativePlace, orgTime.field)));

  const eduRange1 = rangeField("就读时间");
  const edu1 = itemWrapper(eduRange1.field, stringField("学校名称"), selectField("学历", ["硕士", "博士"]).field);
  const eduRange2 = rangeField("就读时间");
  const edu2 = itemWrapper(eduRange2.field, stringField("学校名称"), selectField("学历", ["本科", "硕士"]).field);
  const eduBlock = applyBlock("教育背景", true, edu1, edu2);
  eduBlock.setItemFactory(() => itemWrapper(rangeField("就读时间").field, stringField("学校名称"), selectField("学历", ["本科", "硕士"]).field));
  doc.body.append(eduBlock);

  const internRange = rangeField("起止时间");
  const internDuty = textareaField("工作职责");
  doc.body.append(applyBlock("实习经历", true, itemWrapper(internRange.field, stringField("公司名称"), internDuty)));

  const declaration = confirmField("个人声明");
  doc.body.append(applyBlock("声明", false, itemWrapper(declaration)));

  // 远程搜索下拉（其他信息区块，避免影响教育背景 repeater 计数）
  const combo = searchComboField("意向学校", ["华中科技大学", "华中科技大学网络教育学院", "复旦大学", "复旦大学"]);
  doc.body.append(applyBlock("其他信息", false, itemWrapper(combo.field)));

  // 基础信息（账号级禁用）
  doc.body.append(basicBlock("基础信息", disabledBasicField("邮箱")));

  const submit = el("button", { text: "保存" });
  doc.body.append(submit);
  const sync = el("span", { text: "同步更新在线简历" });
  doc.body.append(el("div", { className: `sync-bar-${hash()}` }, sync));

  return {
    doc, gender, degree, orgTime, eduRange1, eduRange2, edu1, edu2, eduBlock,
    internRange, internDuty, declaration, submit, sync, combo,
  };
}

function loadScript(file, context) {
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
}

function makeContext(fixture) {
  const ctx = {
    window: { __WSZ: {} },
    document: fixture.doc,
    location: { hostname: "app.mokahr.com", pathname: "/campus-recruitment/example/12345", hash: "#/job/abc/apply", search: "" },
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
  loadScript("extension/content/adapters/registry.js", ctx);
  loadScript("extension/content/matcher.js", ctx);
  loadScript("extension/content/writer.js", ctx);
  loadScript("extension/content/learn.js", ctx);
  ctx.window.__WSZ.sleep = async () => {};
  ctx.window.__WSZ.emitInputEvents = (target) => {
    for (const type of ["input", "change"]) target.dispatchEvent(new ctx.Event(type, { bubbles: true }));
  };
  return ctx;
}

function scan(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  const merged = NS.mergedRules(seed, "moka");
  return NS.adapterRegistry.scanFields("moka", { document: fixture.doc, location: ctx.location, mergedRules: merged, provider: { key: "moka" } });
}

function testPlatformEvidence(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  assert.equal(NS.detectProvider(seed).key, "moka");
  assert.equal(NS.mokaFormState({ document: fixture.doc, location: ctx.location }).status, "MOKA_FORM_CONFIRMED");
  // 非表单 Moka 页面（无任何 apply-block/apply-field）：不接管
  const emptyDoc = new FakeDocument();
  assert.equal(NS.mokaFormState({ document: emptyDoc, location: ctx.location }).status, "MOKA_NON_FORM");
  const emptyScan = NS.adapterRegistry.scanFields("moka", { document: emptyDoc, location: ctx.location });
  assert.equal(emptyScan.length, 0);
  // 非 Moka 域名：交回 Generic
  ctx.location.hostname = "example.com";
  const NS2 = ctx.window.__WSZ;
  const original = NS2.scanFields;
  NS2.scanFields = () => [{ label: "Generic字段", section: "个人信息", kind: "text", controls: [] }];
  const fallback = NS2.adapterRegistry.scanFields("moka", { document: fixture.doc, location: ctx.location, mergedRules: NS2.mergedRules(seed, "moka") });
  assert.equal(fallback[0].label, "Generic字段");
  NS2.scanFields = original;
  ctx.location.hostname = "app.mokahr.com";
}

function testSectionsAndClassification(ctx, fixture) {
  const fields = scan(ctx, fixture);
  const byLabel = (l) => fields.filter((f) => f.label === l);
  // section 识别
  assert.equal(byLabel("应聘岗位")[0].section, "申请信息");
  assert.equal(byLabel("姓名")[0].section, "个人信息");
  assert.equal(byLabel("就读时间").length, 2);
  assert.equal(byLabel("就读时间")[0].section, "教育背景");
  assert.equal(byLabel("公司名称")[0].section, "实习经历");
  assert.equal(byLabel("个人声明")[0].section, "声明");
  // 控件分类（语义类）
  assert.equal(byLabel("姓名")[0].kind, "text");
  assert.equal(byLabel("性别")[0].kind, "select");
  assert.equal(byLabel("工作职责")[0].kind, "textarea");
  assert.equal(byLabel("参加组织时间")[0].kind, "date");
  assert.equal(byLabel("就读时间")[0].kind, "range");
  assert.equal(byLabel("起止时间")[0].kind, "range");
  assert.equal(byLabel("上传简历")[0].kind, "file");
  // required 识别
  assert.equal(byLabel("姓名")[0].required, true);
  // 安全边界：manual-only
  assert.equal(byLabel("上传简历")[0].manualOnly, true);
  assert.equal(byLabel("个人声明")[0].safetyRole, "declaration");
  assert.equal(fields.filter((f) => f.safetyRole === "submit").length, 1);
  assert.equal(fields.filter((f) => f.safetyRole === "sync").length, 1);
  // 日历/级联：不写入（manual）
  assert.equal(byLabel("出生日期")[0].manualOnly, true);
  assert.equal(byLabel("籍贯")[0].manualOnly, true);
  // buildPlan 安全：manual-only 不进入填写计划
  const NS = ctx.window.__WSZ;
  const merged = NS.mergedRules(seed, "moka");
  const plan = NS.buildPlan(fields.filter((f) => f.manualOnly || f.safetyRole), merged, NS.emptySnapshot());
  assert.equal(plan.plan.length, 0);
}

function testRepeaterIdentity(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  let fields = scan(ctx, fixture);
  let schools = fields.filter((f) => f.label === "学校名称");
  assert.equal(schools.length, 2);
  assert.equal(JSON.stringify(schools.map((f) => f.repeater.itemIndex)), JSON.stringify([0, 1]));
  assert.equal(schools[0].repeater.itemElement, fixture.edu1);
  assert.equal(schools[1].repeater.itemElement, fixture.edu2);
  assert.equal(JSON.stringify(schools.map((f) => f.identity)), JSON.stringify([
    { sectionKey: "education", itemIndex: 0, fieldKey: "学校名称" },
    { sectionKey: "education", itemIndex: 1, fieldKey: "学校名称" },
  ]));
  // resolvePath 走 repeater.itemIndex
  const merged = NS.mergedRules(seed, "moka");
  assert.equal(NS.resolvePath(schools[0], merged), "education[0].school");
  assert.equal(NS.resolvePath(schools[1], merged), "education[1].school");

  // DOM 顺序变化不串项：把第一条教育经历挪到第二条之后
  fixture.edu1.remove();
  fixture.eduBlock.append(fixture.edu1);
  fields = scan(ctx, fixture);
  const reordered = fields.filter((f) => f.label === "学校名称");
  const stillFirst = reordered.find((f) => f.repeater.itemElement === fixture.edu2);
  const stillSecond = reordered.find((f) => f.repeater.itemElement === fixture.edu1);
  assert.equal(stillFirst.repeater.itemIndex, 0, "edu2 现在排第一");
  assert.equal(stillSecond.repeater.itemIndex, 1, "edu1 现在排第二");
  assert.equal(NS.resolvePath(stillFirst, merged), "education[0].school");
  assert.equal(NS.resolvePath(stillSecond, merged), "education[1].school");
  // 还原顺序
  fixture.edu1.remove();
  fixture.eduBlock.children[0].parentElement = fixture.eduBlock;
  fixture.eduBlock.children.splice(1, 0, fixture.edu1);
  fixture.edu1.parentElement = fixture.eduBlock;
}

async function testSelectWriteUniqueAndDuplicate(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  const merged = NS.mergedRules(seed, "moka");
  const fields = scan(ctx, fixture);
  const gender = fields.find((f) => f.label === "性别");
  // 唯一精确候选：写入成功 + 回读 + 验证
  assert.equal(await NS.adapterRegistry.invoke("moka", "writeControl", [gender, "女", { merged, kind: "select" }]), true);
  assert.equal(await NS.adapterRegistry.invoke("moka", "readControl", [gender, {}]), "女");
  assert.equal(await NS.adapterRegistry.invoke("moka", "verifyControl", [gender, "女", { merged, kind: "select", actual: "女" }]), true);
  // 候选不存在：失败且不改变原值
  assert.equal(await NS.adapterRegistry.invoke("moka", "writeControl", [gender, "保密", { merged, kind: "select" }]), false);
  assert.equal(await NS.adapterRegistry.invoke("moka", "readControl", [gender, {}]), "女");

  // 多候选拒绝：两个同名候选一律不点
  const dup = sdSelect(["本科", "本科"]);
  const dupField = NS.adapterRegistry.normalizeField({
    provider: "moka", label: "学历", rawLabel: "学历", section: "教育背景", kind: "select", mokaKind: "select",
    container: dup.dropdown, controls: [dup.input], selectComponents: [dup.component], selectControls: [dup.input], textControls: [],
    repeater: { itemIndex: 0, itemElement: null },
  }, { providerKey: "moka", mergedRules: merged });
  assert.equal(await NS.adapterRegistry.invoke("moka", "writeControl", [dupField, "本科", { merged, kind: "select" }]), false);
  assert.equal(dup.display.textContent, "", "多候选时不得写入");
}

async function testDateRangeAndForever(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  const merged = NS.mergedRules(seed, "moka");
  const fields = scan(ctx, fixture);
  // 单点年月
  const org = fields.find((f) => f.label === "参加组织时间");
  assert.equal(await NS.adapterRegistry.invoke("moka", "writeControl", [org, "2024.09", { merged, kind: "date" }]), true);
  assert.equal(await NS.adapterRegistry.invoke("moka", "readControl", [org, {}]), "2024.09");
  assert.equal(await NS.adapterRegistry.invoke("moka", "verifyControl", [org, "2024.09", { merged, kind: "date", actual: "2024.09" }]), true);
  // 起止年月
  const range = fields.filter((f) => f.label === "就读时间")[0];
  assert.equal(await NS.adapterRegistry.invoke("moka", "writeControl", [range, { start: "2021.07", end: "2022.05" }, { merged, kind: "range" }]), true);
  let actual = await NS.adapterRegistry.invoke("moka", "readControl", [range, {}]);
  assert.equal(JSON.stringify(actual), JSON.stringify({ start: "2021.07", end: "2022.05" }));
  assert.equal(await NS.adapterRegistry.invoke("moka", "verifyControl", [range, { start: "2021.07", end: "2022.05" }, { merged, kind: "range" }]), true);
  // 至今
  const range2 = fields.filter((f) => f.label === "就读时间")[1];
  assert.equal(await NS.adapterRegistry.invoke("moka", "writeControl", [range2, { start: "2020.08", end: "至今" }, { merged, kind: "range" }]), true);
  actual = await NS.adapterRegistry.invoke("moka", "readControl", [range2, {}]);
  assert.equal(JSON.stringify(actual), JSON.stringify({ start: "2020.08", end: "至今" }));
  assert.equal(fixture.eduRange2.forever.checked, true);
}

async function testVirtualYearListFilter(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  const merged = NS.mergedRules(seed, "moka");
  const fields = scan(ctx, fixture);
  const org = fields.find((f) => f.label === "参加组织时间");
  // 初始渲染不含目标年份（虚拟滚动列表，从 2126 倒序）
  fixture.orgTime.year.component.click();
  const visible = fixture.orgTime.year.dropdown.querySelectorAll('[data-key="sugar.select.label"]').map((o) => o.textContent);
  assert.equal(visible.includes("2024"), false, "初始选项不得包含 2024");
  // 写入走输入过滤路径后点选成功
  assert.equal(await NS.adapterRegistry.invoke("moka", "writeControl", [org, "2024.09", { merged, kind: "date" }]), true);
  assert.equal(await NS.adapterRegistry.invoke("moka", "readControl", [org, {}]), "2024.09");
  // 只读输入框不得尝试过滤（日历类控件的保护路径）
  const readonlySelect = sdYmSelect(["2024"], ["2126"]);
  readonlySelect.input.setAttribute("readonly", "");
  const roField = NS.adapterRegistry.normalizeField({
    provider: "moka", label: "目标年份", rawLabel: "目标年份", section: "教育背景", kind: "select", mokaKind: "select",
    container: readonlySelect.dropdown, controls: [readonlySelect.input],
    selectComponents: [readonlySelect.component], selectControls: [readonlySelect.input], textControls: [],
    repeater: { itemIndex: 0, itemElement: null },
  }, { providerKey: "moka", mergedRules: merged });
  assert.equal(await NS.adapterRegistry.invoke("moka", "writeControl", [roField, "2024", { merged, kind: "select" }]), false,
    "只读输入框的控件过滤不到目标时应失败而不是乱写");
}

async function testCaptureAndClear(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  const merged = NS.mergedRules(seed, "moka");
  const fields = scan(ctx, fixture);
  const name = fields.find((f) => f.label === "姓名");
  name.textControls[0].value = "示例姓名";
  const snapshot = NS.emptySnapshot();
  const captured = await NS.captureSnapshot([name], merged, snapshot, { adapterRegistry: NS.adapterRegistry, providerKey: "moka" });
  assert.equal(captured.updated, 1);
  assert.equal(snapshot.basicInfo.name, "示例姓名");
  // range capture
  const range = fields.filter((f) => f.label === "就读时间")[0];
  await NS.adapterRegistry.invoke("moka", "writeControl", [range, { start: "2021.07", end: "2022.05" }, { merged, kind: "range" }]);
  const snap2 = NS.emptySnapshot();
  await NS.captureSnapshot([range], merged, snap2, { adapterRegistry: NS.adapterRegistry, providerKey: "moka" });
  assert.equal(snap2.education[0].start, "2021.07");
  assert.equal(snap2.education[0].end, "2022.05");

  // clear：select 有清除按钮时可清空；清空后回读为空
  const gender = fields.find((f) => f.label === "性别");
  await NS.adapterRegistry.invoke("moka", "writeControl", [gender, "男", { merged, kind: "select" }]);
  assert.equal(await NS.adapterRegistry.invoke("moka", "clearControl", [gender, { kind: "select" }]), true);
  assert.equal(await NS.adapterRegistry.invoke("moka", "readControl", [gender, {}]), "");
  // text 清空走 Core
  assert.equal(await NS.adapterRegistry.invoke("moka", "clearControl", [name, { kind: "text" }]), true);
  assert.equal(name.textControls[0].value, "");
  // manual-only 不可清空
  assert.equal(await NS.adapterRegistry.invoke("moka", "clearControl", [fields.find((f) => f.label === "上传简历"), {}]), false);
  assert.equal(await NS.adapterRegistry.invoke("moka", "clearControl", [fields.find((f) => f.label === "个人声明"), {}]), false);
}

async function testSearchComboWriteReadClear(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  const merged = NS.mergedRules(seed, "moka");
  const fields = scan(ctx, fixture);
  const combo = fields.find((f) => f.label === "意向学校");
  // 分类：string_info + sd-Select-container => text + searchCombo
  assert.equal(combo.kind, "text");
  assert.equal(combo.searchCombo, true);
  assert.equal(combo.manualOnly, false);
  // 唯一精确候选（嵌套行取叶子）：写入成功 + 回读 display-value + 验证
  assert.equal(await NS.adapterRegistry.invoke("moka", "writeControl", [combo, "华中科技大学", { merged, kind: "text" }]), true);
  assert.equal(await NS.adapterRegistry.invoke("moka", "readControl", [combo, {}]), "华中科技大学");
  assert.equal(await NS.adapterRegistry.invoke("moka", "verifyControl", [combo, "华中科技大学", { merged, kind: "text" }]), true);
  // 无候选：失败且清掉已键入文本，不残留
  assert.equal(await NS.adapterRegistry.invoke("moka", "writeControl", [combo, "不存在的大学XYZ", { merged, kind: "text" }]), false);
  assert.equal(fixture.combo.combo.input.value, "", "失败时必须清空键入文本");
  assert.equal(await NS.adapterRegistry.invoke("moka", "readControl", [combo, {}]), "华中科技大学");
  // 同名多候选：拒绝
  assert.equal(await NS.adapterRegistry.invoke("moka", "writeControl", [combo, "复旦大学", { merged, kind: "text" }]), false);
  assert.equal(await NS.adapterRegistry.invoke("moka", "readControl", [combo, {}]), "华中科技大学");
  // 清空：hover 唤起 × 后点击
  assert.equal(await NS.adapterRegistry.invoke("moka", "clearControl", [combo, { kind: "text" }]), true);
  assert.equal(await NS.adapterRegistry.invoke("moka", "readControl", [combo, {}]), "");
}

function testDisabledFieldsManualOnly(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  const merged = NS.mergedRules(seed, "moka");
  const fields = scan(ctx, fixture);
  const email = fields.find((f) => f.label === "邮箱");
  assert.equal(email.section, "基础信息");
  assert.equal(email.kind, "text");
  assert.equal(email.manualOnly, true, "禁用控件必须转人工而不是判填写失败");
  // manual-only 不进入填写计划
  const plan = NS.buildPlan([email], merged, NS.emptySnapshot());
  assert.equal(plan.plan.length, 0);
}

async function testRangeNotSkippedAsExisting(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  const merged = NS.mergedRules(seed, "moka");
  const fields = scan(ctx, fixture);
  // 实习经历的 range 尚未被其他测试写入
  const range = fields.find((f) => f.label === "起止时间" && f.section === "实习经历");
  assert.equal(await NS.adapterRegistry.invoke("moka", "readControl", [range, {}]), "", "空 range 必须读为空串（否则被 Core 误判已有值而跳过）");
  const items = [{ field: range, kind: "range", value: { start: "2022.03", end: "2022.06" }, path: "internship[0].start~end" }];
  const results = await NS.executePlan(items, merged, { adapterRegistry: NS.adapterRegistry, providerKey: "moka", delayMs: 0 });
  assert.equal(results.skipped, 0, "空 range 不得被当作已有值跳过");
  assert.equal(results.filled, 1);
  assert.equal(results.failed.length, 0);
}

async function testEnsureItemCount(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  const merged = NS.mergedRules(seed, "moka");
  let fields = scan(ctx, fixture);
  assert.equal(fields.filter((f) => f.label === "学校名称").length, 2);
  const snapshot = NS.emptySnapshot();
  snapshot.education = [{}, {}, {}]; // 快照 3 条，页面 2 条
  const added = await NS.adapterRegistry.invoke("moka", "ensureItemCount", [fields, snapshot, { mergedRules: merged, document: fixture.doc }]);
  assert.equal(added, 1, "缺 1 条应点 1 次添加");
  fields = scan(ctx, fixture);
  const schools = fields.filter((f) => f.label === "学校名称");
  assert.equal(schools.length, 3, "添加后重扫应识别 3 条教育经历");
  assert.equal(JSON.stringify(schools.map((f) => f.repeater.itemIndex)), JSON.stringify([0, 1, 2]));
  assert.equal(NS.resolvePath(schools[2], merged), "education[2].school");
  // 条数已够：不再点击
  const again = await NS.adapterRegistry.invoke("moka", "ensureItemCount", [fields, snapshot, { mergedRules: merged, document: fixture.doc }]);
  assert.equal(again, 0);
}

function testAddItemCapabilityAndButton(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  const caps = NS.adapterRegistry.get("moka").capabilities.addItem;
  for (const key of ["education", "work", "internship", "project", "award", "language"]) {
    assert.equal(caps[key], true, `addItem.${key} 应开启`);
  }
  assert.equal(NS.adapterRegistry.canAddItem("moka", "education"), true);
  // sectionKey 与区块标题两种入参都能定位
  for (const arg of ["education", "教育背景"]) {
    const btn = NS.adapterRegistry.findAddButton("moka", arg, { document: fixture.doc });
    assert.ok(btn && /添加/.test(btn.textContent), `findAddButton(${arg}) 应定位到添加按钮`);
  }
  assert.equal(NS.adapterRegistry.findAddButton("moka", "不存在的区块", { document: fixture.doc }), null);
}

async function testManualOnlyAndAddItem(ctx, fixture) {
  const NS = ctx.window.__WSZ;
  const fields = scan(ctx, fixture);
  // manual-only / safetyRole 一律拒绝写入
  for (const label of ["上传简历", "个人声明", "出生日期", "籍贯", "应聘岗位", "邮箱"]) {
    const field = fields.find((f) => f.label === label);
    assert.equal(await NS.adapterRegistry.invoke("moka", "writeControl", [field, "任意值", { kind: field.kind }]), false, `${label} 不得写入`);
  }
  const submit = fields.find((f) => f.safetyRole === "submit");
  assert.equal(await NS.adapterRegistry.invoke("moka", "writeControl", [submit, "x", {}]), false);
  const sync = fields.find((f) => f.safetyRole === "sync");
  assert.equal(await NS.adapterRegistry.invoke("moka", "writeControl", [sync, "x", {}]), false);
}

function testSectionTitleVariants(ctx) {
  const NS = ctx.window.__WSZ;
  const merged = NS.mergedRules(seed, "moka");
  const scanOne = (title) => {
    const doc = new FakeDocument();
    doc.body.append(applyBlock(title, true, itemWrapper(stringField("学校名称"))));
    const fields = NS.adapterRegistry.scanFields("moka", { document: doc, location: ctx.location, mergedRules: merged, provider: { key: "moka" } });
    return { doc, field: fields.find((f) => f.label === "学校名称") };
  };
  // 字典变体 + 前缀归并 + 纯模糊命中：都应归并到正确的 sectionKey
  const cases = [
    ["教育经历", "education"], ["教育信息", "education"], ["学历信息", "education"], ["教育情况", "education"],
    ["实习经验", "internship"],
    ["项目实践", "project"], ["在校项目", "project"],
    ["工作经验", "work"], ["工作履历", "work"], ["全职工作", "work"],
    ["语言水平", "language"], ["外语能力", "language"], ["外语水平", "language"],
    ["获奖情况", "award"], ["荣誉奖励", "award"], ["荣誉奖项", "award"],
    ["获奖情况（省级以上）", "award"], // 前缀归并
    ["校内实习经历", "internship"], ["工作背景", "work"], ["在校获奖情况", "award"], // 纯模糊命中
  ];
  for (const [title, key] of cases) {
    const { field } = scanOne(title);
    assert.ok(field, `「${title}」区块应被扫描到`);
    assert.equal(field.sectionKey, key, `「${title}」应归并到 ${key}，实际 ${field.sectionKey}`);
  }
  // 干扰标题：排除词 / 非结构后缀，一律不得误归并
  for (const title of ["期望工作城市", "工作地点", "实习意向", "工作年限", "期望薪资", "语言成绩"]) {
    const { field } = scanOne(title);
    assert.ok(!field || !field.sectionKey, `「${title}」不得归并进任何 repeater 区块，实际 ${field && field.sectionKey}`);
  }
  // 按 sectionKey 找添加按钮：变体标题区块也要能定位（键比较修复）
  const { doc } = scanOne("教育信息");
  const btn = NS.adapterRegistry.findAddButton("moka", "education", { document: doc });
  assert.ok(btn && /添加/.test(btn.textContent), "「教育信息」区块应能按 education key 定位添加按钮");
}

async function main() {
  const fixture = buildFixture();
  const ctx = makeContext(fixture);
  testPlatformEvidence(ctx, fixture);
  testSectionsAndClassification(ctx, fixture);
  testSectionTitleVariants(ctx);
  testRepeaterIdentity(ctx, fixture);
  await testSelectWriteUniqueAndDuplicate(ctx, fixture);
  await testDateRangeAndForever(ctx, fixture);
  await testVirtualYearListFilter(ctx, fixture);
  await testCaptureAndClear(ctx, fixture);
  await testSearchComboWriteReadClear(ctx, fixture);
  testDisabledFieldsManualOnly(ctx, fixture);
  await testRangeNotSkippedAsExisting(ctx, fixture);
  await testEnsureItemCount(ctx, fixture);
  testAddItemCapabilityAndButton(ctx, fixture);
  await testManualOnlyAndAddItem(ctx, fixture);
  console.log("PASS Moka real-form adapter tests");
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exitCode = 1;
});
