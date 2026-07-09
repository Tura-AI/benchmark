import { jsxs, jsx } from "react/jsx-runtime";
import { Link } from "@tanstack/react-router";
import { useState, useTransition } from "react";
import { e as cartRemove, g as checkoutCart } from "./router-Dz0Qc7P8.js";
function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
function CartPage({ initialCart }) {
  const [cart, setCart] = useState(initialCart);
  const [order, setOrder] = useState(null);
  const [, start] = useTransition();
  return /* @__PURE__ */ jsxs("main", { className: "checkout", children: [
    /* @__PURE__ */ jsx(Link, { to: "/", search: { category: "All" }, className: "back", children: "POWERPROMPT" }),
    /* @__PURE__ */ jsx("h1", { children: "Cart" }),
    cart.items.length ? /* @__PURE__ */ jsxs("div", { className: "cart-grid", children: [
      /* @__PURE__ */ jsx("section", { children: cart.items.map((item) => /* @__PURE__ */ jsxs("article", { className: "cart-row", children: [
        /* @__PURE__ */ jsx("img", { src: item.image, alt: "" }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("h2", { children: item.title }),
          /* @__PURE__ */ jsxs("p", { children: [
            item.model,
            " / ",
            item.category
          ] })
        ] }),
        /* @__PURE__ */ jsx("strong", { children: item.priceCents ? money(item.priceCents) : "Free" }),
        /* @__PURE__ */ jsx("button", { onClick: () => start(async () => setCart(await cartRemove({ data: { promptId: item.id } }))), children: "Remove" })
      ] }, item.id)) }),
      /* @__PURE__ */ jsxs("aside", { children: [
        /* @__PURE__ */ jsxs("p", { children: [
          "Subtotal ",
          /* @__PURE__ */ jsx("b", { children: money(cart.subtotalCents) })
        ] }),
        /* @__PURE__ */ jsxs("p", { children: [
          "Marketplace fee ",
          /* @__PURE__ */ jsx("b", { children: money(cart.feesCents) })
        ] }),
        /* @__PURE__ */ jsxs("p", { children: [
          "Total ",
          /* @__PURE__ */ jsx("b", { children: money(cart.totalCents) })
        ] }),
        /* @__PURE__ */ jsxs("p", { children: [
          cart.freeCount,
          " free / ",
          cart.paidCount,
          " paid"
        ] }),
        /* @__PURE__ */ jsx("button", { className: "btn-ink", onClick: () => start(async () => {
          const result = await checkoutCart();
          setCart(result.cart);
          setOrder(result.orderId);
        }), children: "Checkout simulation" })
      ] })
    ] }) : /* @__PURE__ */ jsx("p", { className: "lede", children: "Your Cart is empty." }),
    order ? /* @__PURE__ */ jsxs("p", { className: "status", children: [
      "Order #",
      order,
      " created and cart cleared."
    ] }) : null
  ] });
}
export {
  CartPage as C
};
