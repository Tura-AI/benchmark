import { jsxs, jsx } from "react/jsx-runtime";
import { useRouter, Link } from "@tanstack/react-router";
import { useState } from "react";
import { A as AppShell } from "./AppShell-DZTaePo5.js";
import { T as Toast } from "./Toast-CdPyyTDS.js";
import { R as Route, r as removeFromCartFn, c as checkoutFn } from "./router-nuVZNGgF.js";
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
function CartRoute() {
  const router = useRouter();
  const {
    catalog,
    cart
  } = Route.useLoaderData();
  const [toast, setToast] = useState("");
  async function remove(promptId) {
    await removeFromCartFn({
      data: {
        promptId
      }
    });
    setToast("Removed from Cart");
    await router.invalidate();
  }
  async function checkout() {
    const result = await checkoutFn();
    setToast(result.ok ? "Checkout complete" : "Cart is empty");
    await router.invalidate();
  }
  return /* @__PURE__ */ jsxs("div", { className: "app", children: [
    /* @__PURE__ */ jsx(AppShell, { categories: catalog.categories, cartCount: cart.totals.itemCount, active: "cart" }),
    /* @__PURE__ */ jsxs("main", { className: "checkout-main", children: [
      /* @__PURE__ */ jsx(Link, { className: "back", to: "/", children: "Back to gallery" }),
      /* @__PURE__ */ jsx("h1", { children: "Cart" }),
      /* @__PURE__ */ jsxs("div", { className: "cart-grid", children: [
        /* @__PURE__ */ jsx("section", { className: "cart-list", children: cart.items.length ? cart.items.map((item) => /* @__PURE__ */ jsxs("article", { className: "cart-row", children: [
          /* @__PURE__ */ jsx("img", { src: item.imageUrl, alt: "" }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("b", { children: item.title }),
            /* @__PURE__ */ jsxs("span", { children: [
              item.model,
              " / ",
              item.category
            ] })
          ] }),
          /* @__PURE__ */ jsx("strong", { children: item.price === 0 ? "Free" : `$${item.price}` }),
          /* @__PURE__ */ jsx("button", { onClick: () => remove(item.id), type: "button", children: "Remove" })
        ] }, item.id)) : /* @__PURE__ */ jsx("p", { className: "empty", children: "Your Cart is empty. Add a prompt from Featured, Newest, or Popular." }) }),
        /* @__PURE__ */ jsxs("aside", { className: "summary", children: [
          /* @__PURE__ */ jsxs("span", { children: [
            "Subtotal $",
            cart.totals.subtotal.toFixed(2)
          ] }),
          /* @__PURE__ */ jsxs("span", { children: [
            "Fees $",
            cart.totals.fees.toFixed(2)
          ] }),
          /* @__PURE__ */ jsxs("strong", { children: [
            "Total $",
            cart.totals.total.toFixed(2)
          ] }),
          /* @__PURE__ */ jsx("button", { className: "primary", onClick: checkout, type: "button", children: "Checkout simulation" })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsx(Toast, { message: toast })
  ] });
}
export {
  CartRoute as component
};
