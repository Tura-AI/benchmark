import { jsxs, jsx } from "react/jsx-runtime";
import { useState, useTransition } from "react";
import { M as MobileTop, S as Sidebar, P as PromptCard, D as Dock } from "./PromptCard-DiqmozFG.js";
import { R as Route, f as favoritePrompt, a as fetchCatalog, c as cartAdd } from "./router-Dz0Qc7P8.js";
import "@tanstack/react-router";
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
function Favorites() {
  const [catalog, setCatalog] = useState(Route.useLoaderData());
  const [drawer, setDrawer] = useState(false);
  const [, start] = useTransition();
  return /* @__PURE__ */ jsxs("main", { className: "app", children: [
    /* @__PURE__ */ jsx(MobileTop, { onMenu: () => setDrawer(true) }),
    /* @__PURE__ */ jsx(Sidebar, { counts: catalog.counts, open: drawer, onClose: () => setDrawer(false), onSearch: () => {
    } }),
    /* @__PURE__ */ jsxs("section", { className: "page narrow", children: [
      /* @__PURE__ */ jsx("h1", { children: "Favorites" }),
      /* @__PURE__ */ jsx("p", { className: "lede", children: "Saved prompts stay query-backed instead of local-only state." }),
      /* @__PURE__ */ jsx("div", { className: "masonry", children: catalog.prompts.map((p) => /* @__PURE__ */ jsx(PromptCard, { prompt: p, onPreview: () => {
      }, onCart: (id) => start(async () => {
        await cartAdd({
          data: {
            promptId: id
          }
        });
        setCatalog(await fetchCatalog({
          data: {
            favoritesOnly: true
          }
        }));
      }), onFavorite: (id) => start(async () => {
        await favoritePrompt({
          data: {
            promptId: id
          }
        });
        setCatalog(await fetchCatalog({
          data: {
            favoritesOnly: true
          }
        }));
      }) }, p.id)) })
    ] }),
    /* @__PURE__ */ jsx(Dock, {})
  ] });
}
export {
  Favorites as component
};
