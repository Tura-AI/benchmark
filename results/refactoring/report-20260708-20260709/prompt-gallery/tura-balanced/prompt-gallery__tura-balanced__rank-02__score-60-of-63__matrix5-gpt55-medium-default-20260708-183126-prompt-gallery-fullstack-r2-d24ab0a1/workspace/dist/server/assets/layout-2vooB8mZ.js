import { useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region src/components/icons.tsx
function BoltIcon({ size = 18 }) {
	return /* @__PURE__ */ jsx("svg", {
		width: size,
		height: size,
		viewBox: "0 0 24 24",
		fill: "currentColor",
		children: /* @__PURE__ */ jsx("path", { d: "M13 2 4.5 13.5H11l-1 8.5L19.5 10H13V2Z" })
	});
}
function Icon({ name }) {
	const common = {
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor"
	};
	const paths = {
		home: /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("path", { d: "M3 11.5 12 4l9 7.5" }), /* @__PURE__ */ jsx("path", { d: "M5 10v10h14V10" })] }),
		search: /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("circle", {
			cx: "11",
			cy: "11",
			r: "7"
		}), /* @__PURE__ */ jsx("path", { d: "m20 20-3.5-3.5" })] }),
		heart: /* @__PURE__ */ jsx("path", { d: "M12 20s-7-4.4-9.2-8.3C1.1 8.5 2.6 5 6 5c2 0 3.2 1.2 4 2.3C10.8 6.2 12 5 14 5c3.4 0 4.9 3.5 3.2 6.7C19 15.6 12 20 12 20Z" }),
		cart: /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("path", { d: "M6 7h13l-1.2 9.5a2 2 0 0 1-2 1.75H9.2a2 2 0 0 1-2-1.75L6 7Z" }), /* @__PURE__ */ jsx("path", { d: "M9 7a3 3 0 0 1 6 0" })] }),
		clock: /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("circle", {
			cx: "12",
			cy: "12",
			r: "9"
		}), /* @__PURE__ */ jsx("path", { d: "M12 7v5l3 2" })] }),
		api: /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("path", { d: "m8 16-4-4 4-4" }), /* @__PURE__ */ jsx("path", { d: "m16 8 4 4-4 4" })] }),
		figma: /* @__PURE__ */ jsxs(Fragment, { children: [
			/* @__PURE__ */ jsx("circle", {
				cx: "9",
				cy: "6",
				r: "3"
			}),
			/* @__PURE__ */ jsx("circle", {
				cx: "9",
				cy: "18",
				r: "3"
			}),
			/* @__PURE__ */ jsx("circle", {
				cx: "15",
				cy: "12",
				r: "3"
			})
		] }),
		ext: /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("rect", {
			x: "3",
			y: "5",
			width: "18",
			height: "14",
			rx: "2"
		}), /* @__PURE__ */ jsx("path", { d: "M3 9h18" })] }),
		grid: /* @__PURE__ */ jsxs(Fragment, { children: [
			/* @__PURE__ */ jsx("circle", {
				cx: "7",
				cy: "7",
				r: "2.4"
			}),
			/* @__PURE__ */ jsx("circle", {
				cx: "17",
				cy: "7",
				r: "2.4"
			}),
			/* @__PURE__ */ jsx("circle", {
				cx: "7",
				cy: "17",
				r: "2.4"
			}),
			/* @__PURE__ */ jsx("circle", {
				cx: "17",
				cy: "17",
				r: "2.4"
			})
		] }),
		star: /* @__PURE__ */ jsx("path", { d: "M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3 5.8 20.9l1.6-6.8L2.2 8.9l6.9-.6z" }),
		menu: /* @__PURE__ */ jsx("path", { d: "M4 7h16M4 12h16M4 17h16" }),
		spark: /* @__PURE__ */ jsx("path", { d: "M12 3 21 12 12 21 3 12z" }),
		x: /* @__PURE__ */ jsx("path", { d: "M6 6l12 12M18 6 6 18" }),
		bag: /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("path", { d: "M6 8h12l-1 12H7L6 8Z" }), /* @__PURE__ */ jsx("path", { d: "M9 8a3 3 0 0 1 6 0" })] })
	};
	return /* @__PURE__ */ jsx("svg", {
		...common,
		children: paths[name]
	});
}
//#endregion
//#region src/components/layout.tsx
function Shell({ children, categories = [], cartCount = 0, onSearchToggle }) {
	const [open, setOpen] = useState(false);
	useRouter();
	const close = () => setOpen(false);
	return /* @__PURE__ */ jsxs("div", {
		className: "app",
		children: [
			/* @__PURE__ */ jsxs("aside", {
				className: `sidebar ${open ? "open" : ""}`,
				"aria-label": "Marketplace navigation",
				children: [
					/* @__PURE__ */ jsxs(Link, {
						to: "/",
						className: "logo",
						onClick: close,
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "bolt",
								children: /* @__PURE__ */ jsx(BoltIcon, {})
							}),
							/* @__PURE__ */ jsx("b", { children: "POWERPROMPT" }),
							/* @__PURE__ */ jsx("span", { children: "Gallery" })
						]
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "navi active",
						to: "/",
						onClick: close,
						children: [/* @__PURE__ */ jsx(Icon, { name: "home" }), " Home"]
					}),
					/* @__PURE__ */ jsxs("button", {
						className: "navi",
						onClick: () => {
							onSearchToggle?.();
							close();
						},
						children: [/* @__PURE__ */ jsx(Icon, { name: "search" }), " Search"]
					}),
					/* @__PURE__ */ jsxs("button", {
						className: "navi",
						onClick: () => close(),
						children: [/* @__PURE__ */ jsx(Icon, { name: "clock" }), " History"]
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "navi",
						to: "/",
						search: { favorites: true },
						onClick: close,
						children: [
							/* @__PURE__ */ jsx(Icon, { name: "heart" }),
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
					categories.map((category) => /* @__PURE__ */ jsxs(Link, {
						to: "/",
						search: { category: category.id },
						className: "cat",
						onClick: close,
						children: [/* @__PURE__ */ jsx("span", { className: "dot" }), category.label]
					}, category.id)),
					/* @__PURE__ */ jsx("div", {
						className: "side-label",
						children: "More from us"
					}),
					/* @__PURE__ */ jsxs("button", {
						className: "navi",
						children: [/* @__PURE__ */ jsx(Icon, { name: "ext" }), " Browser extension"]
					}),
					/* @__PURE__ */ jsxs("button", {
						className: "navi",
						children: [/* @__PURE__ */ jsx(Icon, { name: "figma" }), " Figma plugin"]
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "navi",
						to: "/admin",
						children: [/* @__PURE__ */ jsx(Icon, { name: "api" }), " Public API"]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "side-foot",
						children: [
							/* @__PURE__ */ jsxs("div", {
								className: "promo-card",
								children: [
									/* @__PURE__ */ jsx(Icon, { name: "bag" }),
									/* @__PURE__ */ jsx("h4", { children: "Sell your prompts" }),
									/* @__PURE__ */ jsx("p", { children: "Keep 85% of every sale — paid weekly." })
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
									search: { free: true },
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
										children: [/* @__PURE__ */ jsx(Icon, { name: "star" }), " 4.8"]
									})
								]
							})
						]
					})
				]
			}),
			/* @__PURE__ */ jsx("div", {
				className: `scrim ${open ? "show" : ""}`,
				onClick: close
			}),
			/* @__PURE__ */ jsxs("main", {
				className: "main",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "mtop",
					children: [
						/* @__PURE__ */ jsx("button", {
							className: "burger",
							"aria-label": "Menu",
							onClick: () => setOpen(true),
							children: /* @__PURE__ */ jsx(Icon, { name: "menu" })
						}),
						/* @__PURE__ */ jsx("span", {
							className: "bolt",
							children: /* @__PURE__ */ jsx(BoltIcon, {})
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
						className: "active",
						"aria-label": "Home",
						children: /* @__PURE__ */ jsx(Icon, { name: "home" })
					}),
					/* @__PURE__ */ jsx(Link, {
						to: "/",
						search: { favorites: true },
						"aria-label": "Favorites",
						children: /* @__PURE__ */ jsx(Icon, { name: "heart" })
					}),
					/* @__PURE__ */ jsx("button", {
						"aria-label": "History",
						children: /* @__PURE__ */ jsx(Icon, { name: "clock" })
					}),
					/* @__PURE__ */ jsx(Link, {
						to: "/admin",
						"aria-label": "Creator analytics",
						children: /* @__PURE__ */ jsx(Icon, { name: "spark" })
					}),
					/* @__PURE__ */ jsxs(Link, {
						to: "/cart",
						"aria-label": "Cart",
						children: [/* @__PURE__ */ jsx(Icon, { name: "cart" }), cartCount > 0 && /* @__PURE__ */ jsx("span", {
							className: "cbadge",
							children: cartCount
						})]
					})
				]
			})
		]
	});
}
function Toast({ message }) {
	return /* @__PURE__ */ jsxs("div", {
		className: `toast ${message ? "show" : ""}`,
		role: "status",
		children: [/* @__PURE__ */ jsx("span", { className: "d" }), message || "Ready"]
	});
}
//#endregion
export { Toast as n, Icon as r, Shell as t };
