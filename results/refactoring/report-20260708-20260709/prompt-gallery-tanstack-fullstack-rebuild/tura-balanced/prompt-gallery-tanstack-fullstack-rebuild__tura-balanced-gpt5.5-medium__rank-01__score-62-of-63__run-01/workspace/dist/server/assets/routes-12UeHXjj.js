import { n as useToast } from "./toast-0CjHUAlA.js";
import { s as toggleFavoriteFn, t as addToCartFn } from "./queries-BQK17jAu.js";
import { t as Route } from "./routes-DntEwOkX.js";
import { n as Icons, t as AppShell } from "./AppShell-CuCLkH6E.js";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region src/components/Gallery.tsx
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
function imageFallback(event) {
	event.currentTarget.style.display = "none";
	event.currentTarget.parentElement?.classList.add("fb");
}
function Storefront({ prompts, categories, counts, previewPrompt }) {
	const search = useSearch({ strict: false });
	const navigate = useNavigate();
	const { showToast } = useToast();
	const [searchOpen, setSearchOpen] = useState(Boolean(search.q));
	const [clientPreview, setClientPreview] = useState(null);
	const previewId = search.preview == null ? void 0 : String(search.preview).replace(/^"|"$/g, "");
	const selected = clientPreview ?? previewPrompt ?? prompts.find((prompt) => String(prompt.id) === previewId) ?? null;
	useEffect(() => {
		const reveal = () => setSearchOpen((value) => !value);
		const toast = (event) => showToast(event.detail);
		window.addEventListener("powerprompt:search", reveal);
		window.addEventListener("powerprompt:toast", toast);
		return () => {
			window.removeEventListener("powerprompt:search", reveal);
			window.removeEventListener("powerprompt:toast", toast);
		};
	}, [showToast]);
	useEffect(() => {
		if (!previewId) {
			setClientPreview(null);
			return;
		}
		const prompt = previewPrompt ?? prompts.find((item) => String(item.id) === previewId) ?? null;
		setClientPreview(prompt);
	}, [
		previewId,
		previewPrompt,
		prompts
	]);
	const current = useMemo(() => ({
		model: search.model ?? "all",
		category: search.category ?? "all",
		sort: search.sort ?? "featured",
		q: search.q ?? "",
		favorites: search.favorites,
		free: search.free,
		preview: search.preview
	}), [search]);
	const update = (patch) => void navigate({
		to: "/",
		search: {
			...current,
			...patch
		}
	});
	const openPreview = (id) => {
		setClientPreview(prompts.find((prompt) => prompt.id === id) ?? null);
		update({ preview: String(id) });
	};
	const closePreview = () => {
		setClientPreview(null);
		update({ preview: void 0 });
	};
	const favorite = async (id) => {
		const result = await toggleFavoriteFn({ data: id });
		showToast(result.isFavorite ? "Saved to favorites" : "Removed from favorites");
		await navigate({
			to: "/",
			search: (old) => old,
			replace: true
		});
	};
	const add = async (id) => {
		await addToCartFn({ data: id });
		showToast("Added to cart");
		await navigate({
			to: "/",
			search: (old) => old,
			replace: true
		});
	};
	return /* @__PURE__ */ jsxs(Fragment, { children: [
		/* @__PURE__ */ jsxs("div", {
			className: "topbar",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "filterbar",
				children: [/* @__PURE__ */ jsx("div", {
					className: "ftabs",
					"aria-label": "Model filters",
					children: models.map((model) => /* @__PURE__ */ jsxs("button", {
						className: `ftab ${current.model === model ? "active" : ""}`,
						type: "button",
						onClick: () => update({
							model,
							favorites: void 0,
							free: void 0
						}),
						children: [
							/* @__PURE__ */ jsx(Icons.Sparkles, { size: 15 }),
							" ",
							model === "all" ? "All" : model
						]
					}, model))
				}), /* @__PURE__ */ jsxs("div", {
					className: "fsort",
					"aria-label": "Sort prompts",
					children: [
						/* @__PURE__ */ jsx("button", {
							className: "sortbtn",
							type: "button",
							"aria-label": "Reveal search",
							onClick: () => setSearchOpen((value) => !value),
							children: "Search"
						}),
						sorts.map((sort) => /* @__PURE__ */ jsx("button", {
							className: `sortbtn ${current.sort === sort ? "active" : ""}`,
							type: "button",
							onClick: () => update({ sort }),
							children: sort[0].toUpperCase() + sort.slice(1)
						}, sort)),
						/* @__PURE__ */ jsx("button", {
							className: `sortbtn ${current.favorites === "1" ? "active" : ""}`,
							type: "button",
							onClick: () => update({ favorites: current.favorites === "1" ? void 0 : "1" }),
							children: "Favorites"
						}),
						/* @__PURE__ */ jsxs("button", {
							className: `sortbtn ${current.free === "1" ? "active" : ""}`,
							type: "button",
							onClick: () => update({ free: current.free === "1" ? void 0 : "1" }),
							children: ["Free ", counts.free]
						})
					]
				})]
			}), /* @__PURE__ */ jsx("div", {
				className: `searchbar ${searchOpen ? "open" : ""}`,
				children: /* @__PURE__ */ jsxs("div", {
					className: "inner",
					children: [/* @__PURE__ */ jsx(Icons.Search, {}), /* @__PURE__ */ jsx("input", {
						"aria-label": "Search prompts",
						value: current.q,
						onChange: (event) => update({ q: event.currentTarget.value }),
						placeholder: "Search prompts - portrait, poster, cold email..."
					})]
				})
			})]
		}),
		/* @__PURE__ */ jsxs("div", {
			className: "gallery",
			children: [current.category !== "all" ? /* @__PURE__ */ jsx("div", {
				className: "side-label",
				children: current.category
			}) : null, prompts.length === 0 ? /* @__PURE__ */ jsxs("div", {
				className: "empty",
				children: [/* @__PURE__ */ jsx("div", {
					className: "big",
					children: "Nothing here yet"
				}), /* @__PURE__ */ jsx("div", { children: current.favorites === "1" ? "Tap the bookmark on any prompt to save it." : "Try a different filter or search." })]
			}) : /* @__PURE__ */ jsx("div", {
				className: "masonry",
				"data-testid": "prompt-gallery",
				children: prompts.map((prompt, index) => /* @__PURE__ */ jsxs("article", {
					className: `tile ${prompt.isFavorite ? "saved" : ""}`,
					style: { "--ar": prompt.aspect },
					children: [
						/* @__PURE__ */ jsx("div", {
							className: "savedmark",
							children: /* @__PURE__ */ jsx(Icons.Bookmark, {
								size: 16,
								fill: "currentColor"
							})
						}),
						/* @__PURE__ */ jsxs("button", {
							className: "media",
							type: "button",
							onClick: () => openPreview(prompt.id),
							"aria-label": `Preview ${prompt.title}`,
							children: [/* @__PURE__ */ jsx("img", {
								src: prompt.imageUrl,
								alt: prompt.title,
								loading: index < 6 ? "eager" : "lazy",
								onError: imageFallback
							}), /* @__PURE__ */ jsx("span", {
								className: "fb-mark",
								"aria-hidden": "true",
								children: prompt.title[0]
							})]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "ov",
							onClick: (event) => {
								if (!event.target.closest("a,button")) openPreview(prompt.id);
							},
							children: [/* @__PURE__ */ jsxs("div", {
								className: "ov__top",
								children: [/* @__PURE__ */ jsx("span", {
									className: "model",
									children: prompt.model
								}), /* @__PURE__ */ jsxs("div", {
									className: "ov__actions",
									children: [/* @__PURE__ */ jsx("button", {
										className: "bm",
										type: "button",
										"aria-label": `Open preview ${prompt.title}`,
										onClick: () => openPreview(prompt.id),
										children: /* @__PURE__ */ jsx(Icons.Search, { size: 17 })
									}), /* @__PURE__ */ jsx("button", {
										className: `bm ${prompt.isFavorite ? "on" : ""}`,
										type: "button",
										"aria-label": "Save",
										onClick: () => void favorite(prompt.id),
										children: /* @__PURE__ */ jsx(Icons.Bookmark, { size: 17 })
									})]
								})]
							}), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h3", { children: /* @__PURE__ */ jsx(Link, {
								to: "/prompts/$promptId",
								params: { promptId: String(prompt.id) },
								children: prompt.title
							}) }), /* @__PURE__ */ jsxs("div", {
								className: "ov__row",
								children: [/* @__PURE__ */ jsx("span", {
									className: `price ${prompt.price === 0 ? "free" : ""}`,
									children: prompt.price === 0 ? "Free" : `$${prompt.price}`
								}), /* @__PURE__ */ jsxs("button", {
									className: "add",
									type: "button",
									onClick: () => void add(prompt.id),
									children: ["Add ", /* @__PURE__ */ jsx(Icons.ArrowRight, { size: 12 })]
								})]
							})] })]
						})
					]
				}, prompt.id))
			})]
		}),
		selected ? /* @__PURE__ */ jsx(PromptPreview, {
			prompt: selected,
			onClose: closePreview,
			onAdd: () => void add(selected.id)
		}) : null
	] });
}
function PromptPreview({ prompt, onClose, onAdd }) {
	useEffect(() => {
		const close = (event) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", close);
		return () => window.removeEventListener("keydown", close);
	}, [onClose]);
	return /* @__PURE__ */ jsx("div", {
		className: "lb open",
		role: "dialog",
		"aria-modal": "true",
		"aria-label": prompt.title,
		onClick: onClose,
		children: /* @__PURE__ */ jsxs("div", {
			className: "lb__card detail-grid",
			onClick: (event) => event.stopPropagation(),
			children: [
				/* @__PURE__ */ jsx("button", {
					className: "lb__close",
					type: "button",
					"aria-label": "Close preview",
					onClick: onClose,
					children: /* @__PURE__ */ jsx(Icons.X, { size: 18 })
				}),
				/* @__PURE__ */ jsx("div", {
					className: "detail-image",
					style: { "--ar": prompt.aspect },
					children: /* @__PURE__ */ jsx("img", {
						src: prompt.imageUrl,
						alt: prompt.title
					})
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "lb__info detail",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "model",
							children: [
								/* @__PURE__ */ jsx("span", { className: "d" }),
								prompt.model,
								" / ",
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
									children: "Sold"
								}), /* @__PURE__ */ jsx("div", {
									className: "v",
									children: prompt.sold.toLocaleString()
								})] }),
								/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
									className: "k",
									children: "Rating"
								}), /* @__PURE__ */ jsx("div", {
									className: "v",
									children: prompt.rating
								})] }),
								/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
									className: "k",
									children: "Creator"
								}), /* @__PURE__ */ jsx("div", {
									className: "v",
									children: prompt.creator
								})] })
							]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "lb__buy",
							children: [/* @__PURE__ */ jsx("span", {
								className: `price ${prompt.price === 0 ? "free" : ""}`,
								children: prompt.price === 0 ? "Free" : `$${prompt.price}`
							}), /* @__PURE__ */ jsxs("button", {
								className: "add",
								type: "button",
								onClick: onAdd,
								children: [
									prompt.price === 0 ? "Get it free" : "Add to cart",
									" ",
									/* @__PURE__ */ jsx(Icons.ArrowRight, { size: 14 })
								]
							})]
						})
					]
				})
			]
		})
	});
}
//#endregion
//#region src/routes/index.tsx?tsr-split=component
function IndexRoute() {
	const { catalog, cart, previewPrompt } = Route.useLoaderData();
	return /* @__PURE__ */ jsx(AppShell, {
		cartCount: cart.totals.itemCount,
		children: /* @__PURE__ */ jsx(Storefront, {
			...catalog,
			previewPrompt
		})
	});
}
//#endregion
export { IndexRoute as component };
