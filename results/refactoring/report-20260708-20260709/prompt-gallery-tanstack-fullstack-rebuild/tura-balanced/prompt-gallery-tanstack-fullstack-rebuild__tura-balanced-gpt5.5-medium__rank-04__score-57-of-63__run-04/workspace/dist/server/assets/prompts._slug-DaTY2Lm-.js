import { jsxs, jsx } from "react/jsx-runtime";
import { useRouter, Link } from "@tanstack/react-router";
import { useState } from "react";
import { A as AppShell, I as Icons } from "./AppShell-DZTaePo5.js";
import { T as Toast } from "./Toast-CdPyyTDS.js";
import { e as Route, t as toggleFavoriteFn, d as addToCartFn } from "./router-nuVZNGgF.js";
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
function PromptDetail() {
  const router = useRouter();
  const {
    prompt,
    catalog
  } = Route.useLoaderData();
  const [toast, setToast] = useState("");
  async function favorite() {
    const result = await toggleFavoriteFn({
      data: {
        promptId: prompt.id
      }
    });
    setToast(result.isFavorite ? "Saved to favorites" : "Removed from favorites");
    await router.invalidate();
  }
  async function cart() {
    await addToCartFn({
      data: {
        promptId: prompt.id
      }
    });
    setToast("Added to Cart");
    await router.invalidate();
  }
  return /* @__PURE__ */ jsxs("div", { className: "app detail-app", children: [
    /* @__PURE__ */ jsx(AppShell, { categories: catalog.categories, cartCount: catalog.cart.totals.itemCount }),
    /* @__PURE__ */ jsxs("main", { className: "detail-main", children: [
      /* @__PURE__ */ jsx(Link, { className: "back", to: "/", children: "Back to Featured" }),
      /* @__PURE__ */ jsxs("section", { className: "detail-grid", children: [
        /* @__PURE__ */ jsx("img", { className: "detail-img", src: prompt.imageUrl, alt: `${prompt.title} prompt preview` }),
        /* @__PURE__ */ jsxs("div", { className: "detail-copy", children: [
          /* @__PURE__ */ jsxs("span", { className: "model", children: [
            prompt.model,
            " / ",
            prompt.category
          ] }),
          /* @__PURE__ */ jsx("h1", { children: prompt.title }),
          /* @__PURE__ */ jsx("p", { children: prompt.description }),
          /* @__PURE__ */ jsxs("div", { className: "detail-stats", children: [
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
          /* @__PURE__ */ jsxs("div", { className: "detail-actions", children: [
            /* @__PURE__ */ jsxs("button", { onClick: favorite, type: "button", children: [
              /* @__PURE__ */ jsx(Icons.Heart, {}),
              " ",
              prompt.isFavorite ? "Saved" : "Save"
            ] }),
            /* @__PURE__ */ jsx("button", { className: "primary", onClick: cart, type: "button", children: prompt.price === 0 ? "Get it free" : `Add to Cart $${prompt.price}` })
          ] })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsx(Toast, { message: toast })
  ] });
}
export {
  PromptDetail as component
};
