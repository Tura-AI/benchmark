import { n as useToast } from "./useToast-DprI_C5-.js";
import { n as postJson } from "./client-api-COuYp5Ys.js";
import { t as Route } from "./routes-Dfa7LDHW.js";
import { t as Chrome } from "./Chrome-DrR7oFgJ.js";
import { Link, useRouter } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { ArrowRight, Bookmark, Circle, Diamond, Grid2X2, Search, Triangle } from "lucide-react";
//#region src/components/PromptCard.tsx
function PromptCard({ prompt }) {
	const router = useRouter();
	const toast = useToast();
	async function save(event) {
		event.preventDefault();
		event.stopPropagation();
		const result = await postJson("/api/favorite", { promptId: prompt.id });
		await router.invalidate();
		toast(result.favorited ? "Saved to favorites" : "Removed from favorites");
	}
	async function add(event) {
		event.preventDefault();
		event.stopPropagation();
		await postJson("/api/cart", {
			action: "add",
			promptId: prompt.id
		});
		await router.invalidate();
		toast(`Added - ${prompt.title}`);
	}
	return /* @__PURE__ */ jsxs(Link, {
		className: "tile",
		to: "/prompts/$promptId",
		params: { promptId: String(prompt.id) },
		style: { "--ar": prompt.aspectRatio.replace("/", " / ") },
		children: [
			prompt.isFavorite ? /* @__PURE__ */ jsx("span", {
				className: "savedmark",
				children: /* @__PURE__ */ jsx(Bookmark, {
					size: 14,
					fill: "currentColor"
				})
			}) : null,
			/* @__PURE__ */ jsxs("div", {
				className: "media",
				children: [/* @__PURE__ */ jsx("img", {
					src: prompt.imageUrl,
					alt: prompt.title,
					loading: "lazy",
					onError: (event) => {
						event.currentTarget.style.display = "none";
					}
				}), /* @__PURE__ */ jsx("div", {
					className: "fallback",
					"aria-hidden": "true",
					children: prompt.title.charAt(0)
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "overlay",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "overlay-top",
					children: [/* @__PURE__ */ jsx("span", {
						className: "model-pill",
						children: prompt.model
					}), /* @__PURE__ */ jsx("button", {
						className: `save-btn ${prompt.isFavorite ? "on" : ""}`,
						"aria-label": "Save",
						onClick: save,
						children: /* @__PURE__ */ jsx(Bookmark, {
							size: 15,
							fill: prompt.isFavorite ? "currentColor" : "none"
						})
					})]
				}), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h3", { children: prompt.title }), /* @__PURE__ */ jsxs("div", {
					className: "overlay-row",
					children: [/* @__PURE__ */ jsx("span", {
						className: `price ${prompt.price === 0 ? "free" : ""}`,
						children: prompt.price === 0 ? "Free" : `$${prompt.price}`
					}), /* @__PURE__ */ jsxs("button", {
						className: "add-btn",
						onClick: add,
						children: ["Add ", /* @__PURE__ */ jsx(ArrowRight, { size: 12 })]
					})]
				})] })]
			})
		]
	});
}
//#endregion
//#region src/components/TopFilters.tsx
var models = [
	[
		"all",
		"All",
		Grid2X2
	],
	[
		"GPT-4o",
		"GPT-4o",
		Circle
	],
	[
		"Claude",
		"Claude",
		Search
	],
	[
		"Midjourney",
		"Midjourney",
		Triangle
	],
	[
		"Flux",
		"Flux",
		Diamond
	]
];
var sorts = [
	["featured", "Featured"],
	["newest", "Newest"],
	["popular", "Popular"]
];
function TopFilters({ model, sort, search, category, favoritesOnly, freeOnly, searchOpen }) {
	const href = (next) => {
		const params = new URLSearchParams();
		const values = {
			model,
			category,
			sort,
			search,
			favoritesOnly,
			freeOnly,
			searchOpen,
			...next
		};
		Object.entries(values).forEach(([key, value]) => {
			if (value !== void 0 && value !== false && value !== "" && value !== "all") params.set(key, String(value));
		});
		const query = params.toString();
		return query ? `/?${query}` : "/";
	};
	return /* @__PURE__ */ jsxs("div", {
		className: "topbar",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "filterbar",
			children: [/* @__PURE__ */ jsx("div", {
				className: "ftabs",
				children: models.map(([value, label, Icon]) => /* @__PURE__ */ jsxs("a", {
					className: `ftab ${model === value ? "active" : ""}`,
					href: href({ model: value }),
					children: [/* @__PURE__ */ jsx(Icon, {}), label]
				}, value))
			}), /* @__PURE__ */ jsx("div", {
				className: "fsort",
				children: sorts.map(([value, label]) => /* @__PURE__ */ jsx("a", {
					className: `sortbtn ${sort === value ? "active" : ""}`,
					href: href({ sort: value }),
					children: label
				}, value))
			})]
		}), /* @__PURE__ */ jsx("form", {
			className: `searchbar ${searchOpen ? "open" : ""}`,
			action: "/",
			method: "get",
			children: /* @__PURE__ */ jsxs("div", {
				className: "search-inner",
				children: [
					/* @__PURE__ */ jsx(Search, {}),
					/* @__PURE__ */ jsx("input", {
						type: "hidden",
						name: "model",
						value: model
					}),
					/* @__PURE__ */ jsx("input", {
						type: "hidden",
						name: "category",
						value: category
					}),
					/* @__PURE__ */ jsx("input", {
						type: "hidden",
						name: "sort",
						value: sort
					}),
					/* @__PURE__ */ jsx("input", {
						type: "hidden",
						name: "searchOpen",
						value: "true"
					}),
					/* @__PURE__ */ jsx("input", {
						name: "search",
						defaultValue: search,
						placeholder: "Search prompts - portrait, poster, cold email...",
						"aria-label": "Search prompts"
					})
				]
			})
		})]
	});
}
//#endregion
//#region src/routes/index.tsx?tsr-split=component
function Storefront() {
	const data = Route.useLoaderData();
	const search = Route.useSearch();
	const model = search.model ?? "all";
	const category = search.category ?? "all";
	const sort = search.sort ?? "featured";
	const term = search.search ?? "";
	const favoritesOnly = Boolean(search.favoritesOnly);
	const freeOnly = Boolean(search.freeOnly);
	return /* @__PURE__ */ jsxs(Chrome, {
		categories: data.categories,
		cartCount: data.cart.totals.count,
		children: [/* @__PURE__ */ jsx(TopFilters, {
			model,
			category,
			sort,
			search: term,
			favoritesOnly,
			freeOnly,
			searchOpen: Boolean(search.searchOpen) || term.length > 0
		}), /* @__PURE__ */ jsx("section", {
			className: "gallery",
			"aria-label": "Prompt marketplace",
			children: data.prompts.length ? /* @__PURE__ */ jsx("div", {
				className: "masonry",
				children: data.prompts.map((prompt) => /* @__PURE__ */ jsx(PromptCard, { prompt }, prompt.id))
			}) : /* @__PURE__ */ jsxs("div", {
				className: "empty",
				children: [/* @__PURE__ */ jsx("strong", { children: "Nothing here yet" }), /* @__PURE__ */ jsx("span", { children: favoritesOnly ? "Tap the bookmark on any prompt to save it." : "Try a different filter or search." })]
			})
		})]
	});
}
//#endregion
export { Storefront as component };
