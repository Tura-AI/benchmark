import { jsxs, jsx } from "react/jsx-runtime";
import { Link } from "@tanstack/react-router";
import { useState, useTransition, useEffect } from "react";
import { j as Route, f as favoritePrompt, c as cartAdd } from "./router-Dz0Qc7P8.js";
import "../server.js";
import "node:async_hooks";
import "h3-v2";
import "@tanstack/router-core";
import "seroval";
import "@tanstack/history";
import "@tanstack/router-core/ssr/client";
import "@tanstack/router-core/ssr/server";
import "@tanstack/react-router/ssr/server";
import "zod";
import "./db-Dyq5Uycb.js";
import "better-sqlite3";
import "node:fs";
import "node:path";
function Detail() {
  const p = Route.useLoaderData();
  const [msg, setMsg] = useState("");
  const [ready, setReady] = useState(false);
  const [, start] = useTransition();
  useEffect(() => setReady(true), []);
  return /* @__PURE__ */ jsxs("main", { className: "detail", children: [
    /* @__PURE__ */ jsx(Link, { to: "/", search: {
      category: "All"
    }, className: "back", children: "POWERPROMPT" }),
    /* @__PURE__ */ jsx("img", { src: p.image, alt: `${p.title} preview` }),
    /* @__PURE__ */ jsxs("section", { children: [
      /* @__PURE__ */ jsxs("p", { className: "mono", children: [
        p.model,
        " / ",
        p.category
      ] }),
      /* @__PURE__ */ jsx("h1", { children: p.title }),
      /* @__PURE__ */ jsx("p", { children: p.description }),
      /* @__PURE__ */ jsxs("dl", { children: [
        /* @__PURE__ */ jsx("dt", { children: "Creator" }),
        /* @__PURE__ */ jsx("dd", { children: p.creator }),
        /* @__PURE__ */ jsx("dt", { children: "Rank score" }),
        /* @__PURE__ */ jsx("dd", { children: p.rankScore }),
        /* @__PURE__ */ jsx("dt", { children: "Price" }),
        /* @__PURE__ */ jsx("dd", { children: p.priceCents ? `$${(p.priceCents / 100).toFixed(0)}` : "Free" }),
        /* @__PURE__ */ jsx("dt", { children: "Sales" }),
        /* @__PURE__ */ jsx("dd", { children: p.sold.toLocaleString() })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "actions", children: [
        /* @__PURE__ */ jsx("button", { disabled: !ready, onClick: () => start(async () => {
          await favoritePrompt({
            data: {
              promptId: p.id
            }
          });
          setMsg("Favorites updated");
        }), children: "Save to Favorites" }),
        /* @__PURE__ */ jsx("button", { disabled: !ready, className: "btn-ink", onClick: () => {
          setMsg("Added to Cart");
          start(async () => {
            await cartAdd({
              data: {
                promptId: p.id
              }
            });
          });
        }, children: "Add to Cart" })
      ] }),
      msg ? /* @__PURE__ */ jsx("p", { className: "status", children: msg }) : null
    ] })
  ] });
}
export {
  Detail as component
};
