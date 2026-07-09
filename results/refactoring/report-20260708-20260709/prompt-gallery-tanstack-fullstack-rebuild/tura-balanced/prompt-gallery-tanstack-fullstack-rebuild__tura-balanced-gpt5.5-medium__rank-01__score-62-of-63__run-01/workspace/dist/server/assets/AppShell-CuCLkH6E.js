import { n as categories } from "./seed-FYamb1wu.js";
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { ArrowRight, Bookmark, Boxes, Clock3, Code2, Gift, Heart, Home, Menu, Search, ShoppingBag, Sparkles, Star, Wand2, X } from "lucide-react";
//#region src/components/icons.tsx
var Icons = {
	ArrowRight,
	Bookmark,
	Boxes,
	Clock3,
	Code2,
	Gift,
	Heart,
	Home,
	Menu,
	Search,
	ShoppingBag,
	Sparkles,
	Star,
	Wand2,
	X
};
function Bolt({ small = false }) {
	return /* @__PURE__ */ jsx("span", {
		className: "bolt",
		style: small ? {
			width: 28,
			height: 28,
			borderRadius: 7
		} : void 0,
		children: /* @__PURE__ */ jsx("svg", {
			viewBox: "0 0 24 24",
			fill: "currentColor",
			width: small ? 15 : 16,
			height: small ? 15 : 16,
			"aria-hidden": "true",
			children: /* @__PURE__ */ jsx("path", { d: "M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l0-8Z" })
		})
	});
}
//#endregion
//#region src/components/AppShell.tsx
function AppShell({ children, cartCount = 0 }) {
	const [drawer, setDrawer] = useState(false);
	const navigate = useNavigate();
	const close = () => setDrawer(false);
	return /* @__PURE__ */ jsxs("div", {
		className: "app",
		children: [
			/* @__PURE__ */ jsxs("aside", {
				className: `sidebar ${drawer ? "open" : ""}`,
				"aria-label": "Marketplace navigation",
				children: [
					/* @__PURE__ */ jsxs(Link, {
						className: "logo",
						to: "/",
						onClick: close,
						children: [
							/* @__PURE__ */ jsx(Bolt, {}),
							/* @__PURE__ */ jsx("b", { children: "POWERPROMPT" }),
							/* @__PURE__ */ jsx("span", { children: "Gallery" })
						]
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "navi",
						activeProps: { className: "navi active" },
						to: "/",
						onClick: close,
						children: [/* @__PURE__ */ jsx(Icons.Home, {}), " Home"]
					}),
					/* @__PURE__ */ jsxs("button", {
						className: "navi",
						type: "button",
						onClick: () => window.dispatchEvent(new Event("powerprompt:search")),
						children: [/* @__PURE__ */ jsx(Icons.Search, {}), " Search"]
					}),
					/* @__PURE__ */ jsxs("button", {
						className: "navi",
						type: "button",
						onClick: () => window.dispatchEvent(new CustomEvent("powerprompt:toast", { detail: "History is empty for now" })),
						children: [/* @__PURE__ */ jsx(Icons.Clock3, {}), " History"]
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "navi",
						to: "/",
						search: {
							favorites: "1",
							model: "all",
							category: "all",
							sort: "featured",
							q: ""
						},
						onClick: close,
						children: [
							/* @__PURE__ */ jsx(Icons.Heart, {}),
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
					categories.map((category) => /* @__PURE__ */ jsxs("button", {
						className: "cat",
						type: "button",
						onClick: () => {
							close();
							navigate({
								to: "/",
								search: {
									category,
									model: "all",
									sort: "featured",
									q: "",
									favorites: void 0,
									free: void 0
								}
							});
						},
						children: [/* @__PURE__ */ jsx("span", { className: "dot" }), category]
					}, category)),
					/* @__PURE__ */ jsx("div", {
						className: "side-label",
						children: "More from us"
					}),
					/* @__PURE__ */ jsxs("button", {
						className: "navi",
						type: "button",
						onClick: () => window.dispatchEvent(new CustomEvent("powerprompt:toast", { detail: "Browser extension - coming soon" })),
						children: [/* @__PURE__ */ jsx(Icons.Boxes, {}), " Browser extension"]
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "navi",
						to: "/analytics",
						onClick: close,
						children: [/* @__PURE__ */ jsx(Icons.Code2, {}), " Creator analytics"]
					}),
					/* @__PURE__ */ jsxs("button", {
						className: "navi",
						type: "button",
						onClick: () => window.dispatchEvent(new CustomEvent("powerprompt:toast", { detail: "Public API: /api/prompts, /api/cart, /api/analytics" })),
						children: [/* @__PURE__ */ jsx(Icons.Code2, {}), " Public API"]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "side-foot",
						children: [
							/* @__PURE__ */ jsxs("div", {
								className: "promo-card",
								children: [
									/* @__PURE__ */ jsx(Icons.Gift, {}),
									/* @__PURE__ */ jsx("h4", { children: "Sell your prompts" }),
									/* @__PURE__ */ jsx("p", { children: "Keep 85% of every sale - paid weekly." })
								]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "side-cta",
								children: [/* @__PURE__ */ jsx(Link, {
									className: "btn-ink",
									to: "/analytics",
									children: "Get started"
								}), /* @__PURE__ */ jsx(Link, {
									className: "free",
									to: "/",
									search: {
										free: "1",
										model: "all",
										category: "all",
										sort: "featured",
										q: ""
									},
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
										children: [/* @__PURE__ */ jsx(Icons.Star, {
											size: 11,
											fill: "currentColor"
										}), " 4.8"]
									})
								]
							})
						]
					})
				]
			}),
			/* @__PURE__ */ jsx("div", {
				className: `scrim ${drawer ? "show" : ""}`,
				onClick: close
			}),
			/* @__PURE__ */ jsxs("main", {
				className: "main",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "mtop",
					children: [
						/* @__PURE__ */ jsx("button", {
							className: "burger",
							type: "button",
							"aria-label": "Menu",
							onClick: () => setDrawer(true),
							children: /* @__PURE__ */ jsx(Icons.Menu, { size: 20 })
						}),
						/* @__PURE__ */ jsx(Bolt, { small: true }),
						/* @__PURE__ */ jsx("b", { children: "POWERPROMPT" })
					]
				}), children]
			}),
			/* @__PURE__ */ jsxs("nav", {
				className: "dock",
				"aria-label": "Quick actions",
				children: [
					/* @__PURE__ */ jsx(Link, {
						to: "/",
						activeProps: { className: "active" },
						children: /* @__PURE__ */ jsx(Icons.Home, {})
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						onClick: () => window.dispatchEvent(new CustomEvent("powerprompt:toast", { detail: "History is empty for now" })),
						children: /* @__PURE__ */ jsx(Icons.Clock3, {})
					}),
					/* @__PURE__ */ jsx(Link, {
						to: "/",
						search: {
							favorites: "1",
							model: "all",
							category: "all",
							sort: "featured",
							q: ""
						},
						children: /* @__PURE__ */ jsx(Icons.Heart, {})
					}),
					/* @__PURE__ */ jsx(Link, {
						to: "/analytics",
						children: /* @__PURE__ */ jsx(Icons.Boxes, {})
					}),
					/* @__PURE__ */ jsxs(Link, {
						to: "/cart",
						children: [/* @__PURE__ */ jsx(Icons.ShoppingBag, {}), cartCount > 0 ? /* @__PURE__ */ jsx("span", {
							className: "cbadge",
							children: cartCount
						}) : null]
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						onClick: () => window.dispatchEvent(new CustomEvent("powerprompt:toast", { detail: "In-app generation - coming soon" })),
						children: /* @__PURE__ */ jsx(Icons.Wand2, {})
					})
				]
			})
		]
	});
}
//#endregion
export { Icons as n, AppShell as t };
