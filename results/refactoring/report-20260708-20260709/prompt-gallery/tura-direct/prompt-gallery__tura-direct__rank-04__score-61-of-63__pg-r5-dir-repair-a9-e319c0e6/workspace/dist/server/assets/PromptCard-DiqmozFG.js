import { jsxs, jsx, Fragment } from "react/jsx-runtime";
import { useNavigate, Link } from "@tanstack/react-router";
const nav = [{ label: "Home", to: "/" }, { label: "Search" }, { label: "Favorites", to: "/favorites" }, { label: "Cart", to: "/cart" }, { label: "Analytics", to: "/admin" }];
const cats = ["Image", "Photography", "Design", "Writing", "Code", "Marketing", "Productivity", "Research"];
function Sidebar({ counts, open, onClose, onSearch }) {
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("aside", { className: `sidebar ${open ? "open" : ""}`, "aria-label": "Marketplace navigation", children: [
      /* @__PURE__ */ jsxs(Link, { to: "/", search: { category: "All" }, className: "logo", onClick: onClose, children: [
        /* @__PURE__ */ jsx("span", { className: "bolt", children: "P" }),
        /* @__PURE__ */ jsx("b", { children: "POWER" }),
        /* @__PURE__ */ jsx("span", { children: "PROMPT" })
      ] }),
      /* @__PURE__ */ jsx("nav", { children: nav.map((item) => !("to" in item) ? /* @__PURE__ */ jsx("button", { className: "navi", onClick: () => {
        onSearch();
        onClose();
      }, children: "Search" }, item.label) : /* @__PURE__ */ jsxs(Link, { className: "navi", to: item.to, search: item.to === "/" ? { category: "All" } : void 0, children: [
        item.label,
        item.label === "Favorites" && counts?.favorites ? /* @__PURE__ */ jsx("em", { children: counts.favorites }) : null,
        item.label === "Cart" && counts?.cart ? /* @__PURE__ */ jsx("em", { children: counts.cart }) : null
      ] }, item.label)) }),
      /* @__PURE__ */ jsx("p", { className: "side-label", children: "Categories" }),
      /* @__PURE__ */ jsx("div", { children: cats.map((cat) => /* @__PURE__ */ jsxs(Link, { className: "cat", to: "/", search: { category: cat }, onClick: onClose, children: [
        /* @__PURE__ */ jsx("i", {}),
        cat
      ] }, cat)) }),
      /* @__PURE__ */ jsxs("div", { className: "side-foot", children: [
        /* @__PURE__ */ jsxs("div", { className: "promo-card", children: [
          /* @__PURE__ */ jsx("h4", { children: "Creator drop: 20% off prompt packs" }),
          /* @__PURE__ */ jsx("p", { children: "Featured bundles refresh every Friday." })
        ] }),
        /* @__PURE__ */ jsx(Link, { className: "btn-ink", to: "/checkout", children: "Checkout" })
      ] })
    ] }),
    /* @__PURE__ */ jsx("button", { className: `scrim ${open ? "show" : ""}`, "aria-label": "Close menu", onClick: onClose })
  ] });
}
function Dock({ cart }) {
  return /* @__PURE__ */ jsxs("div", { className: "dock", "aria-label": "Quick actions", children: [
    /* @__PURE__ */ jsx(Link, { to: "/", search: { category: "All" }, children: "Home" }),
    /* @__PURE__ */ jsx(Link, { to: "/favorites", children: "Favorites" }),
    /* @__PURE__ */ jsxs(Link, { to: "/cart", children: [
      "Cart",
      cart?.items.length ? /* @__PURE__ */ jsx("b", { children: cart.items.length }) : null
    ] }),
    /* @__PURE__ */ jsx(Link, { to: "/admin", children: "Analytics" })
  ] });
}
function Topbar({ searchOpen, setSearchOpen, term, setTerm, model, setModel, sort, setSort }) {
  const models = ["All", "GPT-4o", "Claude", "Midjourney", "Flux"];
  return /* @__PURE__ */ jsxs("header", { className: "topbar", children: [
    /* @__PURE__ */ jsxs("div", { className: "filterbar", children: [
      /* @__PURE__ */ jsx("div", { className: "ftabs", children: models.map((m) => /* @__PURE__ */ jsx("button", { className: model === m ? "active" : "", onClick: () => setModel(m), children: m }, m)) }),
      /* @__PURE__ */ jsxs("div", { className: "fsort", children: [
        ["Featured", "Newest", "Popular"].map((s) => /* @__PURE__ */ jsx("button", { className: sort === s ? "active" : "", onClick: () => setSort(s), children: s }, s)),
        /* @__PURE__ */ jsx("button", { onClick: () => setSearchOpen(!searchOpen), children: "Search" })
      ] })
    ] }),
    /* @__PURE__ */ jsx("div", { className: `searchbar ${searchOpen ? "open" : ""}`, children: /* @__PURE__ */ jsxs("label", { children: [
      /* @__PURE__ */ jsx("span", { children: "Search prompts" }),
      /* @__PURE__ */ jsx("input", { value: term, onChange: (e) => setTerm(e.target.value), placeholder: "Portrait, code review, memo..." })
    ] }) })
  ] });
}
function MobileTop({ onMenu }) {
  const navigate = useNavigate();
  return /* @__PURE__ */ jsxs("div", { className: "mobile-top", children: [
    /* @__PURE__ */ jsx("button", { onClick: onMenu, "aria-label": "Open menu", children: "Menu" }),
    /* @__PURE__ */ jsx("button", { onClick: () => navigate({ to: "/cart" }), children: "Cart" })
  ] });
}
function PromptCard({ prompt, onFavorite, onCart, onPreview }) {
  return /* @__PURE__ */ jsxs("article", { className: "prompt-card", style: { aspectRatio: prompt.aspectRatio }, children: [
    /* @__PURE__ */ jsx("img", { src: prompt.image, alt: `${prompt.title} preview`, loading: "lazy" }),
    /* @__PURE__ */ jsx("button", { className: `save ${prompt.isFavorite ? "on" : ""}`, "aria-label": `${prompt.isFavorite ? "Remove from" : "Save to"} Favorites`, onClick: () => onFavorite(prompt.id), children: "Save" }),
    /* @__PURE__ */ jsxs("div", { className: "overlay", children: [
      /* @__PURE__ */ jsxs("p", { className: "mono", children: [
        prompt.model,
        " / ",
        prompt.category
      ] }),
      /* @__PURE__ */ jsx("h2", { children: /* @__PURE__ */ jsx(Link, { to: "/prompt/$slug", params: { slug: prompt.slug }, children: prompt.title }) }),
      /* @__PURE__ */ jsx("p", { children: prompt.description }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("span", { children: prompt.priceCents ? `$${(prompt.priceCents / 100).toFixed(0)}` : "Free" }),
        /* @__PURE__ */ jsxs("span", { children: [
          prompt.sold.toLocaleString(),
          " sold"
        ] }),
        /* @__PURE__ */ jsx("span", { children: prompt.rating.toFixed(1) })
      ] }),
      /* @__PURE__ */ jsxs("footer", { children: [
        /* @__PURE__ */ jsx("button", { onClick: () => onPreview(prompt), children: "Preview" }),
        /* @__PURE__ */ jsx("button", { onClick: () => onCart(prompt.id), children: prompt.inCart ? "In Cart" : prompt.priceCents ? "Add to Cart" : "Get Free" })
      ] })
    ] })
  ] });
}
function Lightbox({ prompt, onClose, onCart }) {
  if (!prompt) return null;
  return /* @__PURE__ */ jsx("div", { className: "lightbox", role: "dialog", "aria-modal": "true", "aria-label": prompt.title, onClick: onClose, children: /* @__PURE__ */ jsxs("section", { onClick: (e) => e.stopPropagation(), children: [
    /* @__PURE__ */ jsx("button", { className: "close", onClick: onClose, children: "Close" }),
    /* @__PURE__ */ jsx("img", { src: prompt.image, alt: "" }),
    /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsxs("p", { className: "mono", children: [
        prompt.model,
        " / ",
        prompt.category
      ] }),
      /* @__PURE__ */ jsx("h1", { children: prompt.title }),
      /* @__PURE__ */ jsx("p", { children: prompt.description }),
      /* @__PURE__ */ jsxs("dl", { children: [
        /* @__PURE__ */ jsx("dt", { children: "Creator" }),
        /* @__PURE__ */ jsx("dd", { children: prompt.creator }),
        /* @__PURE__ */ jsx("dt", { children: "Rank" }),
        /* @__PURE__ */ jsx("dd", { children: prompt.rankScore }),
        /* @__PURE__ */ jsx("dt", { children: "Sales" }),
        /* @__PURE__ */ jsx("dd", { children: prompt.sold.toLocaleString() })
      ] }),
      /* @__PURE__ */ jsx("button", { className: "btn-ink", onClick: () => onCart(prompt.id), children: prompt.priceCents ? "Add to Cart" : "Get Free" })
    ] })
  ] }) });
}
export {
  Dock as D,
  Lightbox as L,
  MobileTop as M,
  PromptCard as P,
  Sidebar as S,
  Topbar as T
};
