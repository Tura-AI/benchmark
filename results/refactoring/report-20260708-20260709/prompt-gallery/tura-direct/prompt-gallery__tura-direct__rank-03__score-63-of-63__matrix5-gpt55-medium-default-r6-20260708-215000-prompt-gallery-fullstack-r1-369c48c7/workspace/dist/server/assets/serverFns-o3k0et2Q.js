import { n as TSS_SERVER_FUNCTION, r as getServerFnById, t as createServerFn } from "../server.js";
import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { z } from "zod";
//#region src/routes/__root.tsx
function Root() {
	return /* @__PURE__ */ jsx(RootDocument, { children: /* @__PURE__ */ jsx(Outlet, {}) });
}
function RootDocument({ children }) {
	return /* @__PURE__ */ jsxs("html", {
		lang: "en",
		children: [/* @__PURE__ */ jsxs("head", { children: [
			/* @__PURE__ */ jsx(HeadContent, {}),
			/* @__PURE__ */ jsx("meta", {
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			}),
			/* @__PURE__ */ jsx("title", { children: "POWERPROMPT" })
		] }), /* @__PURE__ */ jsxs("body", { children: [children, /* @__PURE__ */ jsx(Scripts, {})] })]
	});
}
function Sidebar({ open, onClose, categories = [], counts }) {
	return /* @__PURE__ */ jsxs("aside", {
		className: `sidebar ${open ? "open" : ""}`,
		"aria-label": "Marketplace navigation",
		children: [
			/* @__PURE__ */ jsxs(Link, {
				to: "/",
				className: "brand",
				onClick: onClose,
				children: [/* @__PURE__ */ jsx("span", {
					className: "mark",
					children: "P"
				}), /* @__PURE__ */ jsxs("span", { children: [
					/* @__PURE__ */ jsx("span", {
						className: "word",
						children: "POWERPROMPT"
					}),
					/* @__PURE__ */ jsx("br", {}),
					/* @__PURE__ */ jsx("span", {
						className: "sub mono",
						children: "Prompt gallery"
					})
				] })]
			}),
			/* @__PURE__ */ jsxs("nav", {
				className: "side-section",
				children: [
					/* @__PURE__ */ jsx("div", {
						className: "side-title mono",
						children: "Browse"
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "navbtn active",
						to: "/",
						onClick: onClose,
						children: ["Home ", /* @__PURE__ */ jsx("span", {
							className: "pill",
							children: counts?.total ?? 12
						})]
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "navbtn",
						to: "/",
						search: { favorites: true },
						onClick: onClose,
						children: ["Favorites ", /* @__PURE__ */ jsx("span", {
							className: "pill",
							children: counts?.favorites ?? 0
						})]
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "navbtn",
						to: "/cart",
						onClick: onClose,
						children: ["Cart ", /* @__PURE__ */ jsx("span", {
							className: "pill",
							children: counts?.cart ?? 0
						})]
					}),
					/* @__PURE__ */ jsx(Link, {
						className: "navbtn",
						to: "/admin",
						onClick: onClose,
						children: "Creator analytics"
					})
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "side-section",
				children: [/* @__PURE__ */ jsx("div", {
					className: "side-title mono",
					children: "Categories"
				}), categories.map((c) => /* @__PURE__ */ jsxs(Link, {
					className: "catbtn",
					to: "/",
					search: { category: c.id },
					onClick: onClose,
					children: [c.name, /* @__PURE__ */ jsx("span", {
						className: "pill",
						children: c.count
					})]
				}, c.id))]
			}),
			/* @__PURE__ */ jsxs("section", {
				className: "cta",
				children: [
					/* @__PURE__ */ jsx("h2", { children: "Build reusable image systems." }),
					/* @__PURE__ */ jsx("p", { children: "Featured and free prompt packs for GPT-4o, Claude, Midjourney, and Flux." }),
					/* @__PURE__ */ jsx(Link, {
						className: "lime",
						to: "/",
						search: { free: true },
						children: "Get free prompts"
					})
				]
			})
		]
	});
}
function Dock() {
	return /* @__PURE__ */ jsxs("nav", {
		className: "dock",
		"aria-label": "Mobile actions",
		children: [
			/* @__PURE__ */ jsx(Link, {
				to: "/",
				children: "Home"
			}),
			/* @__PURE__ */ jsx(Link, {
				to: "/",
				search: { favorites: true },
				children: "Favorites"
			}),
			/* @__PURE__ */ jsx(Link, {
				to: "/cart",
				children: "Cart"
			}),
			/* @__PURE__ */ jsx(Link, {
				to: "/admin",
				children: "Stats"
			})
		]
	});
}
var Route = createRootRoute({ component: Root });
//#endregion
//#region node_modules/@tanstack/start-server-core/dist/esm/createSsrRpc.js
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
//#endregion
//#region src/lib/serverFns.ts
var filters = z.object({
	model: z.string().optional(),
	category: z.string().optional(),
	q: z.string().optional(),
	favorites: z.boolean().optional(),
	free: z.boolean().optional(),
	sort: z.enum([
		"featured",
		"newest",
		"popular"
	]).optional()
});
var fetchCatalog = createServerFn({ method: "GET" }).validator((d) => filters.parse(d ?? {})).handler(createSsrRpc("db433206399f33453b44766f5811265017089f44041de4b4ed5c385013bf02cf"));
var fetchPrompt = createServerFn({ method: "GET" }).validator((d) => z.object({ id: z.string() }).parse(d)).handler(createSsrRpc("8d635cdf9485189215db5439e1187cdb346a0b397d6d453b82a0f03d606f298e"));
var favoritePrompt = createServerFn({ method: "POST" }).validator((d) => z.object({ id: z.string() }).parse(d)).handler(createSsrRpc("5a2d87eb281e31d37c13cad122fe2f39a4ef3bb8a2c3880969562d8445fee7e6"));
var putCart = createServerFn({ method: "POST" }).validator((d) => z.object({ id: z.string() }).parse(d)).handler(createSsrRpc("95bff5597c6cfa313f73e17ab50d4e31ee5675e4f1c6539e717f2973881a1dc2"));
var fetchCart = createServerFn({ method: "GET" }).handler(createSsrRpc("b356e22d1550870763847c2864f29cd9dc823799f8a53dab9b26c39f3cff88c7"));
var runCheckout = createServerFn({ method: "POST" }).handler(createSsrRpc("583b715969ae805cf6c3e4291daa22a02ef63abf79d238bbb1bd0432da91c83b"));
var fetchAnalytics = createServerFn({ method: "GET" }).handler(createSsrRpc("0e0637d6ed3c6d17510f2caadfe11df5c8decc1943f199e0aee565b45ce5ed57"));
//#endregion
export { fetchPrompt as a, Dock as c, fetchCatalog as i, Route as l, fetchAnalytics as n, putCart as o, fetchCart as r, runCheckout as s, favoritePrompt as t, Sidebar as u };
