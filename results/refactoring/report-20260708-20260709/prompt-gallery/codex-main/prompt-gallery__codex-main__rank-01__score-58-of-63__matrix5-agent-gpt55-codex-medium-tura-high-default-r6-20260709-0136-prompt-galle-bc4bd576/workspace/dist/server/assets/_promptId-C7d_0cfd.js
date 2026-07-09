import { l as toggleFavoriteFn, s as getPromptDetail, t as addToCartFn } from "./market-CFU9gbvr.js";
import { t as Route } from "./_promptId-CZMslJc3.js";
import { t as Icons } from "./icons-DqNOm4Um.js";
import { t as Toast } from "./Toast-B3itatf9.js";
import { useEffect, useState } from "react";
import { Link, notFound } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/prompts/$promptId.tsx?tsr-split=component
function PromptDetail() {
	const initial = Route.useLoaderData();
	const [prompt, setPrompt] = useState(null);
	const [toast, setToast] = useState(null);
	useEffect(() => {
		getPromptDetail({ data: { promptId: initial.promptId } }).then((result) => {
			if (!result) throw notFound();
			setPrompt(result);
		});
	}, [initial.promptId]);
	if (!prompt) return /* @__PURE__ */ jsx("main", {
		className: "detail-page",
		children: "Loading prompt..."
	});
	return /* @__PURE__ */ jsxs("main", {
		className: "detail-page",
		children: [
			/* @__PURE__ */ jsxs(Link, {
				to: "/",
				className: "back-link",
				children: [/* @__PURE__ */ jsx(Icons.ChevronRight, {}), " Back to gallery"]
			}),
			/* @__PURE__ */ jsxs("section", {
				className: "detail-layout",
				children: [/* @__PURE__ */ jsx("div", {
					className: "detail-media",
					children: /* @__PURE__ */ jsx("img", {
						src: prompt.image,
						alt: prompt.title
					})
				}), /* @__PURE__ */ jsxs("div", {
					className: "detail-copy",
					children: [
						/* @__PURE__ */ jsxs("p", {
							className: "mono kicker",
							children: [
								prompt.model,
								" · ",
								prompt.category
							]
						}),
						/* @__PURE__ */ jsx("h1", { children: prompt.title }),
						/* @__PURE__ */ jsx("p", { children: prompt.description }),
						/* @__PURE__ */ jsxs("div", {
							className: "detail-stats",
							children: [
								/* @__PURE__ */ jsxs("span", { children: ["★ ", prompt.rating] }),
								/* @__PURE__ */ jsxs("span", { children: [prompt.sold.toLocaleString(), " sold"] }),
								/* @__PURE__ */ jsxs("span", { children: ["Rank ", prompt.rankScore] }),
								/* @__PURE__ */ jsx("span", { children: prompt.creator })
							]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "detail-actions",
							children: [
								/* @__PURE__ */ jsx("strong", {
									className: prompt.price === 0 ? "free-price" : "",
									children: prompt.price === 0 ? "Free" : `$${prompt.price}`
								}),
								/* @__PURE__ */ jsx("button", {
									className: "btn-ink",
									onClick: async () => {
										await addToCartFn({ data: { promptId: prompt.id } });
										setToast({ text: "Added to Cart" });
									},
									children: "Add to Cart"
								}),
								/* @__PURE__ */ jsx("button", {
									className: "outline-btn",
									onClick: async () => {
										const result = await toggleFavoriteFn({ data: { promptId: prompt.id } });
										setPrompt({
											...prompt,
											isFavorite: result.isFavorite ? 1 : 0
										});
										setToast({ text: result.isFavorite ? "Saved to Favorites" : "Favorite removed" });
									},
									children: prompt.isFavorite ? "Saved" : "Save"
								})
							]
						})
					]
				})]
			}),
			/* @__PURE__ */ jsx(Toast, {
				toast,
				onDone: () => setToast(null)
			})
		]
	});
}
//#endregion
export { PromptDetail as component };
