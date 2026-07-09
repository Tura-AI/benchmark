import { jsxs, jsx } from "react/jsx-runtime";
import { Link } from "@tanstack/react-router";
import { A as AppShell } from "./AppShell-DZTaePo5.js";
import { a as Route } from "./router-nuVZNGgF.js";
import "lucide-react";
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
import "./queries-R7sLH0o3.js";
import "node:fs";
import "node:path";
function AdminRoute() {
  const {
    catalog,
    analytics
  } = Route.useLoaderData();
  return /* @__PURE__ */ jsxs("div", { className: "app", children: [
    /* @__PURE__ */ jsx(AppShell, { categories: catalog.categories, cartCount: catalog.cart.totals.itemCount, active: "admin" }),
    /* @__PURE__ */ jsxs("main", { className: "admin-main", children: [
      /* @__PURE__ */ jsx(Link, { className: "back", to: "/", children: "Back to gallery" }),
      /* @__PURE__ */ jsx("h1", { children: "Creator analytics" }),
      /* @__PURE__ */ jsxs("section", { className: "metric-strip", children: [
        /* @__PURE__ */ jsxs("b", { children: [
          "$",
          analytics.totals.revenue.toFixed(2)
        ] }),
        /* @__PURE__ */ jsxs("span", { children: [
          analytics.totals.orders,
          " orders"
        ] }),
        /* @__PURE__ */ jsxs("span", { children: [
          Math.round(analytics.totals.conversionRate * 100),
          "% conversion"
        ] }),
        /* @__PURE__ */ jsxs("span", { children: [
          "$",
          analytics.totals.averageOrderValue.toFixed(2),
          " AOV"
        ] })
      ] }),
      /* @__PURE__ */ jsxs("section", { className: "admin-grid", children: [
        /* @__PURE__ */ jsx(Panel, { title: "Creator revenue", children: analytics.creatorRevenue.map((row) => /* @__PURE__ */ jsxs("div", { className: "line", children: [
          /* @__PURE__ */ jsx("span", { children: row.creator }),
          /* @__PURE__ */ jsxs("b", { children: [
            "$",
            row.revenue.toFixed(2)
          ] }),
          /* @__PURE__ */ jsxs("em", { children: [
            row.sales,
            " sales / ",
            Math.round(row.conversionRate * 100),
            "%"
          ] })
        ] }, row.creator)) }),
        /* @__PURE__ */ jsx(Panel, { title: "Category revenue", children: analytics.categoryRevenue.map((row) => /* @__PURE__ */ jsxs("div", { className: "line", children: [
          /* @__PURE__ */ jsx("span", { children: row.category }),
          /* @__PURE__ */ jsxs("b", { children: [
            "$",
            row.revenue.toFixed(2)
          ] }),
          /* @__PURE__ */ jsxs("em", { children: [
            row.sales,
            " sales"
          ] })
        ] }, row.category)) }),
        /* @__PURE__ */ jsx(Panel, { title: "Daily sales trend", children: analytics.dailySales.map((row) => /* @__PURE__ */ jsxs("div", { className: "line", children: [
          /* @__PURE__ */ jsx("span", { children: row.day }),
          /* @__PURE__ */ jsxs("b", { children: [
            "$",
            row.revenue.toFixed(2)
          ] }),
          /* @__PURE__ */ jsxs("em", { children: [
            row.orders,
            " orders"
          ] })
        ] }, row.day)) })
      ] })
    ] })
  ] });
}
function Panel({
  title,
  children
}) {
  return /* @__PURE__ */ jsxs("article", { className: "panel", children: [
    /* @__PURE__ */ jsx("h2", { children: title }),
    children
  ] });
}
export {
  AdminRoute as component
};
