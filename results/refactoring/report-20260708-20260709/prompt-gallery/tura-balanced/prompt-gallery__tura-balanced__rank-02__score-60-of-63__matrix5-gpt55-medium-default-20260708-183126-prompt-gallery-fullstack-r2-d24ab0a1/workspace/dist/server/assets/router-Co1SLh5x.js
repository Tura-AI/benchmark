import { t as Route$1 } from "./cart-BX88Wv0x.js";
import { t as Route$2 } from "./admin-BEsQX7z1.js";
import { t as Route$3 } from "./routes-Dl3XZHma.js";
import { t as Route$4 } from "./prompts._promptId-D9v8jyo8.js";
import { HeadContent, Outlet, Scripts, createRootRoute, createRouter as createRouter$1 } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/__root.tsx
var Route = createRootRoute({
	head: () => ({ meta: [
		{ charSet: "utf-8" },
		{
			name: "viewport",
			content: "width=device-width, initial-scale=1"
		},
		{ title: "POWERPROMPT — Prompt Gallery" }
	] }),
	component: Root
});
function Root() {
	return /* @__PURE__ */ jsxs("html", {
		lang: "en",
		children: [/* @__PURE__ */ jsx("head", { children: /* @__PURE__ */ jsx(HeadContent, {}) }), /* @__PURE__ */ jsxs("body", { children: [/* @__PURE__ */ jsx(Outlet, {}), /* @__PURE__ */ jsx(Scripts, {})] })]
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
		defaultPreload: "intent",
		scrollRestoration: true
	});
}
function getRouter() {
	return createRouter();
}
//#endregion
export { createRouter, getRouter };
