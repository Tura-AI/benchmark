import { jsxs, jsx } from "react/jsx-runtime";
import { Link } from "@tanstack/react-router";
import { h as Route } from "./router-Dz0Qc7P8.js";
import "../server.js";
import "node:async_hooks";
import "h3-v2";
import "@tanstack/router-core";
import "seroval";
import "@tanstack/history";
import "@tanstack/router-core/ssr/client";
import "@tanstack/router-core/ssr/server";
import "react";
import "@tanstack/react-router/ssr/server";
import "zod";
import "./db-Dyq5Uycb.js";
import "better-sqlite3";
import "node:fs";
import "node:path";
function money(cents) {
  return `$${(Number(cents) / 100).toFixed(0)}`;
}
function Admin() {
  const a = Route.useLoaderData();
  return /* @__PURE__ */ jsxs("main", { className: "admin", children: [
    /* @__PURE__ */ jsx(Link, { to: "/", search: {
      category: "All"
    }, className: "back", children: "POWERPROMPT" }),
    /* @__PURE__ */ jsx("p", { className: "mono", children: "Creator analytics" }),
    /* @__PURE__ */ jsx("h1", { children: "Revenue, conversion, and prompt sales" }),
    /* @__PURE__ */ jsxs("section", { className: "metrics", children: [
      /* @__PURE__ */ jsxs("article", { children: [
        /* @__PURE__ */ jsx("span", { children: "Revenue" }),
        /* @__PURE__ */ jsx("b", { children: money(a.summary.revenueCents) })
      ] }),
      /* @__PURE__ */ jsxs("article", { children: [
        /* @__PURE__ */ jsx("span", { children: "Conversion" }),
        /* @__PURE__ */ jsxs("b", { children: [
          a.summary.conversionRate,
          "%"
        ] })
      ] }),
      /* @__PURE__ */ jsxs("article", { children: [
        /* @__PURE__ */ jsx("span", { children: "Average order value" }),
        /* @__PURE__ */ jsx("b", { children: money(a.summary.averageOrderValueCents) })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "analytics-grid", children: [
      /* @__PURE__ */ jsxs("section", { children: [
        /* @__PURE__ */ jsx("h2", { children: "Creator revenue" }),
        a.creatorRevenue.map((r) => /* @__PURE__ */ jsxs("p", { children: [
          /* @__PURE__ */ jsx("span", { children: r.creator }),
          /* @__PURE__ */ jsx("b", { children: money(r.revenueCents) })
        ] }, r.creator))
      ] }),
      /* @__PURE__ */ jsxs("section", { children: [
        /* @__PURE__ */ jsx("h2", { children: "Category revenue" }),
        a.categoryRevenue.map((r) => /* @__PURE__ */ jsxs("p", { children: [
          /* @__PURE__ */ jsx("span", { children: r.category }),
          /* @__PURE__ */ jsx("b", { children: money(r.revenueCents) })
        ] }, r.category))
      ] }),
      /* @__PURE__ */ jsxs("section", { children: [
        /* @__PURE__ */ jsx("h2", { children: "Daily trend" }),
        a.daily.map((r) => /* @__PURE__ */ jsxs("p", { children: [
          /* @__PURE__ */ jsx("span", { children: r.day }),
          /* @__PURE__ */ jsxs("b", { children: [
            money(r.revenueCents),
            " / ",
            r.conversionRate,
            "%"
          ] })
        ] }, r.day))
      ] })
    ] })
  ] });
}
export {
  Admin as component
};
