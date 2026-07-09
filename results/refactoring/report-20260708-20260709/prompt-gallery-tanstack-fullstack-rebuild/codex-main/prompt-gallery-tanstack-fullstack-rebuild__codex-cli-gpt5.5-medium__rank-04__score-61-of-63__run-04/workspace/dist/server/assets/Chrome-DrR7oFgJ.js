import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { Bolt, Box, Clock3, Code2, Gift, Grid2X2, Heart, Home, Image, Menu, PackageSearch, Search, ShoppingBag, Sparkles, Star } from "lucide-react";
//#region src/components/icons.tsx
var Icons = {
	Bolt,
	Box,
	Clock3,
	Code2,
	Gift,
	Grid2X2,
	Heart,
	Home,
	Image,
	Menu,
	PackageSearch,
	Search,
	ShoppingBag,
	Sparkles,
	Star
};
//#endregion
//#region src/components/Chrome.tsx
function Chrome({ children, categories, cartCount }) {
	const [drawer, setDrawer] = useState(false);
	const path = useRouterState({ select: (s) => s.location.pathname });
	return /* @__PURE__ */ jsxs("div", {
		className: "shell",
		children: [
			/* @__PURE__ */ jsxs("aside", {
				className: `sidebar ${drawer ? "open" : ""}`,
				id: "sidebar",
				children: [
					/* @__PURE__ */ jsxs(Link, {
						to: "/",
						className: "logo",
						onClick: () => setDrawer(false),
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "bolt",
								children: /* @__PURE__ */ jsx(Icons.Bolt, {})
							}),
							/* @__PURE__ */ jsx("b", { children: "POWERPROMPT" }),
							/* @__PURE__ */ jsx("span", { children: "Gallery" })
						]
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: `nav-item ${path === "/" ? "active" : ""}`,
						to: "/",
						onClick: () => setDrawer(false),
						children: [/* @__PURE__ */ jsx(Icons.Home, {}), "Home"]
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "nav-item",
						to: "/",
						search: { searchOpen: true },
						onClick: () => setDrawer(false),
						children: [/* @__PURE__ */ jsx(Icons.Search, {}), "Search"]
					}),
					/* @__PURE__ */ jsxs("button", {
						className: "nav-item",
						type: "button",
						children: [/* @__PURE__ */ jsx(Icons.Clock3, {}), "History"]
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: `nav-item ${path === "/" ? "" : ""}`,
						to: "/",
						search: { favoritesOnly: true },
						onClick: () => setDrawer(false),
						children: [
							/* @__PURE__ */ jsx(Icons.Heart, {}),
							"Favorites ",
							/* @__PURE__ */ jsx("span", {
								className: "new-pill",
								children: "NEW"
							})
						]
					}),
					/* @__PURE__ */ jsx("div", {
						className: "side-label",
						children: "Categories"
					}),
					categories.map((category) => /* @__PURE__ */ jsxs(Link, {
						className: "cat",
						to: "/",
						search: { category: category.name },
						onClick: () => setDrawer(false),
						children: [/* @__PURE__ */ jsx("span", { className: "dot" }), category.name]
					}, category.name)),
					/* @__PURE__ */ jsx("div", {
						className: "side-label",
						children: "More from us"
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "nav-item",
						to: "/admin",
						children: [/* @__PURE__ */ jsx(Icons.PackageSearch, {}), "Creator analytics"]
					}),
					/* @__PURE__ */ jsxs("button", {
						className: "nav-item",
						type: "button",
						children: [/* @__PURE__ */ jsx(Icons.Box, {}), "Browser extension"]
					}),
					/* @__PURE__ */ jsxs("button", {
						className: "nav-item",
						type: "button",
						children: [/* @__PURE__ */ jsx(Icons.Code2, {}), "Public API"]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "side-foot",
						children: [
							/* @__PURE__ */ jsxs("div", {
								className: "promo-card",
								children: [
									/* @__PURE__ */ jsx(Icons.Gift, {}),
									/* @__PURE__ */ jsx("h4", { children: "Sell your prompts" }),
									/* @__PURE__ */ jsx("p", { children: "Keep 85% of every sale, paid weekly." })
								]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "side-cta",
								children: [/* @__PURE__ */ jsx(Link, {
									className: "btn-ink",
									to: "/admin",
									children: "Get started"
								}), /* @__PURE__ */ jsx(Link, {
									className: "free-link",
									to: "/",
									search: { freeOnly: true },
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
									/* @__PURE__ */ jsx("span", {
										className: "stars",
										children: "★ 4.8"
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
					className: "mobile-top",
					children: [
						/* @__PURE__ */ jsx("button", {
							className: "burger",
							"aria-label": "Menu",
							onClick: () => setDrawer(true),
							children: /* @__PURE__ */ jsx(Icons.Menu, {})
						}),
						/* @__PURE__ */ jsx("span", {
							className: "bolt",
							children: /* @__PURE__ */ jsx(Icons.Bolt, {})
						}),
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
						className: path === "/" ? "active" : "",
						"aria-label": "Home",
						children: /* @__PURE__ */ jsx(Icons.Home, {})
					}),
					/* @__PURE__ */ jsx("button", {
						"aria-label": "History",
						children: /* @__PURE__ */ jsx(Icons.Clock3, {})
					}),
					/* @__PURE__ */ jsx(Link, {
						to: "/",
						search: { favoritesOnly: true },
						"aria-label": "Favorites",
						children: /* @__PURE__ */ jsx(Icons.Heart, {})
					}),
					/* @__PURE__ */ jsx(Link, {
						to: "/admin",
						"aria-label": "Collections",
						children: /* @__PURE__ */ jsx(Icons.Grid2X2, {})
					}),
					/* @__PURE__ */ jsxs(Link, {
						to: "/cart",
						className: path === "/cart" ? "active" : "",
						"aria-label": "Cart",
						children: [/* @__PURE__ */ jsx(Icons.ShoppingBag, {}), cartCount > 0 ? /* @__PURE__ */ jsx("span", {
							className: "badge",
							children: cartCount
						}) : null]
					}),
					/* @__PURE__ */ jsx("button", {
						"aria-label": "Generate",
						children: /* @__PURE__ */ jsx(Icons.Sparkles, {})
					})
				]
			})
		]
	});
}
//#endregion
export { Chrome as t };
