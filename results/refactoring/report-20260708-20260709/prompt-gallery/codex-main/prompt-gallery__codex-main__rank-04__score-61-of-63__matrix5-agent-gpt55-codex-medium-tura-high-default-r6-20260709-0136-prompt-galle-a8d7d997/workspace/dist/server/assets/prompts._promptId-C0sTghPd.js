import { n as useToast } from "./useToast-DprI_C5-.js";
import { n as postJson } from "./client-api-COuYp5Ys.js";
import { t as Route } from "./prompts._promptId-DKiH2lDm.js";
import { t as Chrome } from "./Chrome-DrR7oFgJ.js";
import { Link, useRouter } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { Bookmark, ShoppingBag } from "lucide-react";
//#region src/routes/prompts.$promptId.tsx?tsr-split=component
function PromptDetail() {
	const { prompt, cart, categories } = Route.useLoaderData();
	const router = useRouter();
	const toast = useToast();
	async function add() {
		await postJson("/api/cart", {
			action: "add",
			promptId: prompt.id
		});
		await router.invalidate();
		toast(`Added - ${prompt.title}`);
	}
	async function save() {
		const result = await postJson("/api/favorite", { promptId: prompt.id });
		await router.invalidate();
		toast(result.favorited ? "Saved to favorites" : "Removed from favorites");
	}
	return /* @__PURE__ */ jsx(Chrome, {
		categories,
		cartCount: cart.totals.count,
		children: /* @__PURE__ */ jsx("section", {
			className: "detail-shell",
			children: /* @__PURE__ */ jsxs("div", {
				className: "detail-card",
				children: [/* @__PURE__ */ jsx("div", {
					className: "detail-media",
					children: /* @__PURE__ */ jsx("img", {
						src: prompt.imageUrl,
						alt: prompt.title
					})
				}), /* @__PURE__ */ jsxs("div", {
					className: "detail-info",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "model-pill",
							style: {
								alignSelf: "flex-start",
								color: "#fff",
								marginBottom: 12
							},
							children: [
								prompt.model,
								" · ",
								prompt.category
							]
						}),
						/* @__PURE__ */ jsx("h1", { children: prompt.title }),
						/* @__PURE__ */ jsx("p", {
							className: "desc",
							children: prompt.description
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "stat-grid",
							children: [
								/* @__PURE__ */ jsxs("div", {
									className: "stat",
									children: [/* @__PURE__ */ jsx("div", {
										className: "k",
										children: "Rating"
									}), /* @__PURE__ */ jsxs("div", {
										className: "v",
										children: ["★ ", prompt.rating]
									})]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "stat",
									children: [/* @__PURE__ */ jsx("div", {
										className: "k",
										children: "Sold"
									}), /* @__PURE__ */ jsx("div", {
										className: "v",
										children: prompt.sold.toLocaleString()
									})]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "stat",
									children: [/* @__PURE__ */ jsx("div", {
										className: "k",
										children: "Seller"
									}), /* @__PURE__ */ jsx("div", {
										className: "v",
										children: prompt.creator
									})]
								})
							]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "buy-row",
							children: [/* @__PURE__ */ jsx("span", {
								className: "price",
								children: prompt.price === 0 ? "Free" : `$${prompt.price}`
							}), /* @__PURE__ */ jsxs("div", {
								className: "actions",
								children: [/* @__PURE__ */ jsxs("button", {
									className: "secondary",
									onClick: save,
									children: [/* @__PURE__ */ jsx(Bookmark, {
										size: 14,
										fill: prompt.isFavorite ? "currentColor" : "none"
									}), " Save"]
								}), /* @__PURE__ */ jsxs("button", {
									className: "primary",
									onClick: add,
									children: [
										/* @__PURE__ */ jsx(ShoppingBag, { size: 14 }),
										" ",
										prompt.price === 0 ? "Get it free" : "Add to cart"
									]
								})]
							})]
						}),
						/* @__PURE__ */ jsx("p", {
							className: "desc",
							children: /* @__PURE__ */ jsx(Link, {
								to: "/",
								children: "Back to gallery"
							})
						})
					]
				})]
			})
		})
	});
}
//#endregion
export { PromptDetail as component };
