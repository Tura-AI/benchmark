import { t as Route$1 } from "./cart-JzuS8SOW.js";
import { t as Route$2 } from "./admin-DI_VLl8H.js";
import { t as Route$3 } from "./routes-m7p3bhXJ.js";
import { t as Route$4 } from "./prompts._promptId-B5gKGTZT.js";
import { Link, Outlet, createRootRoute, createRouter as createRouter$1 } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/__root.tsx
var Route = createRootRoute({
	head: () => ({ meta: [{ title: "POWERPROMPT — Prompt Marketplace" }] }),
	component: Root
});
function Root() {
	return /* @__PURE__ */ jsxs("html", {
		lang: "en",
		children: [/* @__PURE__ */ jsxs("head", { children: [
			/* @__PURE__ */ jsx("meta", { charSet: "utf-8" }),
			/* @__PURE__ */ jsx("meta", {
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			}),
			/* @__PURE__ */ jsx("title", { children: "POWERPROMPT — Prompt Marketplace" })
		] }), /* @__PURE__ */ jsxs("body", { children: [
			/* @__PURE__ */ jsx("a", {
				className: "skip",
				href: "#content",
				children: "Skip to content"
			}),
			/* @__PURE__ */ jsx(Outlet, {}),
			/* @__PURE__ */ jsxs("nav", {
				className: "dock",
				"aria-label": "Mobile navigation",
				children: [
					/* @__PURE__ */ jsx(Link, {
						to: "/",
						activeOptions: { exact: true },
						children: "Home"
					}),
					/* @__PURE__ */ jsx(Link, {
						to: "/",
						search: {
							favorites: true,
							sort: "Featured"
						},
						children: "Favorites"
					}),
					/* @__PURE__ */ jsx(Link, {
						to: "/cart",
						children: "Cart"
					}),
					/* @__PURE__ */ jsx(Link, {
						to: "/admin",
						children: "Analytics"
					})
				]
			})
		] })]
	});
}
//#endregion
//#region src/routeTree.gen.ts
var CartRoute = Route$1.update({
	id: "/cart",
	path: "/cart",
	getParentRoute: () => Route
});
var AdminRoute = Route$2.update({
	id: "/admin",
	path: "/admin",
	getParentRoute: () => Route
});
var rootRouteChildren = {
	IndexRoute: Route$3.update({
		id: "/",
		path: "/",
		getParentRoute: () => Route
	}),
	AdminRoute,
	CartRoute,
	PromptsPromptIdRoute: Route$4.update({
		id: "/prompts/$promptId",
		path: "/prompts/$promptId",
		getParentRoute: () => Route
	})
};
var routeTree = Route._addFileChildren(rootRouteChildren)._addFileTypes();
//#endregion
//#region src/router.tsx
function createRouter() {
	return createRouter$1({
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent"
	});
}
function getRouter() {
	return createRouter();
}
//#endregion
export { createRouter, getRouter };
