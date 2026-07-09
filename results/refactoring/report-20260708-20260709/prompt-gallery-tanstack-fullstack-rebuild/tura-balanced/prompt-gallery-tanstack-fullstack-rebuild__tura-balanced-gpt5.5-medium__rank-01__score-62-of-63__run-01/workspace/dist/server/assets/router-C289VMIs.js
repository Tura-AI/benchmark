import { t as ToastProvider } from "./toast-0CjHUAlA.js";
import { t as Route$1 } from "./cart-0aIRoLtU.js";
import { t as Route$2 } from "./analytics-C2eS6eKo.js";
import { t as Route$3 } from "./routes-DntEwOkX.js";
import { t as Route$4 } from "./prompts._promptId-B_zlD9LX.js";
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
		{ title: "POWERPROMPT - Prompt Marketplace" }
	] }),
	component: RootDocument
});
function RootDocument() {
	return /* @__PURE__ */ jsxs("html", {
		lang: "en",
		children: [/* @__PURE__ */ jsx("head", { children: /* @__PURE__ */ jsx(HeadContent, {}) }), /* @__PURE__ */ jsxs("body", { children: [/* @__PURE__ */ jsx(ToastProvider, { children: /* @__PURE__ */ jsx(Outlet, {}) }), /* @__PURE__ */ jsx(Scripts, {})] })]
	});
}
//#endregion
//#region src/routeTree.gen.ts
var CartRoute = Route$1.update({
	id: "/cart",
	path: "/cart",
	getParentRoute: () => Route
});
var AnalyticsRoute = Route$2.update({
	id: "/analytics",
	path: "/analytics",
	getParentRoute: () => Route
});
var rootRouteChildren = {
	IndexRoute: Route$3.update({
		id: "/",
		path: "/",
		getParentRoute: () => Route
	}),
	AnalyticsRoute,
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
var getRouter = createRouter;
//#endregion
export { createRouter, getRouter };
