import { i as __toESM } from "../_runtime.mjs";
import { L as require_react, _ as useRouter, g as useNavigate, h as Link, v as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as saveFavorite, t as addPromptToCart } from "./server-Cp9Zv1gM.mjs";
import { t as FormatMoney } from "./FormatMoney-Bn-zIFbQ.mjs";
import { t as Route } from "./routes-CIoeulzr.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-DAVpCuqn.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function BoltIcon() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", {
		viewBox: "0 0 24 24",
		fill: "currentColor",
		"aria-hidden": "true",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M13 2 4.5 13.5H11l-1 8.5L19.5 10H13V2Z" })
	});
}
function Icon({ name }) {
	const common = {
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.8,
		strokeLinecap: "round",
		strokeLinejoin: "round",
		"aria-hidden": true
	};
	const paths = {
		home: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3 11.5 12 4l9 7.5" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5 10v10h14V10" })] }),
		search: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
			cx: "11",
			cy: "11",
			r: "7"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m20 20-3.5-3.5" })] }),
		history: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
			cx: "12",
			cy: "12",
			r: "9"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 7v5l3 2" })] }),
		heart: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 20s-7-4.4-9.2-8.3C1.1 8.5 2.6 5 6 5c2 0 3.2 1.2 4 2.3C10.8 6.2 12 5 14 5c3.4 0 4.9 3.5 3.2 6.7C19 15.6 12 20 12 20Z" }),
		cart: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6 7h13l-1.2 9.5a2 2 0 0 1-2 1.75H9.2a2 2 0 0 1-2-1.75L6 7Z" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M9 7a3 3 0 0 1 6 0" })] }),
		grid: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
				cx: "7",
				cy: "7",
				r: "2.4"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
				cx: "17",
				cy: "7",
				r: "2.4"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
				cx: "7",
				cy: "17",
				r: "2.4"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
				cx: "17",
				cy: "17",
				r: "2.4"
			})
		] }),
		code: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m8 16-4-4 4-4" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m16 8 4 4-4 4" })] }),
		spark: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 3 21 12 12 21 3 12z" }),
		book: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22V5.5Z" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20" })] }),
		menu: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 7h16" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 12h16" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 17h16" })
		] }),
		x: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6 6l12 12" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M18 6 6 18" })] })
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", {
		...common,
		children: paths[name]
	});
}
function BookmarkIcon({ filled = false }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", {
		viewBox: "0 0 24 24",
		fill: filled ? "currentColor" : "none",
		stroke: "currentColor",
		strokeWidth: "1.8",
		"aria-hidden": "true",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6 4h12v17l-6-4-6 4V4Z" })
	});
}
var models = [
	"all",
	"GPT-4o",
	"Claude",
	"Midjourney",
	"Flux"
];
var sorts = [
	"featured",
	"newest",
	"popular"
];
function MarketplaceApp({ data }) {
	const router = useRouter();
	const navigate = useNavigate({ from: "/" });
	const [searchOpen, setSearchOpen] = import_react.useState(Boolean(data.active.q));
	const [query, setQuery] = import_react.useState(data.active.q);
	const [drawerOpen, setDrawerOpen] = import_react.useState(false);
	const [toast, setToast] = import_react.useState("");
	const [lightbox, setLightbox] = import_react.useState(null);
	const [hydrated, setHydrated] = import_react.useState(false);
	import_react.useEffect(() => setHydrated(true), []);
	import_react.useEffect(() => {
		if (!toast) return;
		const id = window.setTimeout(() => setToast(""), 2100);
		return () => window.clearTimeout(id);
	}, [toast]);
	function setSearch(next) {
		navigate({ search: (old) => ({
			...old,
			...next,
			model: next.model ?? old.model ?? "all",
			category: next.category ?? old.category ?? "all",
			sort: next.sort ?? old.sort ?? "featured"
		}) });
	}
	async function favorite(prompt) {
		await saveFavorite({ data: { promptId: prompt.id } });
		setToast(prompt.isFavorite ? "Removed from Favorites" : "Saved to Favorites");
		await router.invalidate();
	}
	async function add(prompt) {
		await addPromptToCart({ data: { promptId: prompt.id } });
		setToast(`${prompt.price === 0 ? "Claimed" : "Added"} - ${prompt.title}`);
		await router.invalidate();
	}
	const visiblePrompts = import_react.useMemo(() => {
		const term = query.trim().toLowerCase();
		if (!term) return data.prompts;
		return data.prompts.filter((prompt) => `${prompt.title} ${prompt.model} ${prompt.category} ${prompt.description} ${prompt.creator}`.toLowerCase().includes(term));
	}, [data.prompts, query]);
	const sidebarProps = {
		data,
		searchOpen,
		onSearch: () => setSearchOpen((value) => !value),
		onHome: () => {
			setQuery("");
			setSearch({
				model: "all",
				category: "all",
				q: "",
				favorites: false,
				free: false
			});
		},
		onFavorites: () => setSearch({
			model: "all",
			category: "all",
			favorites: true
		}),
		onCategory: (category) => setSearch({
			category,
			favorites: false
		}),
		onFree: () => {
			setSearch({
				free: true,
				favorites: false
			});
			setToast("Showing free + featured prompts");
		},
		onClose: () => setDrawerOpen(false)
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "app-shell",
			"data-hydrated": hydrated ? "true" : "false",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Sidebar, { ...sidebarProps }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: drawerOpen ? "scrim show" : "scrim",
					onClick: () => setDrawerOpen(false)
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
					className: "main",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mtop",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: "burger",
									"aria-label": "Menu",
									onClick: () => setDrawerOpen(true),
									onPointerUp: () => setDrawerOpen(true),
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "menu" })
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "bolt mini",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BoltIcon, {})
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "POWERPROMPT" })
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Topbar, {
							data,
							query,
							searchOpen,
							setSearchOpen,
							setSearch,
							setQuery
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
							className: "gallery",
							"aria-label": "Prompt marketplace gallery",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "masonry",
								children: visiblePrompts.length ? visiblePrompts.map((prompt) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PromptTile, {
									prompt,
									onFavorite: favorite,
									onAdd: add,
									onPreview: setLightbox
								}, prompt.id)) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "empty",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "big",
										children: "Nothing here yet"
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: "Try a different filter or search." })]
								})
							})
						})
					]
				})
			]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Dock, {
			cartCount: data.counts.cart,
			favorites: data.active.favorites,
			onHome: () => setSearch({
				favorites: false,
				model: "all",
				category: "all"
			}),
			onFavorites: () => setSearch({
				favorites: true,
				model: "all",
				category: "all"
			})
		}),
		lightbox ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Lightbox, {
			prompt: lightbox,
			onClose: () => setLightbox(null),
			onAdd: add
		}) : null,
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: toast ? "toast show" : "toast",
			role: "status",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "d" }), toast]
		}),
		drawerOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MobileDrawer, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Sidebar, { ...sidebarProps }) }) : null
	] });
}
function Sidebar(props) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
		className: "sidebar",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "logo",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "bolt",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BoltIcon, {})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "POWERPROMPT" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Gallery" })
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				className: "navi active",
				onClick: () => {
					props.onHome();
					props.onClose();
				},
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "home" }), " Home"]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				className: props.searchOpen ? "navi active" : "navi",
				onClick: props.onSearch,
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "search" }), " Search"]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				className: "navi",
				onClick: () => props.onClose(),
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "history" }), " History"]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				className: props.data.active.favorites ? "navi active" : "navi",
				onClick: () => {
					props.onFavorites();
					props.onClose();
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "heart" }),
					" Favorites ",
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "new",
						children: "NEW"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "side-label",
				children: "Categories"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				className: props.data.active.category === "all" ? "cat active" : "cat",
				onClick: () => props.onCategory("all"),
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dot" }), "All prompts"]
			}),
			props.data.categories.map((cat) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				className: props.data.active.category === cat.name ? "cat active" : "cat",
				onClick: () => {
					props.onCategory(cat.name);
					props.onClose();
				},
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dot" }), cat.name]
			}, cat.id)),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "side-label",
				children: "More from us"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
				className: "navi",
				to: "/admin/analytics",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "spark" }), " Creator analytics"]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
				className: "navi",
				to: "/cart",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "cart" }), " Cart"]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "side-foot",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "promo-card",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: "Save 30% with prompt bundles" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Curated systems for teams shipping faster." })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "side-cta",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "btn-ink",
							onClick: () => props.onClose(),
							children: "Get started"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "free",
							onClick: props.onFree,
							children: "Free prompts"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "side-legal",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
								href: "/admin/analytics",
								children: "Revenue"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Terms" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "stars",
								children: "4.8"
							})
						]
					})
				]
			})
		]
	});
}
function Topbar({ data, query, searchOpen, setSearchOpen, setSearch, setQuery }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "topbar",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "filterbar",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "ftabs",
					"aria-label": "Model filters",
					children: models.map((model) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						className: data.active.model === model ? "ftab active" : "ftab",
						onClick: () => setSearch({ model }),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: model === "all" ? "grid" : model === "Claude" ? "spark" : model === "GPT-4o" ? "book" : "code" }), model === "all" ? "All" : model]
					}, model))
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "fsort",
					"aria-label": "Sort controls",
					children: sorts.map((sort) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: data.active.sort === sort ? "sortbtn active" : "sortbtn",
						onClick: () => setSearch({ sort }),
						children: sort[0].toUpperCase() + sort.slice(1)
					}, sort))
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "search-toggle",
					"aria-label": "Reveal search",
					onClick: () => setSearchOpen(!searchOpen),
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "search" })
				})
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: searchOpen ? "searchbar open" : "searchbar",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "inner",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "search" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					value: query,
					onChange: (event) => setQuery(event.currentTarget.value),
					placeholder: "Search prompts - portrait, poster, cold email..."
				})]
			})
		})]
	});
}
function PromptTile({ prompt, onFavorite, onAdd, onPreview }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
		className: prompt.isFavorite ? "tile saved" : "tile",
		style: { aspectRatio: prompt.aspect },
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				className: "tile-hit",
				"aria-label": `Open ${prompt.title}`,
				onClick: () => onPreview(prompt),
				onPointerUp: () => onPreview(prompt)
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "savedmark",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BookmarkIcon, { filled: true })
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "media",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
					src: prompt.image,
					alt: prompt.title,
					loading: "lazy"
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "ov",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "ov__top",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "model",
						children: prompt.model
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: prompt.isFavorite ? "bm on" : "bm",
						"aria-label": "Save",
						onClick: (event) => {
							event.stopPropagation();
							onFavorite(prompt);
						},
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BookmarkIcon, { filled: prompt.isFavorite })
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: prompt.title }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "ov__row",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: prompt.price === 0 ? "price free" : "price",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormatMoney, { value: prompt.price })
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "add",
						onClick: (event) => {
							event.stopPropagation();
							onAdd(prompt);
						},
						children: prompt.price === 0 ? "Get" : "Add"
					})]
				})] })]
			})
		]
	});
}
function Dock({ cartCount, favorites, onHome, onFavorites }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", {
		className: "dock",
		"aria-label": "Mobile actions",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				className: !favorites ? "active" : "",
				onClick: onHome,
				"aria-label": "Home",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "home" })
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				onClick: onFavorites,
				className: favorites ? "active" : "",
				"aria-label": "Favorites",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "heart" })
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: "/admin/analytics",
				"aria-label": "Analytics",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "spark" })
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
				to: "/cart",
				"aria-label": "Cart",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "cart" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: cartCount ? "cbadge show" : "cbadge",
					children: cartCount
				})]
			})
		]
	});
}
function Lightbox({ prompt, onClose, onAdd }) {
	import_react.useEffect(() => {
		const close = (event) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", close);
		return () => window.removeEventListener("keydown", close);
	}, [onClose]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "lb open",
		role: "dialog",
		"aria-modal": "true",
		onClick: onClose,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "lb__card",
			onClick: (event) => event.stopPropagation(),
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "lb__close",
					"aria-label": "Close",
					onClick: onClose,
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "x" })
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "lb__img",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
						src: prompt.image,
						alt: prompt.title
					})
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "lb__info",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "model",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "d" }),
								prompt.model,
								" / ",
								prompt.category
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: prompt.title }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "desc",
							children: prompt.description
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "stats",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "k",
									children: "Rating"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "v",
									children: prompt.rating.toFixed(1)
								})] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "k",
									children: "Sold"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "v",
									children: prompt.sold.toLocaleString()
								})] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "k",
									children: "Seller"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "v",
									children: prompt.creator
								})] })
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "lb__buy",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: prompt.price === 0 ? "price free" : "price",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormatMoney, { value: prompt.price })
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: "add",
									onClick: () => onAdd(prompt),
									children: prompt.price === 0 ? "Get it free" : "Add to cart"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
									to: "/prompts/$promptId",
									params: { promptId: String(prompt.id) },
									children: "Detail"
								})
							]
						})
					]
				})
			]
		})
	});
}
function MobileDrawer({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "mobile-drawer open",
		children
	});
}
function Storefront() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MarketplaceApp, { data: Route.useLoaderData() });
}
//#endregion
export { Storefront as component };
