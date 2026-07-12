import { n as useToast } from "./toast-0CjHUAlA.js";
import { s as toggleFavoriteFn, t as addToCartFn } from "./queries-BQK17jAu.js";
import { t as Route } from "./prompts._promptId-B_zlD9LX.js";
import { n as Icons, t as AppShell } from "./AppShell-CuCLkH6E.js";
import { Link } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/prompts.$promptId.tsx?tsr-split=component
function PromptRoute() {
	const { prompt, cart } = Route.useLoaderData();
	const { showToast } = useToast();
	return /* @__PURE__ */ jsx(AppShell, {
		cartCount: cart.totals.itemCount,
		children: /* @__PURE__ */ jsx("div", {
			className: "detail-page",
			children: /* @__PURE__ */ jsxs("div", {
				className: "detail-grid panel",
				children: [/* @__PURE__ */ jsx("div", {
					className: "detail-image",
					style: { "--ar": prompt.aspect },
					children: /* @__PURE__ */ jsx("img", {
						src: prompt.imageUrl,
						alt: prompt.title
					})
				}), /* @__PURE__ */ jsxs("section", {
					className: "detail",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "model",
							children: [
								prompt.model,
								" / ",
								prompt.category
							]
						}),
						/* @__PURE__ */ jsx("h1", { children: prompt.title }),
						/* @__PURE__ */ jsx("p", {
							className: "desc",
							children: prompt.description
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "stat-row",
							children: [/* @__PURE__ */ jsx("span", { children: "Creator" }), /* @__PURE__ */ jsx("strong", { children: prompt.creator })]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "stat-row",
							children: [/* @__PURE__ */ jsx("span", { children: "Rank score" }), /* @__PURE__ */ jsx("strong", { children: prompt.rankScore })]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "stat-row",
							children: [/* @__PURE__ */ jsx("span", { children: "Sold" }), /* @__PURE__ */ jsx("strong", { children: prompt.sold.toLocaleString() })]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "stat-row",
							children: [/* @__PURE__ */ jsx("span", { children: "Rating" }), /* @__PURE__ */ jsx("strong", { children: prompt.rating })]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "lb__buy",
							children: [
								/* @__PURE__ */ jsx("span", {
									className: `price ${prompt.price === 0 ? "free" : ""}`,
									children: prompt.price === 0 ? "Free" : `$${prompt.price}`
								}),
								/* @__PURE__ */ jsx("button", {
									className: "bm",
									type: "button",
									"aria-label": "Save",
									onClick: () => void toggleFavoriteFn({ data: prompt.id }).then((r) => showToast(r.isFavorite ? "Saved to favorites" : "Removed from favorites")),
									children: /* @__PURE__ */ jsx(Icons.Bookmark, {})
								}),
								/* @__PURE__ */ jsxs("button", {
									className: "add",
									type: "button",
									onClick: () => void addToCartFn({ data: prompt.id }).then(() => showToast("Added to cart")),
									children: ["Add to cart ", /* @__PURE__ */ jsx(Icons.ArrowRight, { size: 14 })]
								})
							]
						}),
						/* @__PURE__ */ jsx("p", { children: /* @__PURE__ */ jsx(Link, {
							to: "/",
							children: "Back to gallery"
						}) })
					]
				})]
			})
		})
	});
}
//#endregion
export { PromptRoute as component };
