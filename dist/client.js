window.__ModuleLoader__.load({
	id: "dsh-llm-codex-oauth",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.js
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);
var import_react = require("react");
var SECTION_ID = "codex-oauth";
function CodexSection() {
  const [data, setData] = (0, import_react.useState)(null);
  const [proxyUrl, setProxyUrl] = (0, import_react.useState)("");
  const [proxyDirty, setProxyDirty] = (0, import_react.useState)(false);
  const [proxyMessage, setProxyMessage] = (0, import_react.useState)("");
  const refresh = (0, import_react.useCallback)(async () => {
    try {
      const response = await fetch("/codex-oauth/status");
      setData(await response.json());
    } catch (error) {
      setData({ ok: false, statusText: error instanceof Error ? error.message : String(error) });
    }
  }, []);
  (0, import_react.useEffect)(() => {
    refresh();
    const timer = setInterval(refresh, 3e3);
    return () => clearInterval(timer);
  }, [refresh]);
  (0, import_react.useEffect)(() => {
    if (!proxyDirty && typeof data?.proxyUrl === "string") setProxyUrl(data.proxyUrl);
  }, [data?.proxyUrl, proxyDirty]);
  const act = (0, import_react.useCallback)(async (operation) => {
    try {
      await fetch(`/codex-oauth/${operation}`, { method: "POST" });
    } catch {
    }
    await refresh();
  }, [refresh]);
  const connected = data?.connected === true;
  const statusText = data?.statusText ?? "\u52A0\u8F7D\u4E2D\u2026";
  const pending = !connected && data?.verificationUrl;
  const updateProxy = (0, import_react.useCallback)(async (enabled) => {
    setProxyMessage("\u4FDD\u5B58\u4E2D\u2026");
    try {
      const response = await fetch("/codex-oauth/proxy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, proxyUrl })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setData(result);
      setProxyDirty(false);
      setProxyMessage(enabled ? `\u4EE3\u7406\u5DF2\u542F\u7528\uFF1A${result.proxyDisplayUrl}` : "\u4EE3\u7406\u5DF2\u5173\u95ED\uFF0C\u5F53\u524D\u4F7F\u7528\u76F4\u8FDE");
    } catch (error) {
      setProxyMessage(error instanceof Error ? error.message : String(error));
      await refresh();
    }
  }, [proxyUrl, refresh]);
  return (0, import_react.createElement)(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: "8px" } },
    pending ? (0, import_react.createElement)(
      "p",
      null,
      "\u8BF7\u6253\u5F00 ",
      (0, import_react.createElement)("a", { href: data.verificationUrl, target: "_blank", rel: "noreferrer" }, data.verificationUrl),
      "\uFF0C\u8F93\u5165\u8BBE\u5907\u7801 ",
      (0, import_react.createElement)("b", null, data.userCode)
    ) : (0, import_react.createElement)("p", null, statusText),
    connected ? (0, import_react.createElement)("button", { type: "button", onClick: () => act("logout") }, "\u767B\u51FA") : (0, import_react.createElement)("button", { type: "button", onClick: () => act("login") }, "\u767B\u5F55 ChatGPT \u8D26\u53F7"),
    connected && data?.expiresAt ? (0, import_react.createElement)("p", null, "access token \u5230\u671F\uFF1A", new Date(data.expiresAt).toLocaleString()) : null,
    (0, import_react.createElement)("hr", { style: { width: "100%", border: 0, borderTop: "1px solid #ddd" } }),
    (0, import_react.createElement)(
      "label",
      { style: { display: "flex", alignItems: "center", gap: "8px" } },
      (0, import_react.createElement)("input", {
        type: "checkbox",
        checked: data?.proxyEnabled === true,
        onChange: (event) => updateProxy(event.target.checked)
      }),
      "\u4F7F\u7528 HTTP(S) \u4EE3\u7406\uFF08\u53EF\u9009\uFF09"
    ),
    (0, import_react.createElement)(
      "div",
      { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
      (0, import_react.createElement)("input", {
        type: "url",
        value: proxyUrl,
        placeholder: "http://127.0.0.1:7897",
        onChange: (event) => {
          setProxyUrl(event.target.value);
          setProxyDirty(true);
        },
        style: { minWidth: "260px", flex: "1 1 260px" }
      }),
      (0, import_react.createElement)("button", { type: "button", onClick: () => updateProxy(data?.proxyEnabled === true) }, "\u4FDD\u5B58\u4EE3\u7406\u5730\u5740")
    ),
    proxyMessage ? (0, import_react.createElement)("p", null, proxyMessage) : null
  );
}
var name = "dsh-llm-codex-oauth";
var inject = ["slots"];
function apply(ctx) {
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: SECTION_ID,
    order: 100,
    label: "Codex \u8BA2\u9605 (ChatGPT)"
  }, CodexSection));
}

		return module.exports;
	}
});
