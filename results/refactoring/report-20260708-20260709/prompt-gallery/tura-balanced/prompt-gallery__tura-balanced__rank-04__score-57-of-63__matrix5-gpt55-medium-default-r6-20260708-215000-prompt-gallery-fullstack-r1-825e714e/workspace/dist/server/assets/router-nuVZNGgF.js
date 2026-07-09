import { createRootRoute, HeadContent, Scripts, createFileRoute, lazyRouteComponent, notFound, createRouter as createRouter$1 } from "@tanstack/react-router";
import { jsxs, jsx } from "react/jsx-runtime";
import { T as TSS_SERVER_FUNCTION, g as getServerFnById, c as createServerFn } from "../server.js";
import { z } from "zod";
import { g as getCart, a as getFilterCounts, l as listCategories, b as listPrompts, c as getAnalytics } from "./queries-R7sLH0o3.js";
const appCss = "/assets/app-CpcXrIoo.css";
const interactionFixesCss = "/assets/interaction-fixes-CJz77wKx.css";
const Route$6 = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "POWERPROMPT Gallery" }
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: interactionFixesCss }
    ]
  }),
  shellComponent: RootDocument
});
function RootDocument({ children }) {
  return /* @__PURE__ */ jsxs("html", { lang: "en", children: [
    /* @__PURE__ */ jsx("head", { children: /* @__PURE__ */ jsx(HeadContent, {}) }),
    /* @__PURE__ */ jsxs("body", { children: [
      children,
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
const catalogSchema = z.object({
  model: z.enum(["all", "GPT-4o", "Claude", "Midjourney", "Flux"]).optional(),
  category: z.string().optional(),
  sort: z.enum(["featured", "newest", "popular"]).optional(),
  term: z.string().optional(),
  favoritesOnly: z.boolean().optional(),
  priceMode: z.enum(["all", "free", "paid"]).optional()
});
const idSchema = z.object({
  promptId: z.number().int().positive()
});
const getCatalogFn = createServerFn({
  method: "GET"
}).validator((data) => catalogSchema.parse(data ?? {})).handler(createSsrRpc("22280aa419ab6fe111f40373b7a5bcd703591f084b854a2961084956e87eb10d"));
const getPromptFn = createServerFn({
  method: "GET"
}).validator((data) => z.object({
  slug: z.string()
}).parse(data)).handler(createSsrRpc("521f90fb1eb33240989f6de95c778a66a174f1297fbc3dc2abe27b749bdf966b"));
const toggleFavoriteFn = createServerFn({
  method: "POST"
}).validator((data) => idSchema.parse(data)).handler(createSsrRpc("469896283cff030cc9bc742d5b57d0523e86f532c737dc6c2de8e8212111ef87"));
const addToCartFn = createServerFn({
  method: "POST"
}).validator((data) => idSchema.parse(data)).handler(createSsrRpc("13799a03ae7e7b916d209dbe27de59c54730206602ac449aa88230f3f2f3850c"));
const removeFromCartFn = createServerFn({
  method: "POST"
}).validator((data) => idSchema.parse(data)).handler(createSsrRpc("9cd9c31ab345fa0967ecdfc52dfda96db12aa517a28776ddd9c56ba22208f130"));
const getCartFn = createServerFn({
  method: "GET"
}).handler(createSsrRpc("13dd8f8d8da9e853736e64202f2ebfd2a0f118c2db4a90aed3bd3dfd037517b5"));
const checkoutFn = createServerFn({
  method: "POST"
}).handler(createSsrRpc("d0e4d1410ee7278af658890a54f5561caddf0137bad34573e64966a4f328ca79"));
const getAnalyticsFn = createServerFn({
  method: "GET"
}).handler(createSsrRpc("2aac43ce6a2882cb9124d98454a3954aba15ec4c6fa224b19fb952d642f612b7"));
const $$splitComponentImporter$3 = () => import("./cart-CrafVbYU.js");
const Route$5 = createFileRoute("/cart")({
  loader: async () => ({
    catalog: await getCatalogFn({
      data: {}
    }),
    cart: await getCartFn()
  }),
  component: lazyRouteComponent($$splitComponentImporter$3, "component")
});
const $$splitComponentImporter$2 = () => import("./admin-Cqux8-nR.js");
const Route$4 = createFileRoute("/admin")({
  loader: async () => ({
    catalog: await getCatalogFn({
      data: {}
    }),
    analytics: await getAnalyticsFn()
  }),
  component: lazyRouteComponent($$splitComponentImporter$2, "component")
});
const $$splitComponentImporter$1 = () => import("./index-BcFc-Mx3.js");
const Route$3 = createFileRoute("/")({
  validateSearch: (search) => ({
    model: ["GPT-4o", "Claude", "Midjourney", "Flux", "all"].includes(String(search.model)) ? search.model : "all",
    category: typeof search.category === "string" ? search.category : "all",
    sort: ["featured", "newest", "popular"].includes(String(search.sort)) ? search.sort : "featured",
    q: typeof search.q === "string" ? search.q : "",
    favorites: search.favorites === true || search.favorites === "true"
  }),
  loaderDeps: ({
    search
  }) => search,
  loader: ({
    deps
  }) => getCatalogFn({
    data: {
      model: deps.model,
      category: deps.category,
      sort: deps.sort,
      term: deps.q,
      favoritesOnly: deps.favorites
    }
  }),
  component: lazyRouteComponent($$splitComponentImporter$1, "component")
});
const $$splitComponentImporter = () => import("./prompts._slug-DaTY2Lm-.js");
const Route$2 = createFileRoute("/prompts/$slug")({
  loader: async ({
    params
  }) => {
    const [prompt, catalog] = await Promise.all([getPromptFn({
      data: {
        slug: params.slug
      }
    }), getCatalogFn({
      data: {}
    })]);
    if (!prompt) throw notFound();
    return {
      prompt,
      catalog
    };
  },
  component: lazyRouteComponent($$splitComponentImporter, "component")
});
const Route$1 = createFileRoute("/api/catalog")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url);
        return Response.json({
          prompts: listPrompts({
            model: url.searchParams.get("model") ?? "all",
            category: url.searchParams.get("category") ?? "all",
            sort: url.searchParams.get("sort") ?? "featured",
            term: url.searchParams.get("term") ?? "",
            favoritesOnly: url.searchParams.get("favorites") === "true"
          }),
          categories: listCategories(),
          counts: getFilterCounts(),
          cart: getCart()
        });
      }
    }
  }
});
const Route = createFileRoute("/api/analytics")({
  server: {
    handlers: {
      GET: () => Response.json(getAnalytics())
    }
  }
});
const CartRoute = Route$5.update({
  id: "/cart",
  path: "/cart",
  getParentRoute: () => Route$6
});
const AdminRoute = Route$4.update({
  id: "/admin",
  path: "/admin",
  getParentRoute: () => Route$6
});
const IndexRoute = Route$3.update({
  id: "/",
  path: "/",
  getParentRoute: () => Route$6
});
const PromptsSlugRoute = Route$2.update({
  id: "/prompts/$slug",
  path: "/prompts/$slug",
  getParentRoute: () => Route$6
});
const ApiCatalogRoute = Route$1.update({
  id: "/api/catalog",
  path: "/api/catalog",
  getParentRoute: () => Route$6
});
const ApiAnalyticsRoute = Route.update({
  id: "/api/analytics",
  path: "/api/analytics",
  getParentRoute: () => Route$6
});
const rootRouteChildren = {
  IndexRoute,
  AdminRoute,
  CartRoute,
  ApiAnalyticsRoute,
  ApiCatalogRoute,
  PromptsSlugRoute
};
const routeTree = Route$6._addFileChildren(rootRouteChildren)._addFileTypes();
function getRouter() {
  return createRouter$1({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent"
  });
}
const createRouter = getRouter;
const router = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  createRouter,
  getRouter
}, Symbol.toStringTag, { value: "Module" }));
export {
  Route$5 as R,
  Route$4 as a,
  Route$3 as b,
  checkoutFn as c,
  addToCartFn as d,
  Route$2 as e,
  router as f,
  removeFromCartFn as r,
  toggleFavoriteFn as t
};
