import { c as toggleFavoriteFn, n as checkoutFn, s as removeFromCartFn, t as addToCartFn } from "./functions-BtzvV4sV.js";
import { useState, useTransition } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/components.tsx
function money(cents) {
	return cents === 0 ? "Free" : new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD"
	}).format(cents / 100);
}
function Shell({ children, counts }) {
	const [open, setOpen] = useState(false);
	return /* @__PURE__ */ jsxs("div", {
		className: "app",
		children: [
			/* @__PURE__ */ jsx("button", {
				className: "burger",
				type: "button",
				onClick: () => setOpen(true),
				"aria-label": "Open navigation",
				children: "Menu"
			}),
			/* @__PURE__ */ jsxs("aside", {
				className: `sidebar ${open ? "open" : ""}`,
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "brand",
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "bolt",
								children: "P"
							}),
							/* @__PURE__ */ jsx("b", { children: "POWER" }),
							/* @__PURE__ */ jsx("em", { children: "PROMPT" })
						]
					}),
					/* @__PURE__ */ jsx(Link, {
						className: "navitem",
						to: "/",
						children: "Explore"
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "navitem",
						to: "/",
						search: {
							favorites: true,
							sort: "Featured"
						},
						children: ["Favorites ", /* @__PURE__ */ jsx("small", { children: counts?.favorites ?? 0 })]
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "navitem",
						to: "/cart",
						children: ["Cart ", /* @__PURE__ */ jsx("small", { children: counts?.cart ?? 0 })]
					}),
					/* @__PURE__ */ jsx(Link, {
						className: "navitem",
						to: "/admin",
						children: "Creator analytics"
					}),
					/* @__PURE__ */ jsx("div", {
						className: "side-label",
						children: "Categories"
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "cat",
						to: "/",
						search: {
							category: "beauty",
							sort: "Featured"
						},
						children: [/* @__PURE__ */ jsx("span", {}), "Beauty"]
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "cat",
						to: "/",
						search: {
							category: "commerce",
							sort: "Featured"
						},
						children: [/* @__PURE__ */ jsx("span", {}), "Commerce"]
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "cat",
						to: "/",
						search: {
							category: "cinema",
							sort: "Featured"
						},
						children: [/* @__PURE__ */ jsx("span", {}), "Cinema"]
					}),
					/* @__PURE__ */ jsxs(Link, {
						className: "cat",
						to: "/",
						search: {
							category: "systems",
							sort: "Featured"
						},
						children: [/* @__PURE__ */ jsx("span", {}), "Systems"]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "promo",
						children: [/* @__PURE__ */ jsx("b", { children: "Creator-grade prompts" }), /* @__PURE__ */ jsx("p", { children: "Featured, free and paid packs are ranked by sales, rating and model fit." })]
					})
				]
			}),
			open && /* @__PURE__ */ jsx("button", {
				className: "scrim",
				type: "button",
				"aria-label": "Close navigation",
				onClick: () => setOpen(false)
			}),
			/* @__PURE__ */ jsx("main", {
				id: "content",
				className: "main",
				children
			})
		]
	});
}
function Storefront({ catalog, search }) {
	const navigate = useNavigate();
	const [query, setQuery] = useState(search.q ?? "");
	const apply = (next) => navigate({
		to: "/",
		search: {
			sort: "Featured",
			...search,
			...next
		}
	});
	return /* @__PURE__ */ jsxs(Shell, {
		counts: catalog.counts,
		children: [
			/* @__PURE__ */ jsxs("header", {
				className: "topbar",
				children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
					className: "eyebrow",
					children: "Prompt gallery"
				}), /* @__PURE__ */ jsx("h1", { children: "Premium prompts for image, copy and commerce workflows." })] }), /* @__PURE__ */ jsxs("form", {
					className: "search",
					onSubmit: (e) => {
						e.preventDefault();
						apply({ q: query });
					},
					children: [/* @__PURE__ */ jsx("input", {
						"aria-label": "Search prompts",
						placeholder: "Search POWERPROMPT",
						value: query,
						onChange: (e) => setQuery(e.target.value)
					}), /* @__PURE__ */ jsx("button", {
						type: "submit",
						children: "Search"
					})]
				})]
			}),
			/* @__PURE__ */ jsxs("section", {
				className: "filters",
				"aria-label": "Prompt filters",
				children: [
					/* @__PURE__ */ jsx("button", {
						className: !search.model || search.model === "all" ? "active" : "",
						onClick: () => apply({ model: "all" }),
						children: "All"
					}),
					catalog.models.map((model) => /* @__PURE__ */ jsx("button", {
						className: search.model === model ? "active" : "",
						onClick: () => apply({ model }),
						children: model
					}, model)),
					/* @__PURE__ */ jsx("button", {
						className: search.favorites ? "active" : "",
						onClick: () => apply({ favorites: !search.favorites }),
						children: "Favorites"
					}),
					/* @__PURE__ */ jsx("span", { className: "split" }),
					[
						"Featured",
						"Newest",
						"Popular"
					].map((sort) => /* @__PURE__ */ jsx("button", {
						className: (search.sort ?? "Featured") === sort ? "active" : "",
						onClick: () => apply({ sort }),
						children: sort
					}, sort))
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "countline",
				children: [
					catalog.counts.featured,
					" featured · ",
					catalog.counts.free,
					" free · ",
					catalog.counts.paid,
					" paid · Cart ",
					catalog.counts.cart
				]
			}),
			/* @__PURE__ */ jsx("section", {
				className: "masonry",
				"aria-label": "Prompt cards",
				children: catalog.prompts.map((prompt) => /* @__PURE__ */ jsx(PromptTile, { prompt }, prompt.id))
			}),
			catalog.prompts.length === 0 && /* @__PURE__ */ jsx("p", {
				className: "empty",
				children: "No prompts match this view."
			})
		]
	});
}
function PromptTile({ prompt }) {
	const [isPending, startTransition] = useTransition();
	const [fav, setFav] = useState(prompt.isFavorite);
	const [carted, setCarted] = useState(prompt.inCart);
	const act = (kind) => startTransition(async () => {
		if (kind === "favorite") {
			await toggleFavoriteFn({ data: { promptId: prompt.id } });
			setFav((v) => !v);
			toast(fav ? "Removed from Favorites" : "Saved to Favorites");
		} else {
			await addToCartFn({ data: { promptId: prompt.id } });
			setCarted(true);
			toast("Added to Cart");
		}
	});
	return /* @__PURE__ */ jsxs("article", {
		className: "tile",
		style: { ["--ratio"]: prompt.ratio },
		children: [
			/* @__PURE__ */ jsxs(Link, {
				className: "media",
				to: "/prompts/$promptId",
				params: { promptId: prompt.id },
				"aria-label": `Open ${prompt.title}`,
				children: [/* @__PURE__ */ jsx("img", {
					src: prompt.image,
					alt: "",
					loading: "lazy"
				}), /* @__PURE__ */ jsx("span", { className: "shade" })]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "overlay",
				children: [/* @__PURE__ */ jsx("button", {
					"aria-pressed": fav,
					disabled: isPending,
					onClick: () => act("favorite"),
					children: fav ? "Saved" : "Save"
				}), /* @__PURE__ */ jsx("button", {
					disabled: isPending || carted,
					onClick: () => act("cart"),
					children: carted ? "In cart" : prompt.priceCents === 0 ? "Get free" : "Add"
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "tilebody",
				children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("b", { children: prompt.title }), /* @__PURE__ */ jsxs("p", { children: [
					prompt.creator,
					" · ",
					prompt.model
				] })] }), /* @__PURE__ */ jsx("strong", { children: money(prompt.priceCents) })]
			})
		]
	});
}
function DetailView({ prompt, related }) {
	return /* @__PURE__ */ jsxs(Shell, { children: [
		/* @__PURE__ */ jsxs("div", {
			className: "detail",
			children: [/* @__PURE__ */ jsx("img", {
				src: prompt.image,
				alt: ""
			}), /* @__PURE__ */ jsxs("section", { children: [
				/* @__PURE__ */ jsxs("p", {
					className: "eyebrow",
					children: [
						prompt.model,
						" · ",
						prompt.category
					]
				}),
				/* @__PURE__ */ jsx("h1", { children: prompt.title }),
				/* @__PURE__ */ jsx("p", { children: prompt.description }),
				/* @__PURE__ */ jsxs("div", {
					className: "metrics",
					children: [
						/* @__PURE__ */ jsxs("span", { children: [prompt.rating.toFixed(1), " rating"] }),
						/* @__PURE__ */ jsxs("span", { children: [prompt.sales, " sales"] }),
						/* @__PURE__ */ jsx("span", { children: money(prompt.priceCents) })
					]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "actions",
					children: [/* @__PURE__ */ jsx(CartButton, { prompt }), /* @__PURE__ */ jsx(Link, {
						to: "/cart",
						children: "Open Cart"
					})]
				})
			] })]
		}),
		/* @__PURE__ */ jsx("h2", {
			className: "section-title",
			children: "Related prompt previews"
		}),
		/* @__PURE__ */ jsx("section", {
			className: "masonry related",
			children: related.slice(0, 4).map((item) => /* @__PURE__ */ jsx(PromptTile, { prompt: item }, item.id))
		})
	] });
}
function CartButton({ prompt }) {
	const [done, setDone] = useState(prompt.inCart);
	return /* @__PURE__ */ jsx("button", {
		className: "primary",
		disabled: done,
		onClick: async () => {
			await addToCartFn({ data: { promptId: prompt.id } });
			setDone(true);
			toast("Added to Cart");
		},
		children: done ? "In Cart" : "Add to Cart"
	});
}
function CartView({ cart }) {
	const [state, setState] = useState(cart);
	const [message, setMessage] = useState("");
	return /* @__PURE__ */ jsxs(Shell, {
		counts: {
			all: 0,
			free: 0,
			paid: 0,
			featured: 0,
			favorites: 0,
			cart: state.items.length
		},
		children: [/* @__PURE__ */ jsxs("header", {
			className: "pagehead",
			children: [/* @__PURE__ */ jsx("p", {
				className: "eyebrow",
				children: "Cart"
			}), /* @__PURE__ */ jsx("h1", { children: "Checkout simulation" })]
		}), /* @__PURE__ */ jsxs("section", {
			className: "cartgrid",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "cartitems",
				children: [state.items.map((item) => /* @__PURE__ */ jsxs("div", {
					className: "cartrow",
					children: [
						/* @__PURE__ */ jsx("img", {
							src: item.image,
							alt: ""
						}),
						/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("b", { children: item.title }), /* @__PURE__ */ jsxs("p", { children: [
							item.model,
							" · ",
							item.creator
						] })] }),
						/* @__PURE__ */ jsx("strong", { children: money(item.priceCents) }),
						/* @__PURE__ */ jsx("button", {
							onClick: async () => setState(await removeFromCartFn({ data: { promptId: item.id } })),
							children: "Remove"
						})
					]
				}, item.id)), state.items.length === 0 && /* @__PURE__ */ jsx("p", {
					className: "empty",
					children: "Your Cart is empty."
				})]
			}), /* @__PURE__ */ jsxs("aside", {
				className: "summary",
				children: [
					/* @__PURE__ */ jsxs("p", { children: ["Subtotal ", /* @__PURE__ */ jsx("b", { children: money(state.subtotalCents) })] }),
					/* @__PURE__ */ jsxs("p", { children: ["Platform fee ", /* @__PURE__ */ jsx("b", { children: money(state.feeCents) })] }),
					/* @__PURE__ */ jsxs("p", {
						className: "total",
						children: ["Total ", /* @__PURE__ */ jsx("b", { children: money(state.totalCents) })]
					}),
					/* @__PURE__ */ jsx("button", {
						className: "primary",
						disabled: !state.items.length,
						onClick: async () => {
							const result = await checkoutFn();
							setState(result.cart);
							setMessage(result.orderId ? `Order ${result.orderId} complete` : "Cart is empty");
						},
						children: "Checkout"
					}),
					message && /* @__PURE__ */ jsx("small", { children: message })
				]
			})]
		})]
	});
}
function AdminView({ analytics }) {
	return /* @__PURE__ */ jsxs(Shell, { children: [
		/* @__PURE__ */ jsxs("header", {
			className: "pagehead",
			children: [/* @__PURE__ */ jsx("p", {
				className: "eyebrow",
				children: "Creator admin"
			}), /* @__PURE__ */ jsx("h1", { children: "Sales, conversion and category revenue" })]
		}),
		/* @__PURE__ */ jsxs("section", {
			className: "admincards",
			children: [
				/* @__PURE__ */ jsx(Metric, {
					label: "Average price",
					value: money(analytics.averagePriceCents)
				}),
				/* @__PURE__ */ jsx(Metric, {
					label: "Daily trend rows",
					value: String(analytics.dailySales.length)
				}),
				/* @__PURE__ */ jsx(Metric, {
					label: "Top category",
					value: analytics.categoryRevenue[0]?.category ?? "None"
				})
			]
		}),
		/* @__PURE__ */ jsxs("section", {
			className: "tables",
			children: [/* @__PURE__ */ jsx(DataTable, {
				title: "Creator revenue",
				rows: analytics.creatorRevenue.map((r) => [
					r.creator,
					money(r.revenueCents),
					`${(r.conversionRate * 100).toFixed(2)}%`,
					money(r.averageOrderValueCents ?? 0)
				]),
				headers: [
					"Creator",
					"Revenue",
					"Conversion",
					"AOV"
				]
			}), /* @__PURE__ */ jsx(DataTable, {
				title: "Daily sales",
				rows: analytics.dailySales.map((r) => [
					r.day,
					money(r.revenueCents),
					String(r.orders)
				]),
				headers: [
					"Day",
					"Revenue",
					"Orders"
				]
			})]
		})
	] });
}
function Metric({ label, value }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "metric",
		children: [/* @__PURE__ */ jsx("span", { children: label }), /* @__PURE__ */ jsx("b", { children: value })]
	});
}
function DataTable({ title, headers, rows }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "panel",
		children: [/* @__PURE__ */ jsx("h2", { children: title }), /* @__PURE__ */ jsxs("table", { children: [/* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsx("tr", { children: headers.map((h) => /* @__PURE__ */ jsx("th", { children: h }, h)) }) }), /* @__PURE__ */ jsx("tbody", { children: rows.map((r, i) => /* @__PURE__ */ jsx("tr", { children: r.map((c) => /* @__PURE__ */ jsx("td", { children: c }, c)) }, i)) })] })]
	});
}
function toast(text) {
	if (typeof document === "undefined") return;
	const el = document.createElement("div");
	el.className = "toast";
	el.textContent = text;
	document.body.appendChild(el);
	setTimeout(() => el.remove(), 1800);
}
//#endregion
export { Storefront as i, CartView as n, DetailView as r, AdminView as t };
