import "../_runtime.mjs";
import { L as require_react, c as HeadContent, d as Outlet, m as createRootRoute, p as createFileRoute, s as Scripts, u as createRouter, v as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { t as Route$6 } from "./admin.analytics-BzyuSkkp.mjs";
import { t as Route$7 } from "./cart-Dc0eYN_R.mjs";
import { t as Route$8 } from "./prompts._promptId-Bv4Hj3ZK.mjs";
import { c as toggleFavorite, i as getCartSummary, n as checkout, o as getStorefront, r as getAnalytics, s as removeFromCart, t as addToCart } from "./db-DaTCybyF.mjs";
import { t as Route$9 } from "./routes-CIoeulzr.mjs";
require_react();
var import_jsx_runtime = require_jsx_runtime();
var app_default = "/assets/app-gIyr5pww.css";
var Route$5 = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			},
			{ title: "POWERPROMPT - Prompt Marketplace" },
			{
				name: "description",
				content: "A full-stack TanStack Start prompt marketplace with catalog, cart, checkout, and creator analytics."
			}
		],
		links: [{
			rel: "stylesheet",
			href: app_default
		}]
	}),
	component: Outlet,
	shellComponent: RootDocument
});
function RootDocument({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("html", {
		lang: "en",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("head", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeadContent, {}) }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("body", { children: [children, /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Scripts, {})] })]
	});
}
async function catalogApi(request) {
	const url = new URL(request.url);
	return Response.json(getStorefront({
		model: url.searchParams.get("model") ?? "all",
		category: url.searchParams.get("category") ?? "all",
		sort: url.searchParams.get("sort") ?? "featured",
		q: url.searchParams.get("q") ?? "",
		favorites: url.searchParams.get("favorites") === "true",
		free: url.searchParams.get("free") === "true"
	}));
}
async function cartApi(request) {
	if (request.method === "GET") return Response.json(getCartSummary());
	if (request.method === "POST") {
		const body = await request.json();
		return Response.json(addToCart(Number(body.promptId)));
	}
	if (request.method === "DELETE") {
		const url = new URL(request.url);
		return Response.json(removeFromCart(Number(url.searchParams.get("promptId"))));
	}
	return new Response("Method not allowed", { status: 405 });
}
async function favoriteApi(request) {
	const body = await request.json();
	return Response.json(toggleFavorite(Number(body.promptId)));
}
async function checkoutApi() {
	return Response.json(checkout());
}
async function analyticsApi() {
	return Response.json(getAnalytics());
}
var Route$4 = createFileRoute("/api/favorite")({ server: { handlers: { POST: async ({ request }) => favoriteApi(request) } } });
var Route$3 = createFileRoute("/api/checkout")({ server: { handlers: { POST: async () => checkoutApi() } } });
var Route$2 = createFileRoute("/api/catalog")({ server: { handlers: { GET: async ({ request }) => catalogApi(request) } } });
var Route$1 = createFileRoute("/api/cart")({ server: { handlers: {
	GET: async ({ request }) => cartApi(request),
	POST: async ({ request }) => cartApi(request),
	DELETE: async ({ request }) => cartApi(request)
} } });
var Route = createFileRoute("/api/analytics")({ server: { handlers: { GET: async () => analyticsApi() } } });
var CartRoute = Route$7.update({
	id: "/cart",
	path: "/cart",
	getParentRoute: () => Route$5
});
var IndexRoute = Route$9.update({
	id: "/",
	path: "/",
	getParentRoute: () => Route$5
});
var PromptsPromptIdRoute = Route$8.update({
	id: "/prompts/$promptId",
	path: "/prompts/$promptId",
	getParentRoute: () => Route$5
});
var ApiFavoriteRoute = Route$4.update({
	id: "/api/favorite",
	path: "/api/favorite",
	getParentRoute: () => Route$5
});
var ApiCheckoutRoute = Route$3.update({
	id: "/api/checkout",
	path: "/api/checkout",
	getParentRoute: () => Route$5
});
var ApiCatalogRoute = Route$2.update({
	id: "/api/catalog",
	path: "/api/catalog",
	getParentRoute: () => Route$5
});
var ApiCartRoute = Route$1.update({
	id: "/api/cart",
	path: "/api/cart",
	getParentRoute: () => Route$5
});
var ApiAnalyticsRoute = Route.update({
	id: "/api/analytics",
	path: "/api/analytics",
	getParentRoute: () => Route$5
});
var rootRouteChildren = {
	IndexRoute,
	CartRoute,
	AdminAnalyticsRoute: Route$6.update({
		id: "/admin/analytics",
		path: "/admin/analytics",
		getParentRoute: () => Route$5
	}),
	ApiAnalyticsRoute,
	ApiCartRoute,
	ApiCatalogRoute,
	ApiCheckoutRoute,
	ApiFavoriteRoute,
	PromptsPromptIdRoute
};
var routeTree = Route$5._addFileChildren(rootRouteChildren)._addFileTypes();
function getRouter() {
	return createRouter({
		routeTree,
		defaultPreload: "intent",
		scrollRestoration: true
	});
}
//#endregion
export { getRouter };
