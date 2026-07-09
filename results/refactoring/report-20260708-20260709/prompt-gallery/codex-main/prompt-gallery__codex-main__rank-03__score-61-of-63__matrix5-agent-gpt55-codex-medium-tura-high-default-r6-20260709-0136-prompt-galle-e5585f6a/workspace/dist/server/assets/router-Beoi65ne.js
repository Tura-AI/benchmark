import { n as useToast, r as BoltIcon, t as ToastProvider } from "./Toast-BeHSCiBQ.js";
import { n as api } from "./market-api-BGNTLaER.js";
import { t as Route$1 } from "./cart-Bi18NBQC.js";
import { t as Route$2 } from "./admin-Y3_xC1Z1.js";
import { t as Route$3 } from "./routes-Cb2W4Juw.js";
import { t as Route$4 } from "./prompts._promptId-5g8nM-UB.js";
import { useState } from "react";
import { HeadContent, Link, Outlet, Scripts, createRootRoute, createRouter as createRouter$1, useLoaderData, useNavigate, useRouterState } from "@tanstack/react-router";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Boxes, Clock3, Code2, Gift, Heart, Home, LayoutGrid, Menu, Plug, Search, ShoppingBag, Sparkles, Star } from "lucide-react";
//#region src/components/AppShell.tsx
function AppShell() {
	return /* @__PURE__ */ jsx(ToastProvider, { children: /* @__PURE__ */ jsx(ShellFrame, {}) });
}
function ShellFrame() {
	const shell = useLoaderData({ from: "__root__" });
	const [drawer, setDrawer] = useState(false);
	const state = useRouterState();
	const navigate = useNavigate();
	const { showToast } = useToast();
	const active = state.location.pathname;
	const goFiltered = (next) => {
		setDrawer(false);
		navigate({
			to: "/",
			search: (prev) => ({
				...prev,
				...next
			})
		});
	};
	return /* @__PURE__ */ jsxs(Fragment, { children: [
		/* @__PURE__ */ jsxs("aside", {
			className: `sidebar ${drawer ? "open" : ""}`,
			"aria-label": "Marketplace navigation",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "logo",
					children: [
						/* @__PURE__ */ jsx(BoltIcon, {}),
						/* @__PURE__ */ jsx("b", { children: "POWERPROMPT" }),
						/* @__PURE__ */ jsx("span", { children: "Gallery" })
					]
				}),
				/* @__PURE__ */ jsxs(Link, {
					className: `navi ${active === "/" ? "active" : ""}`,
					to: "/",
					children: [/* @__PURE__ */ jsx(Home, {}), " Home"]
				}),
				/* @__PURE__ */ jsxs("button", {
					className: "navi",
					onClick: () => goFiltered({ searchOpen: true }),
					children: [/* @__PURE__ */ jsx(Search, {}), " Search"]
				}),
				/* @__PURE__ */ jsxs("button", {
					className: "navi",
					onClick: () => showToast("History is empty for now"),
					children: [/* @__PURE__ */ jsx(Clock3, {}), " History"]
				}),
				/* @__PURE__ */ jsxs("button", {
					className: "navi",
					onClick: () => goFiltered({
						favorites: true,
						model: "all",
						category: "all"
					}),
					children: [
						/* @__PURE__ */ jsx(Heart, {}),
						" Favorites ",
						/* @__PURE__ */ jsx("span", {
							className: "new",
							children: "NEW"
						})
					]
				}),
				/* @__PURE__ */ jsx("div", {
					className: "side-label",
					children: "Categories"
				}),
				/* @__PURE__ */ jsx("div", {
					className: "cats",
					children: shell.categories.map((category) => /* @__PURE__ */ jsxs("button", {
						className: "cat",
						onClick: () => goFiltered({
							category: category.name,
							favorites: false
						}),
						children: [
							/* @__PURE__ */ jsx("span", { className: "dot" }),
							category.name,
							/* @__PURE__ */ jsx("span", {
								className: "count",
								children: category.promptCount
							})
						]
					}, category.name))
				}),
				/* @__PURE__ */ jsx("div", {
					className: "side-label",
					children: "More from us"
				}),
				/* @__PURE__ */ jsxs("button", {
					className: "navi",
					onClick: () => showToast("Browser extension - coming soon"),
					children: [/* @__PURE__ */ jsx(Plug, {}), " Browser extension"]
				}),
				/* @__PURE__ */ jsxs("button", {
					className: "navi",
					onClick: () => showToast("Figma plugin - coming soon"),
					children: [/* @__PURE__ */ jsx(Boxes, {}), " Figma plugin"]
				}),
				/* @__PURE__ */ jsxs("button", {
					className: "navi",
					onClick: () => showToast("API docs - coming soon"),
					children: [/* @__PURE__ */ jsx(Code2, {}), " Public API"]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "side-foot",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "promo-card",
							children: [
								/* @__PURE__ */ jsx(Gift, { className: "gift" }),
								/* @__PURE__ */ jsx("h4", { children: "Sell your prompts" }),
								/* @__PURE__ */ jsx("p", { children: "Keep 85% of every sale - paid weekly." })
							]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "side-cta",
							children: [/* @__PURE__ */ jsx(Link, {
								className: "btn-ink",
								to: "/admin",
								children: "Creator hub"
							}), /* @__PURE__ */ jsx("button", {
								className: "free",
								onClick: () => goFiltered({
									freeOnly: true,
									favorites: false
								}),
								children: "Free prompts"
							})]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "side-legal",
							children: [
								/* @__PURE__ */ jsx("span", { children: "Terms" }),
								" · ",
								/* @__PURE__ */ jsx("span", { children: "Privacy" }),
								" · ",
								/* @__PURE__ */ jsx("span", { children: "Refund" }),
								/* @__PURE__ */ jsxs("span", {
									className: "stars",
									children: [/* @__PURE__ */ jsx(Star, {}), " 4.8"]
								})
							]
						})
					]
				})
			]
		}),
		/* @__PURE__ */ jsx("div", {
			className: `scrim ${drawer ? "show" : ""}`,
			onClick: () => setDrawer(false)
		}),
		/* @__PURE__ */ jsxs("main", {
			className: "main",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "mtop",
				children: [
					/* @__PURE__ */ jsx("button", {
						className: "burger",
						onClick: () => setDrawer(true),
						"aria-label": "Open menu",
						children: /* @__PURE__ */ jsx(Menu, {})
					}),
					/* @__PURE__ */ jsx(BoltIcon, {}),
					/* @__PURE__ */ jsx("b", { children: "POWERPROMPT" })
				]
			}), /* @__PURE__ */ jsx(Outlet, {})]
		}),
		/* @__PURE__ */ jsxs("nav", {
			className: "dock",
			"aria-label": "Quick actions",
			children: [
				/* @__PURE__ */ jsx(Link, {
					to: "/",
					className: active === "/" ? "active" : "",
					"aria-label": "Home",
					children: /* @__PURE__ */ jsx(Home, {})
				}),
				/* @__PURE__ */ jsx("button", {
					"aria-label": "History",
					onClick: () => showToast("History is empty for now"),
					children: /* @__PURE__ */ jsx(Clock3, {})
				}),
				/* @__PURE__ */ jsx("button", {
					"aria-label": "Favorites",
					onClick: () => goFiltered({
						favorites: true,
						model: "all",
						category: "all"
					}),
					children: /* @__PURE__ */ jsx(Heart, {})
				}),
				/* @__PURE__ */ jsx(Link, {
					to: "/admin",
					className: active === "/admin" ? "active" : "",
					"aria-label": "Creator analytics",
					children: /* @__PURE__ */ jsx(LayoutGrid, {})
				}),
				/* @__PURE__ */ jsxs(Link, {
					to: "/cart",
					className: active === "/cart" ? "active" : "",
					"aria-label": "Cart",
					children: [/* @__PURE__ */ jsx(ShoppingBag, {}), /* @__PURE__ */ jsx("span", {
						className: `cbadge ${shell.counts.cart ? "show" : ""}`,
						children: shell.counts.cart
					})]
				}),
				/* @__PURE__ */ jsx("button", {
					"aria-label": "Generate",
					onClick: () => showToast("In-app generation - coming soon"),
					children: /* @__PURE__ */ jsx(Sparkles, {})
				})
			]
		})
	] });
}
//#endregion
//#region src/styles/app.css?url
var app_default = "/assets/app-CXZ-SEQ0.css";
//#endregion
//#region src/routes/__root.tsx
var Route = createRootRoute({
	loader: () => api.shell(),
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
				content: "A full-stack TanStack Start prompt marketplace."
			}
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
			},
			{
				rel: "stylesheet",
				href: app_default
			}
		]
	}),
	component: RootDocument
});
function RootDocument() {
	return /* @__PURE__ */ jsxs("html", {
		lang: "en",
		children: [/* @__PURE__ */ jsx("head", { children: /* @__PURE__ */ jsx(HeadContent, {}) }), /* @__PURE__ */ jsxs("body", { children: [/* @__PURE__ */ jsx(AppShell, {}), /* @__PURE__ */ jsx(Scripts, {})] })]
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
var getRouter = createRouter;
//#endregion
export { createRouter, getRouter };
