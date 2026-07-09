import { i as getCartState } from "./functions-BOKx17ep.js";
import { t as Route$1 } from "./cart-D_cpRbKK.js";
import { t as Route$2 } from "./routes-Dt20-Xyj.js";
import { t as Route$3 } from "./prompts._promptId-BqtgXY8h.js";
import { t as Route$4 } from "./admin.analytics-CZLEwAWd.js";
import { useState } from "react";
import { HeadContent, Link, Outlet, Scripts, createRootRoute, createRouter as createRouter$1, useRouter } from "@tanstack/react-router";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region src/components/Shell.tsx
function Shell() {
	const [open, setOpen] = useState(false);
	const router = useRouter();
	const close = () => setOpen(false);
	return /* @__PURE__ */ jsxs("div", {
		className: "app",
		children: [
			/* @__PURE__ */ jsx("div", {
				className: `drawer-scrim ${open ? "show" : ""}`,
				onClick: close
			}),
			/* @__PURE__ */ jsxs("aside", {
				id: "mobile-sidebar",
				className: `sidebar ${open ? "open" : ""}`,
				"aria-label": "POWERPROMPT navigation",
				children: [
					/* @__PURE__ */ jsxs(Link, {
						to: "/",
						className: "logo",
						onClick: close,
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "bolt",
								children: "P"
							}),
							/* @__PURE__ */ jsx("b", { children: "POWER" }),
							/* @__PURE__ */ jsx("span", { children: "PROMPT" })
						]
					}),
					/* @__PURE__ */ jsx(Link, {
						className: "navi active",
						to: "/",
						search: {},
						children: "Home"
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "navi",
						to: "/",
						search: { favoritesOnly: true },
						children: ["Favorites ", /* @__PURE__ */ jsx("span", {
							className: "pill",
							children: "Saved"
						})]
					}),
					/* @__PURE__ */ jsx(Link, {
						className: "navi",
						to: "/cart",
						children: "Cart"
					}),
					/* @__PURE__ */ jsx(Link, {
						className: "navi",
						to: "/admin/analytics",
						children: "Creator analytics"
					}),
					/* @__PURE__ */ jsx("button", {
						className: "navi",
						onClick: () => router.invalidate(),
						children: "Search history"
					}),
					/* @__PURE__ */ jsx("p", {
						className: "side-label mono",
						children: "Categories"
					}),
					[
						"Makeup",
						"Fashion",
						"Product",
						"Portrait",
						"Video"
					].map((name) => /* @__PURE__ */ jsxs(Link, {
						className: "cat",
						to: "/",
						search: { category: name.toLowerCase() },
						onClick: close,
						children: [/* @__PURE__ */ jsx("span", { className: "dot" }), name]
					}, name)),
					/* @__PURE__ */ jsxs("div", {
						className: "promo-card",
						children: [/* @__PURE__ */ jsx("h4", { children: "Creator drop: 16 prompt systems" }), /* @__PURE__ */ jsx("p", { children: "Featured beauty workflows with checkout-ready licensing." })]
					})
				]
			}),
			/* @__PURE__ */ jsxs("main", {
				className: "main",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "mobilebar",
						children: [/* @__PURE__ */ jsxs(Link, {
							to: "/",
							className: "logo",
							children: [
								/* @__PURE__ */ jsx("span", {
									className: "bolt",
									children: "P"
								}),
								/* @__PURE__ */ jsx("b", { children: "POWER" }),
								/* @__PURE__ */ jsx("span", { children: "PROMPT" })
							]
						}), /* @__PURE__ */ jsx("button", {
							"aria-controls": "mobile-sidebar",
							"aria-expanded": open,
							onClick: () => setOpen(true),
							children: "Menu"
						})]
					}),
					/* @__PURE__ */ jsx(Outlet, {}),
					/* @__PURE__ */ jsx(Dock, {})
				]
			})
		]
	});
}
function Dock() {
	const [notice, setNotice] = useState("");
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs("nav", {
		className: "dock",
		"aria-label": "Quick actions",
		children: [
			/* @__PURE__ */ jsx(Link, {
				to: "/",
				search: {},
				children: "Home"
			}),
			/* @__PURE__ */ jsx(Link, {
				to: "/",
				search: { favoritesOnly: true },
				children: "Favorites"
			}),
			/* @__PURE__ */ jsx(Link, {
				to: "/cart",
				children: "Cart"
			}),
			/* @__PURE__ */ jsx(Link, {
				to: "/admin/analytics",
				children: "Creator analytics"
			}),
			/* @__PURE__ */ jsx("button", {
				onClick: async () => {
					const cart = await getCartState();
					setNotice(`${cart.totals.itemCount} prompt(s) in Cart`);
				},
				children: "Dock"
			})
		]
	}), notice ? /* @__PURE__ */ jsx("div", {
		role: "status",
		className: "toast",
		onAnimationEnd: () => setNotice(""),
		children: notice
	}) : null] });
}
var Route = createRootRoute({
	head: () => ({ meta: [
		{ charSet: "utf-8" },
		{
			name: "viewport",
			content: "width=device-width, initial-scale=1"
		},
		{ title: "POWERPROMPT — Prompt Marketplace" }
	] }),
	component: () => /* @__PURE__ */ jsxs(Fragment, { children: [
		/* @__PURE__ */ jsx(HeadContent, {}),
		/* @__PURE__ */ jsx(Shell, {}),
		/* @__PURE__ */ jsx(Scripts, {})
	] })
});
//#endregion
//#region src/routeTree.gen.ts
var CartRoute = Route$1.update({
	id: "/cart",
	path: "/cart",
	getParentRoute: () => Route
});
var IndexRoute = Route$2.update({
	id: "/",
	path: "/",
	getParentRoute: () => Route
});
var PromptsPromptIdRoute = Route$3.update({
	id: "/prompts/$promptId",
	path: "/prompts/$promptId",
	getParentRoute: () => Route
});
var rootRouteChildren = {
	IndexRoute,
	CartRoute,
	AdminAnalyticsRoute: Route$4.update({
		id: "/admin/analytics",
		path: "/admin/analytics",
		getParentRoute: () => Route
	}),
	PromptsPromptIdRoute
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
var getRouter = createRouter;
//#endregion
export { createRouter, getRouter };
