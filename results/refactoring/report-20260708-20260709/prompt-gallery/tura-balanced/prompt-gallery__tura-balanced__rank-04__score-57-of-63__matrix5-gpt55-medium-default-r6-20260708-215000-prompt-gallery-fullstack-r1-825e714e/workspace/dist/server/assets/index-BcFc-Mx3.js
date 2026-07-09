import { jsx, jsxs } from "react/jsx-runtime";
import { Link, useRouter } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { I as Icons, A as AppShell } from "./AppShell-DZTaePo5.js";
import { T as Toast } from "./Toast-CdPyyTDS.js";
import { b as Route, d as addToCartFn, t as toggleFavoriteFn } from "./router-nuVZNGgF.js";
import "lucide-react";
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
import "./queries-R7sLH0o3.js";
import "node:fs";
import "node:path";
function Lightbox({ prompt, onClose, onCart }) {
  if (!prompt) return null;
  const free = prompt.price === 0;
  return /* @__PURE__ */ jsx("div", { className: "lightbox open", role: "dialog", "aria-modal": "true", "aria-label": `${prompt.title} detail preview`, onClick: onClose, children: /* @__PURE__ */ jsxs("div", { className: "lb", onClick: (event) => event.stopPropagation(), children: [
    /* @__PURE__ */ jsx("button", { className: "lb__close", type: "button", "aria-label": "Close", onClick: onClose, children: /* @__PURE__ */ jsx(Icons.X, {}) }),
    /* @__PURE__ */ jsx("div", { className: "lb__img", children: /* @__PURE__ */ jsx("img", { src: prompt.imageUrl, alt: `${prompt.title} expanded preview` }) }),
    /* @__PURE__ */ jsxs("div", { className: "lb__body", children: [
      /* @__PURE__ */ jsxs("span", { className: "model", children: [
        prompt.model,
        " / ",
        prompt.category
      ] }),
      /* @__PURE__ */ jsx("h2", { children: prompt.title }),
      /* @__PURE__ */ jsx("p", { children: prompt.description }),
      /* @__PURE__ */ jsxs("div", { className: "lb__stats", children: [
        /* @__PURE__ */ jsxs("span", { children: [
          prompt.rating.toFixed(1),
          " rating"
        ] }),
        /* @__PURE__ */ jsxs("span", { children: [
          prompt.sold.toLocaleString(),
          " sold"
        ] }),
        /* @__PURE__ */ jsx("span", { children: prompt.creator })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "lb__buy", children: [
        /* @__PURE__ */ jsx("span", { className: `price ${free ? "free" : ""}`, children: free ? "Free" : `$${prompt.price}` }),
        /* @__PURE__ */ jsxs("button", { className: "add", onClick: () => onCart(prompt.id), type: "button", children: [
          free ? "Get it free" : "Add to cart",
          " ",
          /* @__PURE__ */ jsx(Icons.Zap, {})
        ] })
      ] })
    ] })
  ] }) });
}
function PromptCard({ prompt, onFavorite, onCart, onPreview }) {
  const free = prompt.price === 0;
  return /* @__PURE__ */ jsxs(
    "article",
    {
      className: `tile ${prompt.isFavorite ? "saved" : ""}`,
      style: { "--ar": prompt.aspectRatio },
      onClick: (event) => {
        const target = event.target;
        if (!target.closest("button,a")) onPreview(prompt);
      },
      children: [
        /* @__PURE__ */ jsx("button", { className: `savedmark ${prompt.isFavorite ? "on" : ""}`, "aria-label": `Save ${prompt.title}`, onClick: () => onFavorite(prompt.id), type: "button", children: /* @__PURE__ */ jsx(Icons.Bookmark, {}) }),
        /* @__PURE__ */ jsx(
          "button",
          {
            className: "imageButton",
            onClick: (event) => {
              event.stopPropagation();
              onPreview(prompt);
            },
            onPointerDown: (event) => {
              if (event.pointerType === "touch") onPreview(prompt);
            },
            type: "button",
            "aria-label": `Preview ${prompt.title}`,
            children: /* @__PURE__ */ jsx("img", { src: prompt.imageUrl, alt: `${prompt.title} prompt preview`, loading: "lazy" })
          }
        ),
        /* @__PURE__ */ jsxs("div", { className: "ov", children: [
          /* @__PURE__ */ jsxs("div", { className: "ov__top", children: [
            /* @__PURE__ */ jsx("span", { className: "model", children: prompt.model }),
            /* @__PURE__ */ jsxs("span", { className: "rating", children: [
              /* @__PURE__ */ jsx(Icons.Star, { fill: "currentColor" }),
              " ",
              prompt.rating.toFixed(1)
            ] })
          ] }),
          /* @__PURE__ */ jsx("h3", { children: prompt.title }),
          /* @__PURE__ */ jsx("p", { children: prompt.description }),
          /* @__PURE__ */ jsxs("div", { className: "meta", children: [
            /* @__PURE__ */ jsx("span", { children: prompt.category }),
            /* @__PURE__ */ jsxs("span", { children: [
              formatSold(prompt.sold),
              " sold"
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "ov__bottom", children: [
            /* @__PURE__ */ jsx("span", { className: `price ${free ? "free" : ""}`, children: free ? "Free" : `$${prompt.price}` }),
            /* @__PURE__ */ jsxs("button", { className: "add", type: "button", onClick: () => onCart(prompt.id), children: [
              free ? "Get" : "Add",
              " ",
              /* @__PURE__ */ jsx(Icons.Zap, { size: 12 })
            ] })
          ] }),
          /* @__PURE__ */ jsx(Link, { className: "detail-link", to: "/prompts/$slug", params: { slug: prompt.slug }, children: "Open detail" })
        ] })
      ]
    }
  );
}
function formatSold(value) {
  return value >= 1e3 ? `${(value / 1e3).toFixed(1).replace(".0", "")}k` : String(value);
}
function Storefront() {
  const router = useRouter();
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  const [searchOpen, setSearchOpen] = useState(Boolean(search.q));
  const [toast, setToast] = useState("");
  const [preview, setPreview] = useState();
  const columns = useMemo(() => buildColumns(data.prompts, 4), [data.prompts]);
  async function setSearch(next) {
    await router.navigate({
      to: "/",
      search: (prev) => ({
        ...prev,
        ...next
      })
    });
  }
  async function mutateFavorite(id) {
    const result = await toggleFavoriteFn({
      data: {
        promptId: id
      }
    });
    setToast(result.isFavorite ? "Saved to favorites" : "Removed from favorites");
    await router.invalidate();
  }
  async function mutateCart(id) {
    await addToCartFn({
      data: {
        promptId: id
      }
    });
    setToast("Added to Cart");
    await router.invalidate();
  }
  return /* @__PURE__ */ jsxs("div", { className: "app", children: [
    /* @__PURE__ */ jsx(AppShell, { categories: data.categories, cartCount: data.cart.totals.itemCount, active: search.favorites ? "favorites" : "home", onSearch: () => setSearchOpen((value) => !value), onCategory: (category) => setSearch({
      category,
      favorites: false
    }), onFavorites: () => setSearch({
      favorites: true,
      model: "all",
      category: "all"
    }) }),
    /* @__PURE__ */ jsxs("main", { className: "main", children: [
      /* @__PURE__ */ jsxs("div", { className: "mtop", children: [
        /* @__PURE__ */ jsx("button", { className: "burger", type: "button", "aria-label": "Open navigation", children: /* @__PURE__ */ jsx(Icons.Menu, {}) }),
        /* @__PURE__ */ jsx("b", { children: "POWERPROMPT" })
      ] }),
      /* @__PURE__ */ jsxs("section", { className: "topbar", children: [
        /* @__PURE__ */ jsxs("div", { className: "filterbar", children: [
          /* @__PURE__ */ jsx("div", { className: "ftabs", "aria-label": "Model filters", children: ["all", "GPT-4o", "Claude", "Midjourney", "Flux"].map((model) => /* @__PURE__ */ jsx("button", { className: `ftab ${search.model === model ? "active" : ""}`, onClick: () => setSearch({
            model,
            favorites: false
          }), type: "button", children: model === "all" ? "All models" : model }, model)) }),
          /* @__PURE__ */ jsx("div", { className: "fsort", "aria-label": "Sort controls", children: ["featured", "newest", "popular"].map((sort) => /* @__PURE__ */ jsx("button", { className: `sortbtn ${search.sort === sort ? "active" : ""}`, onClick: () => setSearch({
            sort
          }), type: "button", children: labelSort(sort) }, sort)) })
        ] }),
        /* @__PURE__ */ jsx("div", { className: `searchbar ${searchOpen ? "open" : ""}`, children: /* @__PURE__ */ jsxs("div", { className: "inner", children: [
          /* @__PURE__ */ jsx(Icons.Search, {}),
          /* @__PURE__ */ jsx("input", { value: search.q ?? "", onChange: (event) => setSearch({
            q: event.currentTarget.value
          }), placeholder: "Search prompts, creators, models", "aria-label": "Search prompts" })
        ] }) })
      ] }),
      /* @__PURE__ */ jsxs("section", { className: "gallery", "aria-label": "Prompt marketplace gallery", children: [
        /* @__PURE__ */ jsxs("div", { className: "gallery-head", children: [
          /* @__PURE__ */ jsxs("p", { className: "mono", children: [
            "Featured ",
            data.counts.featured,
            " / Free ",
            data.counts.free,
            " / Paid ",
            data.counts.paid
          ] }),
          /* @__PURE__ */ jsx("h1", { children: search.favorites ? "Favorites" : "Prompt Gallery" }),
          /* @__PURE__ */ jsx("a", { href: "/cart", children: "Cart" })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "masonry", children: columns.map((column, index) => /* @__PURE__ */ jsx("div", { className: "ms-col", children: column.map((prompt) => /* @__PURE__ */ jsx(PromptCard, { prompt, onFavorite: mutateFavorite, onCart: mutateCart, onPreview: setPreview }, prompt.id)) }, index)) })
      ] })
    ] }),
    /* @__PURE__ */ jsx(Lightbox, { prompt: preview, onClose: () => setPreview(void 0), onCart: mutateCart }),
    /* @__PURE__ */ jsx(Toast, { message: toast })
  ] });
}
function buildColumns(prompts, count) {
  return prompts.reduce((cols, prompt, index) => {
    cols[index % count].push(prompt);
    return cols;
  }, Array.from({
    length: count
  }, () => []));
}
function labelSort(sort) {
  return sort[0].toUpperCase() + sort.slice(1);
}
export {
  Storefront as component
};
