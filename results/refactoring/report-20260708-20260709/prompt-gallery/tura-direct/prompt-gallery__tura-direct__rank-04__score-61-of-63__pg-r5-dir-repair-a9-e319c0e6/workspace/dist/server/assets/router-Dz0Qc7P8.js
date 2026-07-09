import { createRootRoute, HeadContent, Outlet, Scripts, createFileRoute, lazyRouteComponent, notFound, createRouter as createRouter$1 } from "@tanstack/react-router";
import { jsxs, jsx } from "react/jsx-runtime";
import { T as TSS_SERVER_FUNCTION, g as getServerFnById, c as createServerFn } from "../server.js";
import { z } from "zod";
import { g as getCounts, l as listPrompts, a as addToCart, b as getCartSummary, c as getAnalytics } from "./db-Dyq5Uycb.js";
const appCss = "/assets/app-CVg91To8.css";
const Route$9 = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "POWERPROMPT - Prompt Gallery" },
      { name: "description", content: "A full-stack TanStack Start prompt marketplace." }
    ],
    links: [{ rel: "stylesheet", href: appCss }]
  }),
  component: Root
});
function Root() {
  return /* @__PURE__ */ jsxs("html", { lang: "en", children: [
    /* @__PURE__ */ jsx("head", { children: /* @__PURE__ */ jsx(HeadContent, {}) }),
    /* @__PURE__ */ jsxs("body", { children: [
      /* @__PURE__ */ jsx(Outlet, {}),
      /* @__PURE__ */ jsx(Scripts, {})
    ] })
  ] });
}
var createSsrRpc = (functionId) => {
  const url = "/_serverFn/" + functionId;
  const serverFnMeta = { id: functionId };
  const fn = async (...args) => {
    return (await getServerFnById(functionId))(...args);
  };
  return Object.assign(fn, {
    url,
    serverFnMeta,
    [TSS_SERVER_FUNCTION]: true
  });
};
const filterSchema = z.object({
  model: z.string().optional(),
  category: z.string().optional(),
  sort: z.string().optional(),
  term: z.string().optional(),
  favoritesOnly: z.boolean().optional(),
  price: z.enum(["all", "free", "paid"]).optional()
});
const fetchCatalog = createServerFn({
  method: "GET"
}).validator((data) => filterSchema.parse(data ?? {})).handler(createSsrRpc("0b589ddea47f63d290647a511b8efc8770beafa1ff85d9c891e0bcaa4bfc46a8"));
const fetchPrompt = createServerFn({
  method: "GET"
}).validator((data) => z.object({
  slug: z.string()
}).parse(data)).handler(createSsrRpc("bfd7a1b668ef001752a04735f8b97bbfcdcdfc4a96b59e01d0191f3740383d11"));
const fetchCart = createServerFn({
  method: "GET"
}).handler(createSsrRpc("31822799ca72797e9f8fa37e54eabe02b229d279fbf1cfe6d2baeaba8af75b5e"));
const fetchAnalytics = createServerFn({
  method: "GET"
}).handler(createSsrRpc("4fa70a6862997e9232e33338713e71bec02ff6bb1d5e778e868924581f0d475c"));
const favoritePrompt = createServerFn({
  method: "POST"
}).validator((data) => z.object({
  promptId: z.number()
}).parse(data)).handler(createSsrRpc("9c8c318ee5a9d40ec3282af3504a2d4e1a455beff966e9a96f7291022cb0264b"));
const cartAdd = createServerFn({
  method: "POST"
}).validator((data) => z.object({
  promptId: z.number()
}).parse(data)).handler(createSsrRpc("6896c60d5516010a8b25b35fb0a3c7cbdbe76e3ca7b1fb0b48c8c357b33ae34e"));
const cartRemove = createServerFn({
  method: "POST"
}).validator((data) => z.object({
  promptId: z.number()
}).parse(data)).handler(createSsrRpc("464edb90ce2e81fc17635ca77948e2d83642c3a1d4bf35b2ca01c2ec031d7eb2"));
const checkoutCart = createServerFn({
  method: "POST"
}).handler(createSsrRpc("5597c790ed3b86309fc1f389596503e282c5ec964a2f0203f19421aec46d9dd6"));
const $$splitComponentImporter$5 = () => import("./favorites-D7dWJC42.js");
const Route$8 = createFileRoute("/favorites")({
  loader: () => fetchCatalog({
    data: {
      favoritesOnly: true
    }
  }),
  component: lazyRouteComponent($$splitComponentImporter$5, "component")
});
const $$splitComponentImporter$4 = () => import("./checkout-CqYd0L3L.js");
const Route$7 = createFileRoute("/checkout")({
  loader: () => fetchCart(),
  component: lazyRouteComponent($$splitComponentImporter$4, "component")
});
const $$splitComponentImporter$3 = () => import("./cart-COBZI6uU.js");
const Route$6 = createFileRoute("/cart")({
  loader: () => fetchCart(),
  component: lazyRouteComponent($$splitComponentImporter$3, "component")
});
const $$splitComponentImporter$2 = () => import("./admin-BSm2vNxw.js");
const Route$5 = createFileRoute("/admin")({
  loader: () => fetchAnalytics(),
  component: lazyRouteComponent($$splitComponentImporter$2, "component")
});
const $$splitComponentImporter$1 = () => import("./index-DmwVbT-E.js");
const Route$4 = createFileRoute("/")({
  validateSearch: (s) => ({
    category: typeof s.category === "string" ? s.category : "All"
  }),
  loaderDeps: ({
    search
  }) => search,
  loader: ({
    deps
  }) => fetchCatalog({
    data: {
      category: deps.category
    }
  }),
  component: lazyRouteComponent($$splitComponentImporter$1, "component")
});
const $$splitComponentImporter = () => import("./prompt._slug-Dz8MN7xD.js");
const Route$3 = createFileRoute("/prompt/$slug")({
  loader: async ({
    params
  }) => {
    const prompt = await fetchPrompt({
      data: {
        slug: params.slug
      }
    });
    if (!prompt) throw notFound();
    return prompt;
  },
  component: lazyRouteComponent($$splitComponentImporter, "component")
});
const Route$2 = createFileRoute("/api/catalog")({ server: { handlers: { GET: ({ request }) => {
  const url = new URL(request.url);
  return Response.json({ prompts: listPrompts({ model: url.searchParams.get("model") || "All", sort: url.searchParams.get("sort") || "Featured", term: url.searchParams.get("term") || "" }), counts: getCounts(1) });
} } } });
const Route$1 = createFileRoute("/api/cart")({ server: { handlers: { GET: () => Response.json(getCartSummary(1)), POST: async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  return Response.json(addToCart(Number(body.promptId), 1));
} } } });
const Route = createFileRoute("/api/analytics")({ server: { handlers: { GET: () => Response.json(getAnalytics()) } } });
const FavoritesRoute = Route$8.update({
  id: "/favorites",
  path: "/favorites",
  getParentRoute: () => Route$9
});
const CheckoutRoute = Route$7.update({
  id: "/checkout",
  path: "/checkout",
  getParentRoute: () => Route$9
});
const CartRoute = Route$6.update({
  id: "/cart",
  path: "/cart",
  getParentRoute: () => Route$9
});
const AdminRoute = Route$5.update({
  id: "/admin",
  path: "/admin",
  getParentRoute: () => Route$9
});
const IndexRoute = Route$4.update({
  id: "/",
  path: "/",
  getParentRoute: () => Route$9
});
const PromptSlugRoute = Route$3.update({
  id: "/prompt/$slug",
  path: "/prompt/$slug",
  getParentRoute: () => Route$9
});
const ApiCatalogRoute = Route$2.update({
  id: "/api/catalog",
  path: "/api/catalog",
  getParentRoute: () => Route$9
});
const ApiCartRoute = Route$1.update({
  id: "/api/cart",
  path: "/api/cart",
  getParentRoute: () => Route$9
});
const ApiAnalyticsRoute = Route.update({
  id: "/api/analytics",
  path: "/api/analytics",
  getParentRoute: () => Route$9
});
const rootRouteChildren = {
  IndexRoute,
  AdminRoute,
  CartRoute,
  CheckoutRoute,
  FavoritesRoute,
  ApiAnalyticsRoute,
  ApiCartRoute,
  ApiCatalogRoute,
  PromptSlugRoute
};
const routeTree = Route$9._addFileChildren(rootRouteChildren)._addFileTypes();
function createRouter() {
  return createRouter$1({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true
  });
}
const getRouter = createRouter;
const router = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  createRouter,
  getRouter
}, Symbol.toStringTag, { value: "Module" }));
export {
  Route$8 as R,
  fetchCatalog as a,
  Route$7 as b,
  cartAdd as c,
  Route$6 as d,
  cartRemove as e,
  favoritePrompt as f,
  checkoutCart as g,
  Route$5 as h,
  Route$4 as i,
  Route$3 as j,
  router as r
};
