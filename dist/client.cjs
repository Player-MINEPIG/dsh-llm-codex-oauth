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
    connected && data?.expiresAt ? (0, import_react.createElement)("p", null, "access token \u5230\u671F\uFF1A", new Date(data.expiresAt).toLocaleString()) : null
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
