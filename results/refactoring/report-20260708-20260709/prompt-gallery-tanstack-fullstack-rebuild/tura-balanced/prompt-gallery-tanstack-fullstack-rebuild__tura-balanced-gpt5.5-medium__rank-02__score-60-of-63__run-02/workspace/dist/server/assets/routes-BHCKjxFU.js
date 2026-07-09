import { c as toggleFavoriteAction, t as addCartAction } from "./marketplace-sbgQtYxN.js";
import { t as Route } from "./routes-Dl3XZHma.js";
import { n as Toast, r as Icon, t as Shell } from "./layout-2vooB8mZ.js";
import { useMemo, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region src/components/storefront.tsx
function Storefront({ prompts, counts, searchState }) {
	const router = useRouter();
	const [toast, setToast] = useState("");
	const show = (message) => {
		setToast(message);
		window.setTimeout(() => setToast(""), 2100);
	};
	const activeModel = String(searchState.model ?? "all");
	const activeSort = String(searchState.sort ?? "featured");
	const searchOpen = Boolean(searchState.q);
	const modelTabs = useMemo(() => [
		"all",
		"GPT-4o",
		"Claude",
		"Midjourney",
		"Flux"
	], []);
	const sizes = [
		"tall",
		"",
		"",
		"wide",
		"",
		"tall",
		"",
		"",
		"",
		"wide"
	];
	return /* @__PURE__ */ jsxs(Fragment, { children: [
		/* @__PURE__ */ jsxs("div", {
			className: "topbar",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "filterbar",
				children: [/* @__PURE__ */ jsx("div", {
					className: "ftabs",
					"aria-label": "Model filters",
					children: modelTabs.map((model) => /* @__PURE__ */ jsxs(Link, {
						className: `ftab ${activeModel === model ? "active" : ""}`,
						to: "/",
						search: (old) => ({
							...old,
							model
						}),
						children: [
							/* @__PURE__ */ jsx(Icon, { name: model === "all" ? "grid" : model === "Flux" ? "spark" : "search" }),
							" ",
							model === "all" ? "All" : model
						]
					}, model))
				}), /* @__PURE__ */ jsx("div", {
					className: "fsort",
					"aria-label": "Sort controls",
					children: [
						"featured",
						"newest",
						"popular"
					].map((sort) => /* @__PURE__ */ jsx(Link, {
						className: `sortbtn ${activeSort === sort ? "active" : ""}`,
						to: "/",
						search: (old) => ({
							...old,
							sort
						}),
						children: sort[0].toUpperCase() + sort.slice(1)
					}, sort))
				})]
			}), /* @__PURE__ */ jsxs("form", {
				className: `searchbar ${searchOpen ? "open" : ""}`,
				onSubmit: (event) => event.preventDefault(),
				children: [/* @__PURE__ */ jsx(Icon, { name: "search" }), /* @__PURE__ */ jsx("input", {
					"aria-label": "Search prompts",
					placeholder: "Search prompts, models, categories...",
					defaultValue: String(searchState.q ?? ""),
					onChange: (event) => router.navigate({
						to: "/",
						search: (old) => ({
							...old,
							q: event.target.value || void 0
						})
					})
				})]
			})]
		}),
		/* @__PURE__ */ jsxs("section", {
			className: "hero",
			children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsxs("h1", { children: ["Power prompts ", /* @__PURE__ */ jsx("em", { children: "for every model." })] }), /* @__PURE__ */ jsxs("div", {
				className: "metrics",
				children: [
					/* @__PURE__ */ jsxs("span", { children: [counts.total, " prompts"] }),
					/* @__PURE__ */ jsxs("span", { children: [counts.featured, " featured"] }),
					/* @__PURE__ */ jsxs("span", { children: [counts.free, " free"] })
				]
			})] }), /* @__PURE__ */ jsx("p", { children: "Curated prompts for GPT-4o, Claude, Midjourney, and Flux with save, cart, and checkout flows backed by local data." })]
		}),
		/* @__PURE__ */ jsx("section", {
			className: "masonry",
			"aria-label": "Prompt gallery",
			children: prompts.length === 0 ? /* @__PURE__ */ jsxs("div", {
				className: "empty",
				children: [/* @__PURE__ */ jsx("div", {
					className: "big",
					children: "Nothing here yet"
				}), /* @__PURE__ */ jsx("div", { children: "Try a different filter or search." })]
			}) : prompts.map((prompt, index) => /* @__PURE__ */ jsxs("article", {
				className: `tile ${sizes[index % sizes.length]}`,
				style: { "--ar": prompt.aspectRatio },
				children: [
					prompt.isFavorite ? /* @__PURE__ */ jsx("div", {
						className: "savedmark",
						children: /* @__PURE__ */ jsx("svg", {
							viewBox: "0 0 24 24",
							children: /* @__PURE__ */ jsx("path", { d: "M6 4h12v17l-6-4-6 4V4Z" })
						})
					}) : null,
					/* @__PURE__ */ jsx(Link, {
						to: "/prompts/$promptId",
						params: { promptId: String(prompt.id) },
						className: "media",
						"aria-label": `View ${prompt.title}`,
						children: /* @__PURE__ */ jsx("img", {
							src: prompt.imageUrl,
							alt: prompt.title,
							loading: "lazy",
							onError: (event) => {
								event.currentTarget.replaceWith(fallback(prompt.title, index));
							}
						})
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "ov",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "ov__top",
							children: [/* @__PURE__ */ jsx("span", {
								className: "model",
								children: prompt.model
							}), /* @__PURE__ */ jsx("button", {
								className: `bm ${prompt.isFavorite ? "on" : ""}`,
								"aria-label": "Save",
								onClick: async () => {
									show(prompt.isFavorite ? "Removed from favorites" : "Saved to favorites");
									try {
										await toggleFavoriteAction({ data: { promptId: prompt.id } });
										await router.invalidate();
									} catch {
										show("Favorite could not be updated");
									}
								},
								children: /* @__PURE__ */ jsx(Icon, { name: "bag" })
							})]
						}), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h3", { children: prompt.title }), /* @__PURE__ */ jsxs("div", {
							className: "ov__row",
							children: [/* @__PURE__ */ jsx("span", {
								className: `price ${prompt.priceCents === 0 ? "free" : ""}`,
								children: prompt.priceCents === 0 ? "Free" : `$${prompt.priceCents / 100}`
							}), /* @__PURE__ */ jsx("button", {
								className: "add",
								onClick: async () => {
									show(`Added — ${prompt.title}`);
									try {
										await addCartAction({ data: { promptId: prompt.id } });
										await router.invalidate();
									} catch {
										show("Cart could not be updated");
									}
								},
								children: "Add"
							})]
						})] })]
					})
				]
			}, prompt.id))
		}),
		/* @__PURE__ */ jsx(Toast, { message: toast })
	] });
}
function fallback(title, index) {
	const d = document.createElement("div");
	d.className = "fb";
	d.style.setProperty("--fb-bg", index % 2 ? "var(--lime)" : "var(--ink)");
	d.style.setProperty("--fb-fg", index % 2 ? "var(--ink)" : "var(--lime)");
	d.innerHTML = `<span class="fb-mark">${title[0] ?? "P"}</span>`;
	return d;
}
//#endregion
//#region src/routes/index.tsx?tsr-split=component
function Home() {
	const data = Route.useLoaderData();
	const search = Route.useSearch();
	return /* @__PURE__ */ jsx(Shell, {
		categories: data.categories,
		cartCount: data.cart.count,
		children: /* @__PURE__ */ jsx(Storefront, {
			prompts: data.prompts,
			counts: data.counts,
			searchState: search
		})
	});
}
//#endregion
export { Home as component };
