import { t as Route$2 } from "./cart-DpqfGVfd.js";
import { t as Route$3 } from "./routes-CLcI4xyQ.js";
import { t as Route$4 } from "./_promptId-CZMslJc3.js";
import { HeadContent, Outlet, Scripts, createFileRoute, createRootRoute, createRouter, lazyRouteComponent } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/__root.tsx
var Route$1 = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			},
			{
				name: "description",
				content: "POWERPROMPT Gallery, a full-stack prompt marketplace for AI creators."
			},
			{ title: "POWERPROMPT Gallery" }
		],
		links: [
			{
				rel: "preconnect",
				href: "https://fonts.googleapis.com"
			},
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous"
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Geist:wght@300;400;450;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap"
			}
		]
	}),
	component: RootComponent
});
function RootComponent() {
	return /* @__PURE__ */ jsx(RootDocument, { children: /* @__PURE__ */ jsx(Outlet, {}) });
}
function RootDocument({ children }) {
	return /* @__PURE__ */ jsxs("html", {
		lang: "en",
		children: [/* @__PURE__ */ jsx("head", { children: /* @__PURE__ */ jsx(HeadContent, {}) }), /* @__PURE__ */ jsxs("body", { children: [children, /* @__PURE__ */ jsx(Scripts, {})] })]
	});
}
//#endregion
//#region src/routes/creator.tsx
var $$splitComponentImporter = () => import("./creator-DoEDQaPK.js");
//#endregion
//#region src/routeTree.gen.ts
var CreatorRoute = createFileRoute("/creator")({
	loader: () => null,
	component: lazyRouteComponent($$splitComponentImporter, "component")
}).update({
	id: "/creator",
	path: "/creator",
	getParentRoute: () => Route$1
});
var CartRoute = Route$2.update({
	id: "/cart",
	path: "/cart",
	getParentRoute: () => Route$1
});
var rootRouteChildren = {
	IndexRoute: Route$3.update({
		id: "/",
		path: "/",
		getParentRoute: () => Route$1
	}),
	CartRoute,
	CreatorRoute,
	PromptsPromptIdRoute: Route$4.update({
		id: "/prompts/$promptId",
		path: "/prompts/$promptId",
		getParentRoute: () => Route$1
	})
};
var routeTree = Route$1._addFileChildren(rootRouteChildren)._addFileTypes();
//#endregion
//#region src/router.tsx
function getRouter() {
	return createRouter({
		routeTree,
		scrollRestoration: true
	});
}
//#endregion
export { getRouter };
