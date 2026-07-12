import { jsxs, jsx } from "react/jsx-runtime";
import { useState, useTransition, useMemo } from "react";
import { M as MobileTop, S as Sidebar, T as Topbar, P as PromptCard, D as Dock, L as Lightbox } from "./PromptCard-DiqmozFG.js";
import { i as Route, c as cartAdd, f as favoritePrompt, a as fetchCatalog } from "./router-Dz0Qc7P8.js";
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
function Storefront() {
  const initial = Route.useLoaderData();
  const [model, setModel] = useState("All");
  const [sort, setSort] = useState("Featured");
  const [term, setTerm] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [preview, setPreview] = useState(null);
  const [catalog, setCatalog] = useState(initial);
  const [cart, setCart] = useState();
  const [toast, setToast] = useState("");
  const [, start] = useTransition();
  const prompts = useMemo(() => catalog.prompts, [catalog]);
  function refresh(next = {
    model,
    sort,
    term
  }) {
    start(async () => setCatalog(await fetchCatalog({
      data: next
    })));
  }
  function note(text) {
    setToast(text);
    window.setTimeout(() => setToast(""), 1800);
  }
  return /* @__PURE__ */ jsxs("main", { className: "app", children: [
    /* @__PURE__ */ jsx(MobileTop, { onMenu: () => setDrawer(true) }),
    /* @__PURE__ */ jsx(Sidebar, { counts: catalog.counts, open: drawer, onClose: () => setDrawer(false), onSearch: () => setSearchOpen(true) }),
    /* @__PURE__ */ jsxs("section", { className: "page", children: [
      /* @__PURE__ */ jsx(Topbar, { searchOpen, setSearchOpen, term, setTerm: (v) => {
        setTerm(v);
        refresh({
          model,
          sort,
          term: v
        });
      }, model, setModel: (v) => {
        setModel(v);
        refresh({
          model: v,
          sort,
          term
        });
      }, sort, setSort: (v) => {
        setSort(v);
        refresh({
          model,
          sort: v,
          term
        });
      } }),
      /* @__PURE__ */ jsxs("div", { className: "hero", children: [
        /* @__PURE__ */ jsx("p", { className: "mono", children: "Featured prompt marketplace" }),
        /* @__PURE__ */ jsx("h1", { children: "Power prompts for images, writing, code, marketing, and research." }),
        /* @__PURE__ */ jsx("p", { children: "Ranked by database scoring across rating, sales, recency, price, and featured status." })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "masonry", children: prompts.map((p) => /* @__PURE__ */ jsx(PromptCard, { prompt: p, onPreview: setPreview, onFavorite: (id) => start(async () => {
        await favoritePrompt({
          data: {
            promptId: id
          }
        });
        refresh();
        note("Favorites updated");
      }), onCart: (id) => start(async () => {
        setCart(await cartAdd({
          data: {
            promptId: id
          }
        }));
        refresh();
        note("Cart updated");
      }) }, p.id)) })
    ] }),
    /* @__PURE__ */ jsx(Dock, { cart }),
    /* @__PURE__ */ jsx(Lightbox, { prompt: preview, onClose: () => setPreview(null), onCart: (id) => start(async () => {
      setCart(await cartAdd({
        data: {
          promptId: id
        }
      }));
      setPreview(null);
      note("Added to Cart");
    }) }),
    toast ? /* @__PURE__ */ jsx("div", { className: "toast", children: toast }) : null
  ] });
}
export {
  Storefront as component
};
