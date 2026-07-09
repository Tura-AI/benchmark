import { l as toggleFavoriteFn, o as getMarketplace, t as addToCartFn } from "./market-CFU9gbvr.js";
import { t as Route } from "./routes-CLcI4xyQ.js";
import { t as Icons } from "./icons-DqNOm4Um.js";
import { t as Toast } from "./Toast-B3itatf9.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region src/components/Dock.tsx
function Dock({ cartCount, onFavorites, onSearch }) {
	return /* @__PURE__ */ jsxs("nav", {
		className: "dock",
		"aria-label": "Quick actions",
		children: [
			/* @__PURE__ */ jsx(Link, {
				to: "/",
				className: "dock-btn active",
				"aria-label": "Home",
				children: /* @__PURE__ */ jsx(Icons.Home, {})
			}),
			/* @__PURE__ */ jsx("button", {
				className: "dock-btn",
				"aria-label": "Search",
				onClick: onSearch,
				children: /* @__PURE__ */ jsx(Icons.Search, {})
			}),
			/* @__PURE__ */ jsx("button", {
				className: "dock-btn",
				"aria-label": "Favorites",
				onClick: onFavorites,
				children: /* @__PURE__ */ jsx(Icons.Heart, {})
			}),
			/* @__PURE__ */ jsx(Link, {
				to: "/creator",
				className: "dock-btn",
				"aria-label": "Analytics",
				children: /* @__PURE__ */ jsx(Icons.BarChart3, {})
			}),
			/* @__PURE__ */ jsxs(Link, {
				to: "/cart",
				className: "dock-btn",
				"aria-label": "Cart",
				children: [/* @__PURE__ */ jsx(Icons.ShoppingBag, {}), /* @__PURE__ */ jsx("span", {
					className: `cbadge ${cartCount ? "show" : ""}`,
					children: cartCount
				})]
			}),
			/* @__PURE__ */ jsx("button", {
				className: "dock-btn",
				"aria-label": "Generate",
				children: /* @__PURE__ */ jsx(Icons.Wand2, {})
			})
		]
	});
}
//#endregion
//#region src/components/Lightbox.tsx
var compact = new Intl.NumberFormat("en", { notation: "compact" });
function Lightbox({ prompt, onClose, onCart }) {
	return /* @__PURE__ */ jsx("div", {
		className: `lb ${prompt ? "open" : ""}`,
		onMouseDown: (e) => e.target === e.currentTarget && onClose(),
		children: prompt ? /* @__PURE__ */ jsxs("div", {
			className: "lb-card",
			children: [
				/* @__PURE__ */ jsx("button", {
					className: "lb-close",
					"aria-label": "Close preview",
					onClick: onClose,
					children: /* @__PURE__ */ jsx(Icons.X, {})
				}),
				/* @__PURE__ */ jsx("div", {
					className: "lb-img",
					children: /* @__PURE__ */ jsx("img", {
						src: prompt.image,
						alt: prompt.title
					})
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "lb-info",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "model",
							children: [
								/* @__PURE__ */ jsx("span", { className: "d" }),
								prompt.model,
								" · ",
								prompt.category
							]
						}),
						/* @__PURE__ */ jsx("h2", { children: prompt.title }),
						/* @__PURE__ */ jsx("p", {
							className: "desc",
							children: prompt.description
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "stats",
							children: [
								/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
									className: "k",
									children: "Rating"
								}), /* @__PURE__ */ jsxs("div", {
									className: "v",
									children: ["★ ", prompt.rating]
								})] }),
								/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
									className: "k",
									children: "Sold"
								}), /* @__PURE__ */ jsx("div", {
									className: "v",
									children: compact.format(prompt.sold)
								})] }),
								/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
									className: "k",
									children: "Seller"
								}), /* @__PURE__ */ jsx("div", {
									className: "v",
									children: prompt.creator
								})] })
							]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "lb-buy",
							children: [
								/* @__PURE__ */ jsx("span", {
									className: `price ${prompt.price === 0 ? "free" : ""}`,
									children: prompt.price === 0 ? "Free" : `$${prompt.price}`
								}),
								/* @__PURE__ */ jsxs("button", {
									className: "add",
									onClick: () => {
										onCart(prompt);
										onClose();
									},
									children: [
										prompt.price === 0 ? "Get it free" : "Add to cart",
										" ",
										/* @__PURE__ */ jsx(Icons.ChevronRight, {})
									]
								}),
								/* @__PURE__ */ jsx(Link, {
									to: "/prompts/$promptId",
									params: { promptId: String(prompt.id) },
									className: "ghost-link",
									children: "Details"
								})
							]
						})
					]
				})
			]
		}) : null
	});
}
//#endregion
//#region src/components/MobileTop.tsx
function MobileTop({ onMenu }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "mtop",
		children: [/* @__PURE__ */ jsx("button", {
			className: "burger",
			"aria-label": "Menu",
			onClick: onMenu,
			children: /* @__PURE__ */ jsx(Icons.Menu, {})
		}), /* @__PURE__ */ jsxs(Link, {
			to: "/",
			className: "mobile-brand",
			children: [/* @__PURE__ */ jsx("span", {
				className: "bolt",
				children: /* @__PURE__ */ jsx(Icons.Zap, { fill: "currentColor" })
			}), /* @__PURE__ */ jsx("b", { children: "POWERPROMPT" })]
		})]
	});
}
//#endregion
//#region src/components/PromptTile.tsx
var fmt = new Intl.NumberFormat("en", { notation: "compact" });
function PromptTile({ prompt, onPreview, onFavorite, onCart }) {
	return /* @__PURE__ */ jsxs("article", {
		className: `tile ${prompt.isFavorite ? "saved" : ""}`,
		style: { "--ar": prompt.aspect },
		children: [
			/* @__PURE__ */ jsx("button", {
				className: "tile-hit",
				"aria-label": `Preview ${prompt.title}`,
				onClick: () => onPreview(prompt)
			}),
			/* @__PURE__ */ jsx("div", {
				className: "savedmark",
				children: /* @__PURE__ */ jsx(Icons.Bookmark, { fill: "currentColor" })
			}),
			/* @__PURE__ */ jsx("div", {
				className: "media",
				children: /* @__PURE__ */ jsx("img", {
					src: prompt.image,
					alt: prompt.title,
					loading: "lazy"
				})
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "ov",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "ov-top",
					children: [/* @__PURE__ */ jsx("span", {
						className: "model",
						children: prompt.model
					}), /* @__PURE__ */ jsx("button", {
						className: `bm ${prompt.isFavorite ? "on" : ""}`,
						"aria-label": `Save ${prompt.title}`,
						onClick: () => onFavorite(prompt),
						children: /* @__PURE__ */ jsx(Icons.Bookmark, { fill: prompt.isFavorite ? "currentColor" : "none" })
					})]
				}), /* @__PURE__ */ jsxs("div", { children: [
					/* @__PURE__ */ jsx("h3", { children: prompt.title }),
					/* @__PURE__ */ jsxs("div", {
						className: "mini-meta",
						children: [/* @__PURE__ */ jsx("span", { children: prompt.creator }), /* @__PURE__ */ jsxs("span", { children: [fmt.format(prompt.sold), " sold"] })]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "ov-row",
						children: [/* @__PURE__ */ jsx("span", {
							className: `price ${prompt.price === 0 ? "free" : ""}`,
							children: prompt.price === 0 ? "Free" : `$${prompt.price}`
						}), /* @__PURE__ */ jsxs("button", {
							className: "add",
							onClick: () => onCart(prompt),
							children: ["Add ", /* @__PURE__ */ jsx(Icons.ChevronRight, {})]
						})]
					}),
					/* @__PURE__ */ jsx(Link, {
						className: "detail-link",
						to: "/prompts/$promptId",
						params: { promptId: String(prompt.id) },
						children: "View detail"
					})
				] })]
			})
		]
	});
}
//#endregion
//#region src/components/Sidebar.tsx
function Sidebar({ categories, activeCategory, favoritesCount, isOpen, onClose, onCategory, onFavorites, onSearch, onFree }) {
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs("aside", {
		className: `sidebar ${isOpen ? "open" : ""}`,
		"aria-label": "Sidebar",
		children: [
			/* @__PURE__ */ jsxs(Link, {
				to: "/",
				className: "logo",
				onClick: onClose,
				children: [
					/* @__PURE__ */ jsx("span", {
						className: "bolt",
						children: /* @__PURE__ */ jsx(Icons.Zap, { fill: "currentColor" })
					}),
					/* @__PURE__ */ jsx("b", { children: "POWERPROMPT" }),
					/* @__PURE__ */ jsx("span", { children: "Gallery" })
				]
			}),
			/* @__PURE__ */ jsxs(Link, {
				to: "/",
				className: "navi active",
				onClick: onClose,
				children: [/* @__PURE__ */ jsx(Icons.Home, {}), " Home"]
			}),
			/* @__PURE__ */ jsxs("button", {
				className: "navi",
				onClick: onSearch,
				children: [/* @__PURE__ */ jsx(Icons.Search, {}), " Search"]
			}),
			/* @__PURE__ */ jsxs("button", {
				className: "navi",
				onClick: () => void 0,
				children: [/* @__PURE__ */ jsx(Icons.Clock3, {}), " History"]
			}),
			/* @__PURE__ */ jsxs("button", {
				className: "navi",
				onClick: onFavorites,
				children: [
					/* @__PURE__ */ jsx(Icons.Heart, {}),
					" Favorites ",
					/* @__PURE__ */ jsx("span", {
						className: "new",
						children: favoritesCount
					})
				]
			}),
			/* @__PURE__ */ jsx("div", {
				className: "side-label",
				children: "Categories"
			}),
			/* @__PURE__ */ jsx("div", {
				className: "cat-list",
				children: categories.map((item) => /* @__PURE__ */ jsxs("button", {
					className: `cat ${activeCategory === item.category ? "active" : ""}`,
					onClick: () => onCategory(item.category),
					children: [
						/* @__PURE__ */ jsx("span", { className: "dot" }),
						/* @__PURE__ */ jsx("span", { children: item.category }),
						/* @__PURE__ */ jsx("span", {
							className: "cat-count",
							children: item.count
						})
					]
				}, item.category))
			}),
			/* @__PURE__ */ jsx("div", {
				className: "side-label",
				children: "More from us"
			}),
			/* @__PURE__ */ jsxs(Link, {
				to: "/creator",
				className: "navi",
				onClick: onClose,
				children: [/* @__PURE__ */ jsx(Icons.BarChart3, {}), " Creator analytics"]
			}),
			/* @__PURE__ */ jsxs("button", {
				className: "navi",
				onClick: () => void 0,
				children: [/* @__PURE__ */ jsx(Icons.Code2, {}), " Public API"]
			}),
			/* @__PURE__ */ jsxs("button", {
				className: "navi",
				onClick: () => void 0,
				children: [/* @__PURE__ */ jsx(Icons.Boxes, {}), " Figma plugin"]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "side-foot",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "promo-card",
						children: [
							/* @__PURE__ */ jsx(Icons.Sparkles, { className: "gift" }),
							/* @__PURE__ */ jsx("h4", { children: "Sell your prompts" }),
							/* @__PURE__ */ jsx("p", { children: "Keep 85% of every sale, paid weekly." })
						]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "side-cta",
						children: [/* @__PURE__ */ jsx(Link, {
							to: "/creator",
							className: "btn-ink",
							onClick: onClose,
							children: "Get started"
						}), /* @__PURE__ */ jsx("button", {
							className: "free",
							onClick: onFree,
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
								children: [/* @__PURE__ */ jsx(Icons.Star, { fill: "currentColor" }), " 4.8"]
							})
						]
					})
				]
			})
		]
	}), /* @__PURE__ */ jsx("button", {
		className: `scrim ${isOpen ? "show" : ""}`,
		"aria-label": "Close navigation",
		onClick: onClose
	})] });
}
//#endregion
//#region src/components/TopFilters.tsx
var models = [
	"All",
	"GPT-4o",
	"Claude",
	"Midjourney",
	"Flux"
];
var sorts = [
	"Featured",
	"Newest",
	"Popular"
];
function TopFilters({ model, sort, query, searchOpen, onModel, onSort, onQuery }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "topbar",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "filterbar",
			children: [/* @__PURE__ */ jsx("div", {
				className: "ftabs",
				"aria-label": "Model filters",
				children: models.map((item) => /* @__PURE__ */ jsxs("button", {
					className: `ftab ${model === item ? "active" : ""}`,
					onClick: () => onModel(item),
					children: [item === "All" ? /* @__PURE__ */ jsx(Icons.Grid2X2, {}) : /* @__PURE__ */ jsx(Icons.Sparkles, {}), item]
				}, item))
			}), /* @__PURE__ */ jsx("div", {
				className: "fsort",
				"aria-label": "Sort controls",
				children: sorts.map((item) => /* @__PURE__ */ jsx("button", {
					className: `sortbtn ${sort === item.toLowerCase() ? "active" : ""}`,
					onClick: () => onSort(item.toLowerCase()),
					children: item
				}, item))
			})]
		}), /* @__PURE__ */ jsx("div", {
			className: `searchbar ${searchOpen ? "open" : ""}`,
			children: /* @__PURE__ */ jsxs("div", {
				className: "inner",
				children: [/* @__PURE__ */ jsx(Icons.Search, {}), /* @__PURE__ */ jsx("input", {
					"aria-label": "Search prompts",
					value: query,
					onChange: (event) => onQuery(event.target.value),
					placeholder: "Search prompts: \"portrait\", \"poster\", \"cold email\"..."
				})]
			})
		})]
	});
}
//#endregion
//#region src/routes/index.tsx?tsr-split=component
function Storefront() {
	const initial = Route.useLoaderData();
	const [prompts, setPrompts] = useState(initial.prompts);
	const [filters, setFilters] = useState(initial.filters);
	const [model, setModel] = useState("All");
	const [category, setCategory] = useState("All");
	const [sort, setSort] = useState("featured");
	const [query, setQuery] = useState("");
	const [favoritesOnly, setFavoritesOnly] = useState(false);
	const [freeOnly, setFreeOnly] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [drawer, setDrawer] = useState(false);
	const [preview, setPreview] = useState(null);
	const [toast, setToast] = useState(null);
	const [cartCount, setCartCount] = useState(filters.counts.cart);
	const showToast = useCallback((text) => setToast({ text }), []);
	useEffect(() => {
		let cancelled = false;
		const timer = window.setTimeout(async () => {
			const next = await getMarketplace({ data: {
				model,
				category,
				sort,
				query,
				favoritesOnly,
				freeOnly
			} });
			if (!cancelled) {
				setPrompts(next.prompts);
				setFilters(next.filters);
				setCartCount(next.filters.counts.cart);
			}
		}, 120);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [
		category,
		favoritesOnly,
		freeOnly,
		model,
		query,
		sort
	]);
	const columns = useMemo(() => {
		const buckets = [
			[],
			[],
			[],
			[]
		];
		prompts.forEach((prompt, index) => buckets[index % buckets.length].push(prompt));
		return buckets;
	}, [prompts]);
	async function onFavorite(prompt) {
		const result = await toggleFavoriteFn({ data: { promptId: prompt.id } });
		setPrompts((items) => items.map((item) => item.id === prompt.id ? {
			...item,
			isFavorite: result.isFavorite ? 1 : 0
		} : item));
		showToast(result.isFavorite ? "Saved to Favorites" : "Removed from Favorites");
	}
	async function onCart(prompt) {
		const cart = await addToCartFn({ data: { promptId: prompt.id } });
		setCartCount(cart.items.reduce((sum, item) => sum + item.quantity, 0));
		showToast(`Added: ${prompt.title}`);
	}
	function resetHome() {
		setModel("All");
		setCategory("All");
		setQuery("");
		setFavoritesOnly(false);
		setFreeOnly(false);
	}
	return /* @__PURE__ */ jsxs(Fragment, { children: [
		/* @__PURE__ */ jsx(Sidebar, {
			categories: filters.categories,
			activeCategory: category,
			favoritesCount: filters.counts.favorites,
			isOpen: drawer,
			onClose: () => setDrawer(false),
			onSearch: () => {
				setSearchOpen((value) => !value);
				setDrawer(false);
			},
			onFavorites: () => {
				resetHome();
				setFavoritesOnly(true);
				setDrawer(false);
			},
			onFree: () => {
				resetHome();
				setFreeOnly(true);
				setDrawer(false);
				showToast("Showing free prompts");
			},
			onCategory: (next) => {
				setCategory(next);
				setFavoritesOnly(false);
				setFreeOnly(false);
				setDrawer(false);
			}
		}),
		/* @__PURE__ */ jsxs("main", {
			className: "main",
			children: [
				/* @__PURE__ */ jsx(MobileTop, { onMenu: () => setDrawer(true) }),
				/* @__PURE__ */ jsx(TopFilters, {
					model,
					sort,
					query,
					searchOpen,
					onModel: (next) => {
						setModel(next);
						setFavoritesOnly(false);
					},
					onSort: setSort,
					onQuery: setQuery
				}),
				/* @__PURE__ */ jsxs("section", {
					className: "gallery",
					"aria-label": "Prompt marketplace",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "gallery-head",
						children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
							className: "mono kicker",
							children: "Featured prompt systems"
						}), /* @__PURE__ */ jsx("h1", { children: "POWERPROMPT Gallery" })] }), /* @__PURE__ */ jsxs("div", {
							className: "market-stats",
							children: [
								/* @__PURE__ */ jsxs("span", { children: [filters.counts.featured, " Featured"] }),
								/* @__PURE__ */ jsxs("span", { children: [filters.counts.free, " Free"] }),
								/* @__PURE__ */ jsxs("span", { children: [filters.counts.paid, " Paid"] })
							]
						})]
					}), prompts.length ? /* @__PURE__ */ jsx("div", {
						className: "masonry",
						children: columns.map((column, index) => /* @__PURE__ */ jsx("div", {
							className: "ms-col",
							children: column.map((prompt) => /* @__PURE__ */ jsx(PromptTile, {
								prompt,
								onPreview: setPreview,
								onFavorite,
								onCart
							}, prompt.id))
						}, index))
					}) : /* @__PURE__ */ jsxs("div", {
						className: "empty",
						children: [/* @__PURE__ */ jsx("div", {
							className: "big",
							children: "Nothing here yet"
						}), /* @__PURE__ */ jsx("p", { children: "Try a different model, category, or search." })]
					})]
				})
			]
		}),
		/* @__PURE__ */ jsx(Dock, {
			cartCount,
			onSearch: () => setSearchOpen((value) => !value),
			onFavorites: () => {
				resetHome();
				setFavoritesOnly(true);
			}
		}),
		/* @__PURE__ */ jsx(Lightbox, {
			prompt: preview,
			onClose: () => setPreview(null),
			onCart
		}),
		/* @__PURE__ */ jsx(Toast, {
			toast,
			onDone: () => setToast(null)
		})
	] });
}
//#endregion
export { Storefront as component };
