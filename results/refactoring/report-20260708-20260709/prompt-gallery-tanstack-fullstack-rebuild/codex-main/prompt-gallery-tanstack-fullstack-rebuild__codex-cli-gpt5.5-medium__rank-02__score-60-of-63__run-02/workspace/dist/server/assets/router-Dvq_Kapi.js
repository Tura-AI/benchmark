import { createRootRoute, Outlet, HeadContent, Scripts, createFileRoute, useRouter, Link, notFound, createRouter } from "@tanstack/react-router";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { useState, useMemo, useEffect } from "react";
const styles = "/assets/app-x6BxCQSL.css";
const Route$a = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "POWERPROMPT - Prompt Gallery" },
      {
        name: "description",
        content: "A full-stack prompt marketplace for GPT-4o, Claude, Midjourney, and Flux workflows."
      }
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@300;400;450;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap"
      },
      { rel: "stylesheet", href: styles }
    ]
  }),
  component: Root
});
function Root() {
  return /* @__PURE__ */ jsx(Document, { children: /* @__PURE__ */ jsx(Outlet, {}) });
}
function Document({ children }) {
  return /* @__PURE__ */ jsxs("html", { lang: "en", children: [
    /* @__PURE__ */ jsx("head", { children: /* @__PURE__ */ jsx(HeadContent, {}) }),
    /* @__PURE__ */ jsxs("body", { children: [
      children,
      /* @__PURE__ */ jsx(Scripts, {})
    ] })
  ] });
}
function Bolt() {
  return /* @__PURE__ */ jsx("svg", { viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": "true", children: /* @__PURE__ */ jsx("path", { d: "M13 2 4.5 13.5H11l-1 8.5L19.5 10H13V2Z" }) });
}
function Icon({ name }) {
  const paths = {
    home: ["M3 11.5 12 4l9 7.5", "M5 10v10h14V10"],
    search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z", "m20 20-3.5-3.5"],
    history: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7v5l3 2"],
    heart: ["M12 20s-7-4.4-9.2-8.3C1.1 8.5 2.6 5 6 5c2 0 3.2 1.2 4 2.3C10.8 6.2 12 5 14 5c3.4 0 4.9 3.5 3.2 6.7C19 15.6 12 20 12 20Z"],
    grid: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h6v6h-6z"],
    bag: ["M6 7h13l-1.2 9.5a2 2 0 0 1-2 1.75H9.2a2 2 0 0 1-2-1.75L6 7Z", "M9 7a3 3 0 0 1 6 0"],
    spark: ["M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"],
    plus: ["M12 5v14M5 12h14"],
    bookmark: ["M6 4h12v17l-6-4-6 4V4Z"],
    close: ["M6 6l12 12M18 6 6 18"],
    api: ["m8 16-4-4 4-4", "m16 8 4 4-4 4"],
    image: ["M12 4 4 19h16z"],
    circle: ["M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"],
    flux: ["M12 3 21 12 12 21 3 12Z"],
    menu: ["M4 7h16M4 12h16M4 17h16"]
  };
  return /* @__PURE__ */ jsx("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: paths[name]?.map((d) => /* @__PURE__ */ jsx("path", { d }, d)) });
}
function apiUrl(path) {
  if (typeof window !== "undefined") return path;
  return `${process.env.POWERPROMPT_ORIGIN ?? "http://127.0.0.1:3000"}${path}`;
}
const Route$9 = createFileRoute("/cart")({
  loader: async () => {
    const res = await fetch(apiUrl("/api/cart"));
    return res.json();
  },
  component: CartPage
});
function CartPage() {
  const router = useRouter();
  const cart = Route$9.useLoaderData();
  async function remove(promptId) {
    await fetch("/api/cart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "remove", promptId })
    });
    router.invalidate();
  }
  async function checkout() {
    await fetch("/api/checkout", { method: "POST" });
    router.invalidate();
  }
  return /* @__PURE__ */ jsxs("main", { className: "cart-page", children: [
    /* @__PURE__ */ jsx(Link, { to: "/", className: "backlink", children: "POWERPROMPT Gallery" }),
    /* @__PURE__ */ jsxs("section", { className: "cart-layout", children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("div", { className: "page-kicker", children: "Cart" }),
        /* @__PURE__ */ jsx("h1", { children: "Prompt checkout" }),
        /* @__PURE__ */ jsx("div", { className: "cart-list", children: cart.items.length === 0 ? /* @__PURE__ */ jsx("p", { className: "muted", children: "Your cart is empty. The storefront is ready when you are." }) : cart.items.map((item) => /* @__PURE__ */ jsxs("article", { className: "cart-row", children: [
          /* @__PURE__ */ jsx("img", { src: item.imageUrl, alt: "" }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("strong", { children: item.title }),
            /* @__PURE__ */ jsxs("span", { children: [
              item.model,
              " · ",
              item.category,
              " · Qty ",
              item.quantity
            ] })
          ] }),
          /* @__PURE__ */ jsx("b", { children: item.lineTotal === 0 ? "Free" : `$${item.lineTotal.toFixed(2)}` }),
          /* @__PURE__ */ jsx("button", { "aria-label": `Remove ${item.title}`, onClick: () => remove(item.id), children: /* @__PURE__ */ jsx(Icon, { name: "close" }) })
        ] }, item.id)) })
      ] }),
      /* @__PURE__ */ jsxs("aside", { className: "summary-card", children: [
        /* @__PURE__ */ jsx("span", { className: "mono", children: "Order summary" }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("span", { children: "Subtotal" }),
          /* @__PURE__ */ jsxs("b", { children: [
            "$",
            cart.subtotal.toFixed(2)
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("span", { children: "Creator platform fee" }),
          /* @__PURE__ */ jsxs("b", { children: [
            "$",
            cart.fees.toFixed(2)
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "total", children: [
          /* @__PURE__ */ jsx("span", { children: "Total" }),
          /* @__PURE__ */ jsxs("b", { children: [
            "$",
            cart.total.toFixed(2)
          ] })
        ] }),
        /* @__PURE__ */ jsx("button", { className: "btn-ink", disabled: cart.items.length === 0, onClick: checkout, children: "Simulate checkout" })
      ] })
    ] })
  ] });
}
const Route$8 = createFileRoute("/admin")({
  loader: async () => {
    const res = await fetch(apiUrl("/api/admin"));
    return res.json();
  },
  component: AdminPage
});
function AdminPage() {
  const analytics = Route$8.useLoaderData();
  return /* @__PURE__ */ jsxs("main", { className: "admin-page", children: [
    /* @__PURE__ */ jsx(Link, { to: "/", className: "backlink", children: "POWERPROMPT Gallery" }),
    /* @__PURE__ */ jsx("div", { className: "page-kicker", children: "Creator analytics" }),
    /* @__PURE__ */ jsx("h1", { children: "Marketplace pulse" }),
    /* @__PURE__ */ jsxs("section", { className: "metric-grid", children: [
      /* @__PURE__ */ jsx(Metric, { label: "Revenue", value: `$${analytics.summary.revenue.toFixed(2)}` }),
      /* @__PURE__ */ jsx(Metric, { label: "Orders", value: analytics.summary.orders.toString() }),
      /* @__PURE__ */ jsx(Metric, { label: "Average order", value: `$${analytics.summary.averageOrderValue.toFixed(2)}` }),
      /* @__PURE__ */ jsx(Metric, { label: "Conversion", value: `${(analytics.summary.conversionRate * 100).toFixed(2)}%` })
    ] }),
    /* @__PURE__ */ jsxs("section", { className: "analytics-grid", children: [
      /* @__PURE__ */ jsx(Panel, { title: "Creator revenue", children: analytics.creatorRevenue.map((row) => /* @__PURE__ */ jsxs("div", { className: "data-row", children: [
        /* @__PURE__ */ jsx("span", { children: row.creator }),
        /* @__PURE__ */ jsxs("b", { children: [
          "$",
          row.revenue.toFixed(2)
        ] }),
        /* @__PURE__ */ jsxs("em", { children: [
          (row.conversionRate * 100).toFixed(2),
          "%"
        ] })
      ] }, row.creator)) }),
      /* @__PURE__ */ jsx(Panel, { title: "Category totals", children: analytics.categoryRevenue.map((row) => /* @__PURE__ */ jsxs("div", { className: "data-row", children: [
        /* @__PURE__ */ jsx("span", { children: row.category }),
        /* @__PURE__ */ jsxs("b", { children: [
          "$",
          row.revenue.toFixed(2)
        ] }),
        /* @__PURE__ */ jsxs("em", { children: [
          row.units,
          " units"
        ] })
      ] }, row.category)) }),
      /* @__PURE__ */ jsx(Panel, { title: "Daily sales trend", children: /* @__PURE__ */ jsx("div", { className: "trend", children: analytics.dailySales.map((row) => /* @__PURE__ */ jsxs("div", { style: { ["--h"]: `${Math.max(12, row.revenue * 2.2)}px` }, children: [
        /* @__PURE__ */ jsx("span", {}),
        " ",
        /* @__PURE__ */ jsx("small", { children: row.day.slice(5) })
      ] }, row.day)) }) })
    ] })
  ] });
}
function Metric({ label, value }) {
  return /* @__PURE__ */ jsxs("article", { className: "metric", children: [
    /* @__PURE__ */ jsx("span", { className: "mono", children: label }),
    /* @__PURE__ */ jsx("strong", { children: value })
  ] });
}
function Panel({ title, children }) {
  return /* @__PURE__ */ jsxs("article", { className: "panel", children: [
    /* @__PURE__ */ jsx("h2", { children: title }),
    children
  ] });
}
const models = ["all", "GPT-4o", "Claude", "Midjourney", "Flux"];
const sorts = [
  { key: "featured", label: "Featured" },
  { key: "newest", label: "Newest" },
  { key: "popular", label: "Popular" }
];
function Marketplace({ initial }) {
  const router = useRouter();
  const [catalog, setCatalog] = useState(initial);
  const [model, setModel] = useState("all");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("featured");
  const [term, setTerm] = useState("");
  const [view, setView] = useState("home");
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [preview, setPreview] = useState(null);
  const [columnCount, setColumnCount] = useState(4);
  const columns = useMemo(() => distribute(catalog.prompts, columnCount), [catalog.prompts, columnCount]);
  useEffect(() => {
    const listener = (event) => notify(event.detail);
    window.addEventListener("pp-toast", listener);
    return () => window.removeEventListener("pp-toast", listener);
  }, []);
  useEffect(() => {
    const sync = () => setColumnCount(window.innerWidth < 640 ? 2 : window.innerWidth < 1100 ? 3 : 4);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);
  async function refresh(next = { model, category, sort, term, view }) {
    const params = new URLSearchParams();
    if (next.model !== "all") params.set("model", next.model);
    if (next.category !== "all") params.set("category", next.category);
    if (next.sort) params.set("sort", next.sort);
    if (next.term) params.set("term", next.term);
    if (next.view === "favorites") params.set("favorites", "true");
    const res = await fetch(`/api/catalog?${params}`);
    setCatalog(await res.json());
  }
  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }
  async function changeFilter(next) {
    const merged = { model, category, sort, term, view, ...next };
    setModel(merged.model);
    setCategory(merged.category);
    setSort(merged.sort);
    setTerm(merged.term);
    setView(merged.view);
    await refresh(merged);
  }
  async function toggleFavorite(prompt) {
    const res = await fetch("/api/favorite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ promptId: prompt.id })
    });
    const data = await res.json();
    notify(data.favorite ? "Saved to Favorites" : "Removed from Favorites");
    await refresh();
    router.invalidate();
  }
  async function add(prompt) {
    const res = await fetch("/api/cart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "add", promptId: prompt.id })
    });
    const data = await res.json();
    setCatalog((current) => ({ ...current, counts: { ...current.counts, cart: data.items.length } }));
    notify(`Added - ${prompt.title}`);
  }
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(
      Sidebar,
      {
        catalog,
        category,
        view,
        open: drawerOpen,
        onClose: () => setDrawerOpen(false),
        onHome: () => changeFilter({ model: "all", category: "all", view: "home", term: "" }),
        onSearch: () => setSearchOpen((value) => !value),
        onFavorites: () => changeFilter({ model: "all", category: "all", view: "favorites" }),
        onCategory: (name) => changeFilter({ category: name, view: "home" }),
        onFree: () => changeFilter({ model: "all", category: "all", view: "home", term: "", sort: "featured" }).then(() => notify("Free prompts highlighted in the catalog"))
      }
    ),
    /* @__PURE__ */ jsxs("main", { className: "main", children: [
      /* @__PURE__ */ jsx(MobileTop, { onMenu: () => setDrawerOpen(true) }),
      /* @__PURE__ */ jsx(
        TopFilters,
        {
          model,
          sort,
          searchOpen,
          term,
          onModel: (value) => changeFilter({ model: value }),
          onSort: (value) => changeFilter({ sort: value }),
          onTerm: (value) => changeFilter({ term: value })
        }
      ),
      /* @__PURE__ */ jsx("section", { className: "gallery", "aria-label": "Prompt gallery", children: catalog.prompts.length === 0 ? /* @__PURE__ */ jsxs("div", { className: "empty", children: [
        /* @__PURE__ */ jsx("div", { className: "big", children: "Nothing here yet" }),
        /* @__PURE__ */ jsx("div", { children: view === "favorites" ? "Tap the bookmark on any prompt to save it." : "Try a different filter or search." })
      ] }) : /* @__PURE__ */ jsx("div", { className: "masonry", children: columns.map((col, index) => /* @__PURE__ */ jsx("div", { className: "ms-col", children: col.map((prompt) => /* @__PURE__ */ jsx(PromptCard, { prompt, onAdd: add, onFavorite: toggleFavorite, onPreview: setPreview }, prompt.id)) }, index)) }) })
    ] }),
    /* @__PURE__ */ jsx(Dock, { cartCount: catalog.counts.cart, view, onHome: () => changeFilter({ model: "all", category: "all", view: "home", term: "" }), onFavorites: () => changeFilter({ view: "favorites" }), notify }),
    preview ? /* @__PURE__ */ jsx(Lightbox, { prompt: preview, onAdd: add, onClose: () => setPreview(null) }) : null,
    /* @__PURE__ */ jsxs("div", { className: `toast ${toast ? "show" : ""}`, role: "status", children: [
      /* @__PURE__ */ jsx("span", { className: "d" }),
      toast
    ] }),
    /* @__PURE__ */ jsx("button", { className: `scrim ${drawerOpen ? "show" : ""}`, "aria-label": "Close menu", onClick: () => setDrawerOpen(false) })
  ] });
}
function Sidebar(props) {
  return /* @__PURE__ */ jsxs("aside", { className: `sidebar ${props.open ? "open" : ""}`, children: [
    /* @__PURE__ */ jsxs("div", { className: "logo", children: [
      /* @__PURE__ */ jsx("span", { className: "bolt", children: /* @__PURE__ */ jsx(Bolt, {}) }),
      /* @__PURE__ */ jsx("b", { children: "POWERPROMPT" }),
      /* @__PURE__ */ jsx("span", { children: "Gallery" })
    ] }),
    /* @__PURE__ */ jsx(NavButton, { active: props.view === "home", icon: "home", onClick: () => {
      props.onHome();
      props.onClose();
    }, children: "Home" }),
    /* @__PURE__ */ jsx(NavButton, { icon: "search", onClick: props.onSearch, children: "Search" }),
    /* @__PURE__ */ jsx(NavButton, { icon: "history", onClick: () => toastOnly("History is empty for now"), children: "History" }),
    /* @__PURE__ */ jsx(NavButton, { active: props.view === "favorites", icon: "heart", badge: "NEW", onClick: () => {
      props.onFavorites();
      props.onClose();
    }, children: "Favorites" }),
    /* @__PURE__ */ jsx("div", { className: "side-label", children: "Categories" }),
    props.catalog.categories.map((cat) => /* @__PURE__ */ jsxs("button", { className: `cat ${props.category === cat.name ? "active" : ""}`, onClick: () => {
      props.onCategory(cat.name);
      props.onClose();
    }, children: [
      /* @__PURE__ */ jsx("span", { className: "dot" }),
      cat.name,
      /* @__PURE__ */ jsx("span", { className: "cat-count", children: cat.count })
    ] }, cat.name)),
    /* @__PURE__ */ jsx("div", { className: "side-label", children: "More from us" }),
    /* @__PURE__ */ jsx(NavButton, { icon: "grid", onClick: () => toastOnly("Browser extension - coming soon"), children: "Browser extension" }),
    /* @__PURE__ */ jsx(NavButton, { icon: "spark", onClick: () => toastOnly("Figma plugin - coming soon"), children: "Figma plugin" }),
    /* @__PURE__ */ jsx(NavButton, { icon: "api", onClick: () => toastOnly("API docs - coming soon"), children: "Public API" }),
    /* @__PURE__ */ jsxs("div", { className: "side-foot", children: [
      /* @__PURE__ */ jsxs("div", { className: "promo-card", children: [
        /* @__PURE__ */ jsx(Icon, { name: "bag" }),
        /* @__PURE__ */ jsx("h4", { children: "Sell your prompts" }),
        /* @__PURE__ */ jsx("p", { children: "Keep 85% of every sale - paid weekly." })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "side-cta", children: [
        /* @__PURE__ */ jsx(Link, { className: "btn-ink", to: "/admin", children: "Creator admin" }),
        /* @__PURE__ */ jsx("button", { className: "free", onClick: props.onFree, children: "Free prompts" })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "side-legal", children: [
        /* @__PURE__ */ jsx("a", { children: "Terms" }),
        " · ",
        /* @__PURE__ */ jsx("a", { children: "Privacy" }),
        " · ",
        /* @__PURE__ */ jsx("a", { children: "Refund" }),
        /* @__PURE__ */ jsx("span", { className: "stars", children: "★ 4.8" })
      ] })
    ] })
  ] });
}
function NavButton({ active, icon, badge, onClick, children }) {
  return /* @__PURE__ */ jsxs("button", { className: `navi ${active ? "active" : ""}`, onClick, children: [
    /* @__PURE__ */ jsx(Icon, { name: icon }),
    children,
    badge ? /* @__PURE__ */ jsx("span", { className: "new", children: badge }) : null
  ] });
}
function TopFilters({ model, sort, searchOpen, term, onModel, onSort, onTerm }) {
  return /* @__PURE__ */ jsxs("div", { className: "topbar", children: [
    /* @__PURE__ */ jsxs("div", { className: "filterbar", children: [
      /* @__PURE__ */ jsx("div", { className: "ftabs", children: models.map((item) => /* @__PURE__ */ jsxs("button", { className: `ftab ${model === item ? "active" : ""}`, onClick: () => onModel(item), children: [
        /* @__PURE__ */ jsx(Icon, { name: item === "Flux" ? "flux" : item === "Midjourney" ? "image" : item === "all" ? "grid" : "circle" }),
        item === "all" ? "All" : item
      ] }, item)) }),
      /* @__PURE__ */ jsx("div", { className: "fsort", children: sorts.map((item) => /* @__PURE__ */ jsx("button", { className: `sortbtn ${sort === item.key ? "active" : ""}`, onClick: () => onSort(item.key), children: item.label }, item.key)) })
    ] }),
    /* @__PURE__ */ jsx("div", { className: `searchbar ${searchOpen ? "open" : ""}`, children: /* @__PURE__ */ jsxs("div", { className: "inner", children: [
      /* @__PURE__ */ jsx(Icon, { name: "search" }),
      /* @__PURE__ */ jsx("input", { value: term, onChange: (event) => onTerm(event.target.value), placeholder: "Search prompts - portrait, poster, cold email..." })
    ] }) })
  ] });
}
function MobileTop({ onMenu }) {
  return /* @__PURE__ */ jsxs("div", { className: "mtop", children: [
    /* @__PURE__ */ jsx("button", { className: "burger", "aria-label": "Menu", onClick: onMenu, children: /* @__PURE__ */ jsx(Icon, { name: "menu" }) }),
    /* @__PURE__ */ jsx("span", { className: "bolt", children: /* @__PURE__ */ jsx(Bolt, {}) }),
    /* @__PURE__ */ jsx("b", { children: "POWERPROMPT" })
  ] });
}
function PromptCard({ prompt, onAdd, onFavorite, onPreview }) {
  return /* @__PURE__ */ jsxs("article", { className: `tile ${prompt.isFavorite ? "saved" : ""}`, style: { ["--ar"]: prompt.aspectRatio }, children: [
    /* @__PURE__ */ jsx("button", { className: "savedmark", "aria-label": "Saved", onClick: () => onFavorite(prompt), children: /* @__PURE__ */ jsx(Icon, { name: "bookmark" }) }),
    /* @__PURE__ */ jsx("button", { className: "media", onClick: () => onPreview(prompt), "aria-label": `Preview ${prompt.title}`, children: /* @__PURE__ */ jsx("img", { src: prompt.imageUrl, alt: prompt.title, loading: "lazy" }) }),
    /* @__PURE__ */ jsxs("div", { className: "ov", children: [
      /* @__PURE__ */ jsxs("div", { className: "ov__top", children: [
        /* @__PURE__ */ jsx("span", { className: "model", children: prompt.model }),
        /* @__PURE__ */ jsx("button", { className: `bm ${prompt.isFavorite ? "on" : ""}`, "aria-label": "Save", onClick: () => onFavorite(prompt), children: /* @__PURE__ */ jsx(Icon, { name: "bookmark" }) })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("button", { className: "tile-title", onClick: () => onPreview(prompt), children: prompt.title }),
        /* @__PURE__ */ jsxs("div", { className: "ov__row", children: [
          /* @__PURE__ */ jsx("span", { className: `price ${prompt.price === 0 ? "free" : ""}`, children: prompt.price === 0 ? "Free" : `$${prompt.price}` }),
          /* @__PURE__ */ jsxs("button", { className: "add", onClick: () => onAdd(prompt), children: [
            "Add ",
            /* @__PURE__ */ jsx(Icon, { name: "plus" })
          ] })
        ] })
      ] })
    ] })
  ] });
}
function Dock({ cartCount, view, onHome, onFavorites, notify }) {
  return /* @__PURE__ */ jsxs("nav", { className: "dock", "aria-label": "Quick actions", children: [
    /* @__PURE__ */ jsx("button", { className: view === "home" ? "active" : "", "aria-label": "Home", onClick: onHome, children: /* @__PURE__ */ jsx(Icon, { name: "home" }) }),
    /* @__PURE__ */ jsx("button", { "aria-label": "History", onClick: () => notify("History is empty for now"), children: /* @__PURE__ */ jsx(Icon, { name: "history" }) }),
    /* @__PURE__ */ jsx("button", { className: view === "favorites" ? "active" : "", "aria-label": "Favorites", onClick: onFavorites, children: /* @__PURE__ */ jsx(Icon, { name: "heart" }) }),
    /* @__PURE__ */ jsx("button", { "aria-label": "Collections", onClick: () => notify("Collections - coming soon"), children: /* @__PURE__ */ jsx(Icon, { name: "grid" }) }),
    /* @__PURE__ */ jsxs(Link, { to: "/cart", "aria-label": "Cart", className: "dock-link", children: [
      /* @__PURE__ */ jsx(Icon, { name: "bag" }),
      /* @__PURE__ */ jsx("span", { className: `cbadge ${cartCount ? "show" : ""}`, children: cartCount })
    ] }),
    /* @__PURE__ */ jsx(Link, { to: "/admin", "aria-label": "Creator analytics", className: "dock-link", children: /* @__PURE__ */ jsx(Icon, { name: "spark" }) })
  ] });
}
function Lightbox({ prompt, onClose, onAdd }) {
  return /* @__PURE__ */ jsx("div", { className: "lb open", role: "dialog", "aria-modal": "true", "aria-labelledby": "prompt-title", onClick: (event) => event.target === event.currentTarget && onClose(), children: /* @__PURE__ */ jsxs("div", { className: "lb__card", children: [
    /* @__PURE__ */ jsx("button", { className: "lb__close", "aria-label": "Close", onClick: onClose, children: /* @__PURE__ */ jsx(Icon, { name: "close" }) }),
    /* @__PURE__ */ jsx("div", { className: "lb__img", children: /* @__PURE__ */ jsx("img", { src: prompt.imageUrl, alt: prompt.title }) }),
    /* @__PURE__ */ jsxs("div", { className: "lb__info", children: [
      /* @__PURE__ */ jsxs("div", { className: "model", children: [
        /* @__PURE__ */ jsx("span", { className: "d" }),
        prompt.model,
        " · ",
        prompt.category
      ] }),
      /* @__PURE__ */ jsx("h2", { id: "prompt-title", children: prompt.title }),
      /* @__PURE__ */ jsx("p", { className: "desc", children: prompt.description }),
      /* @__PURE__ */ jsxs("div", { className: "stats", children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("div", { className: "k", children: "Rating" }),
          /* @__PURE__ */ jsxs("div", { className: "v", children: [
            "★ ",
            prompt.rating
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("div", { className: "k", children: "Sold" }),
          /* @__PURE__ */ jsx("div", { className: "v", children: format(prompt.sold) })
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("div", { className: "k", children: "Seller" }),
          /* @__PURE__ */ jsx("div", { className: "v", children: prompt.creator })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "lb__buy", children: [
        /* @__PURE__ */ jsx("span", { className: `price ${prompt.price === 0 ? "free" : ""}`, children: prompt.price === 0 ? "Free" : `$${prompt.price}` }),
        /* @__PURE__ */ jsx(Link, { to: "/prompts/$promptId", params: { promptId: prompt.slug }, className: "ghost", children: "Details" }),
        /* @__PURE__ */ jsxs("button", { className: "add", onClick: () => {
          onAdd(prompt);
          onClose();
        }, children: [
          prompt.price === 0 ? "Get it free" : "Add to cart",
          " ",
          /* @__PURE__ */ jsx(Icon, { name: "plus" })
        ] })
      ] })
    ] })
  ] }) });
}
function distribute(prompts, count) {
  const cols = Array.from({ length: count }, () => []);
  prompts.forEach((prompt, index) => cols[index % cols.length].push(prompt));
  return cols;
}
function format(n) {
  return n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(".0", "")}k` : String(n);
}
function toastOnly(message) {
  window.dispatchEvent(new CustomEvent("pp-toast", { detail: message }));
}
const Route$7 = createFileRoute("/")({
  loader: async () => {
    const res = await fetch(apiUrl("/api/catalog?sort=featured"));
    return res.json();
  },
  component: Storefront
});
function Storefront() {
  const catalog = Route$7.useLoaderData();
  return /* @__PURE__ */ jsx(Marketplace, { initial: catalog });
}
const Route$6 = createFileRoute("/prompts/$promptId")({
  loader: async ({ params }) => {
    const res = await fetch(apiUrl(`/api/prompt?slug=${encodeURIComponent(params.promptId)}`));
    if (!res.ok) throw notFound();
    const prompt = await res.json();
    if (!prompt) throw notFound();
    return prompt;
  },
  component: PromptDetail
});
function PromptDetail() {
  const router = useRouter();
  const prompt = Route$6.useLoaderData();
  async function add() {
    await fetch("/api/cart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "add", promptId: prompt.id })
    });
    router.navigate({ to: "/cart" });
  }
  return /* @__PURE__ */ jsxs("main", { className: "detail-page", children: [
    /* @__PURE__ */ jsx(Link, { to: "/", className: "backlink", children: "POWERPROMPT Gallery" }),
    /* @__PURE__ */ jsxs("section", { className: "detail-shell", children: [
      /* @__PURE__ */ jsx("div", { className: "detail-media", children: /* @__PURE__ */ jsx("img", { src: prompt.imageUrl, alt: prompt.title }) }),
      /* @__PURE__ */ jsxs("div", { className: "detail-copy", children: [
        /* @__PURE__ */ jsxs("div", { className: "model", children: [
          /* @__PURE__ */ jsx("span", { className: "d" }),
          prompt.model,
          " · ",
          prompt.category
        ] }),
        /* @__PURE__ */ jsx("h1", { children: prompt.title }),
        /* @__PURE__ */ jsx("p", { children: prompt.description }),
        /* @__PURE__ */ jsxs("div", { className: "detail-stats", children: [
          /* @__PURE__ */ jsxs("span", { children: [
            /* @__PURE__ */ jsxs("b", { children: [
              "★ ",
              prompt.rating
            ] }),
            " rating"
          ] }),
          /* @__PURE__ */ jsxs("span", { children: [
            /* @__PURE__ */ jsx("b", { children: prompt.sold.toLocaleString() }),
            " sold"
          ] }),
          /* @__PURE__ */ jsxs("span", { children: [
            /* @__PURE__ */ jsx("b", { children: Math.round(prompt.rankScore).toLocaleString() }),
            " rank"
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "checkout-card", children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("span", { className: "mono", children: "Creator" }),
            /* @__PURE__ */ jsx("strong", { children: prompt.creator })
          ] }),
          /* @__PURE__ */ jsx("div", { className: "detail-price", children: prompt.price === 0 ? "Free" : `$${prompt.price}` }),
          /* @__PURE__ */ jsxs("button", { className: "btn-ink detail-buy", onClick: add, children: [
            prompt.price === 0 ? "Get it free" : "Add to Cart",
            " ",
            /* @__PURE__ */ jsx(Icon, { name: "bag" })
          ] })
        ] })
      ] })
    ] })
  ] });
}
const Route$5 = createFileRoute("/api/prompt")({
  server: {
    handlers: {
      GET: async ({ request }) => (await serverApi$5()).handlePromptRequest(request)
    }
  }
});
function serverApi$5() {
  return import("../../../../../../../src/server/api.server.ts");
}
const Route$4 = createFileRoute("/api/favorite")({
  server: {
    handlers: {
      POST: async ({ request }) => (await serverApi$4()).handleFavoriteRequest(request)
    }
  }
});
function serverApi$4() {
  return import("../../../../../../../src/server/api.server.ts");
}
const Route$3 = createFileRoute("/api/checkout")({
  server: {
    handlers: {
      POST: async () => (await serverApi$3()).handleCheckoutRequest()
    }
  }
});
function serverApi$3() {
  return import("../../../../../../../src/server/api.server.ts");
}
const Route$2 = createFileRoute("/api/catalog")({
  server: {
    handlers: {
      GET: async ({ request }) => (await serverApi$2()).handleCatalogRequest(request)
    }
  }
});
function serverApi$2() {
  return import("../../../../../../../src/server/api.server.ts");
}
const Route$1 = createFileRoute("/api/cart")({
  server: {
    handlers: {
      GET: async ({ request }) => (await serverApi$1()).handleCartRequest(request),
      POST: async ({ request }) => (await serverApi$1()).handleCartRequest(request)
    }
  }
});
function serverApi$1() {
  return import("../../../../../../../src/server/api.server.ts");
}
const Route = createFileRoute("/api/admin")({
  server: {
    handlers: {
      GET: async () => (await serverApi()).handleAdminRequest()
    }
  }
});
function serverApi() {
  return import("../../../../../../../src/server/api.server.ts");
}
const CartRoute = Route$9.update({
  id: "/cart",
  path: "/cart",
  getParentRoute: () => Route$a
});
const AdminRoute = Route$8.update({
  id: "/admin",
  path: "/admin",
  getParentRoute: () => Route$a
});
const IndexRoute = Route$7.update({
  id: "/",
  path: "/",
  getParentRoute: () => Route$a
});
const PromptsPromptIdRoute = Route$6.update({
  id: "/prompts/$promptId",
  path: "/prompts/$promptId",
  getParentRoute: () => Route$a
});
const ApiPromptRoute = Route$5.update({
  id: "/api/prompt",
  path: "/api/prompt",
  getParentRoute: () => Route$a
});
const ApiFavoriteRoute = Route$4.update({
  id: "/api/favorite",
  path: "/api/favorite",
  getParentRoute: () => Route$a
});
const ApiCheckoutRoute = Route$3.update({
  id: "/api/checkout",
  path: "/api/checkout",
  getParentRoute: () => Route$a
});
const ApiCatalogRoute = Route$2.update({
  id: "/api/catalog",
  path: "/api/catalog",
  getParentRoute: () => Route$a
});
const ApiCartRoute = Route$1.update({
  id: "/api/cart",
  path: "/api/cart",
  getParentRoute: () => Route$a
});
const ApiAdminRoute = Route.update({
  id: "/api/admin",
  path: "/api/admin",
  getParentRoute: () => Route$a
});
const rootRouteChildren = {
  IndexRoute,
  AdminRoute,
  CartRoute,
  ApiAdminRoute,
  ApiCartRoute,
  ApiCatalogRoute,
  ApiCheckoutRoute,
  ApiFavoriteRoute,
  ApiPromptRoute,
  PromptsPromptIdRoute
};
const routeTree = Route$a._addFileChildren(rootRouteChildren)._addFileTypes();
function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true
  });
}
export {
  getRouter
};
