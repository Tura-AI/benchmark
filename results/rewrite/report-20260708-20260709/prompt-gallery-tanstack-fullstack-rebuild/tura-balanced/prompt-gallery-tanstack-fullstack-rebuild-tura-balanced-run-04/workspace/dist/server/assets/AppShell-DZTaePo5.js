import { jsxs, Fragment, jsx } from "react/jsx-runtime";
import { Link } from "@tanstack/react-router";
import { Heart, Menu, Search, Zap, Home, History, BarChart3, Compass, Boxes, Code2, Sparkles, ShoppingBag, Wand2, Bookmark, Star, X } from "lucide-react";
const Icons = { BarChart3, Bookmark, Boxes, Code2, Compass, Heart, History, Home, Menu, Search, ShoppingBag, Sparkles, Star, Wand2, X, Zap };
function AppShell({ categories, cartCount, active = "home", onSearch, onCategory, onFavorites }) {
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("aside", { className: "sidebar", id: "sidebar", children: [
      /* @__PURE__ */ jsxs(Link, { className: "logo", to: "/", "aria-label": "POWERPROMPT Gallery home", children: [
        /* @__PURE__ */ jsx("span", { className: "bolt", children: /* @__PURE__ */ jsx(Icons.Zap, { size: 16, fill: "currentColor" }) }),
        /* @__PURE__ */ jsx("b", { children: "POWERPROMPT" }),
        /* @__PURE__ */ jsx("span", { children: "Gallery" })
      ] }),
      /* @__PURE__ */ jsxs(Link, { className: `navi ${active === "home" ? "active" : ""}`, to: "/", children: [
        /* @__PURE__ */ jsx(Icons.Home, {}),
        " Home"
      ] }),
      /* @__PURE__ */ jsxs("button", { className: "navi", onClick: onSearch, type: "button", children: [
        /* @__PURE__ */ jsx(Icons.Search, {}),
        " Search"
      ] }),
      /* @__PURE__ */ jsxs("button", { className: "navi", type: "button", children: [
        /* @__PURE__ */ jsx(Icons.History, {}),
        " History"
      ] }),
      /* @__PURE__ */ jsxs("button", { className: `navi ${active === "favorites" ? "active" : ""}`, onClick: onFavorites, type: "button", children: [
        /* @__PURE__ */ jsx(Icons.Heart, {}),
        " Favorites ",
        /* @__PURE__ */ jsx("span", { className: "new", children: "NEW" })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "side-label", children: "Categories" }),
      /* @__PURE__ */ jsx("div", { children: categories.map((category) => /* @__PURE__ */ jsxs("button", { className: "cat", onClick: () => onCategory?.(category.name), type: "button", children: [
        /* @__PURE__ */ jsx("span", { className: "dot" }),
        category.name
      ] }, category.name)) }),
      /* @__PURE__ */ jsx("div", { className: "side-label", children: "More from us" }),
      /* @__PURE__ */ jsxs(Link, { className: "navi", to: "/admin", children: [
        /* @__PURE__ */ jsx(Icons.BarChart3, {}),
        " Creator analytics"
      ] }),
      /* @__PURE__ */ jsxs("button", { className: "navi", type: "button", children: [
        /* @__PURE__ */ jsx(Icons.Compass, {}),
        " Browser extension"
      ] }),
      /* @__PURE__ */ jsxs("button", { className: "navi", type: "button", children: [
        /* @__PURE__ */ jsx(Icons.Boxes, {}),
        " Figma plugin"
      ] }),
      /* @__PURE__ */ jsxs("button", { className: "navi", type: "button", children: [
        /* @__PURE__ */ jsx(Icons.Code2, {}),
        " Public API"
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "side-foot", children: [
        /* @__PURE__ */ jsxs("div", { className: "promo-card", children: [
          /* @__PURE__ */ jsx(Icons.Sparkles, { className: "gift" }),
          /* @__PURE__ */ jsx("h4", { children: "Publish a prompt pack" }),
          /* @__PURE__ */ jsx("p", { children: "Earn on reusable model workflows." })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "side-cta", children: [
          /* @__PURE__ */ jsx(Link, { className: "btn-ink", to: "/cart", children: "Cart" }),
          /* @__PURE__ */ jsxs("span", { className: "free", children: [
            cartCount,
            " saved"
          ] })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("nav", { className: "dock", "aria-label": "Mobile dock", children: [
      /* @__PURE__ */ jsx(Link, { to: "/", className: active === "home" ? "active" : "", "aria-label": "Home", children: /* @__PURE__ */ jsx(Icons.Home, {}) }),
      /* @__PURE__ */ jsx("button", { "aria-label": "History", type: "button", children: /* @__PURE__ */ jsx(Icons.History, {}) }),
      /* @__PURE__ */ jsx("button", { "aria-label": "Favorites", type: "button", onClick: onFavorites, children: /* @__PURE__ */ jsx(Icons.Heart, {}) }),
      /* @__PURE__ */ jsx(Link, { to: "/admin", "aria-label": "Analytics", children: /* @__PURE__ */ jsx(Icons.BarChart3, {}) }),
      /* @__PURE__ */ jsxs(Link, { to: "/cart", "aria-label": "Cart", children: [
        /* @__PURE__ */ jsx(Icons.ShoppingBag, {}),
        /* @__PURE__ */ jsx("span", { className: `cbadge ${cartCount ? "show" : ""}`, children: cartCount })
      ] }),
      /* @__PURE__ */ jsx("button", { "aria-label": "Generate", type: "button", children: /* @__PURE__ */ jsx(Icons.Wand2, {}) })
    ] })
  ] });
}
export {
  AppShell as A,
  Icons as I
};
