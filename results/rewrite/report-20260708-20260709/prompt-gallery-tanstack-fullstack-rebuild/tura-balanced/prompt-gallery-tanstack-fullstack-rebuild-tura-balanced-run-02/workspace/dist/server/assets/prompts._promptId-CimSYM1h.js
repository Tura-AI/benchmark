import { c as toggleFavoriteAction, t as addCartAction } from "./marketplace-sbgQtYxN.js";
import { t as Route } from "./prompts._promptId-D9v8jyo8.js";
import { n as Toast, r as Icon, t as Shell } from "./layout-2vooB8mZ.js";
import { c as imageUrl } from "./queries-BkgkyYDi.js";
import { useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region src/components/detail.tsx
function PromptDetail({ prompt }) {
	const router = useRouter();
	const [toast, setToast] = useState("");
	const show = (message) => {
		setToast(message);
		window.setTimeout(() => setToast(""), 2100);
	};
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs("article", {
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
				/* @__PURE__ */ jsxs("span", {
					className: "model",
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
					className: "stats",
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
					children: [
						/* @__PURE__ */ jsx("span", {
							className: `price ${prompt.priceCents === 0 ? "free" : ""}`,
							children: prompt.priceCents === 0 ? "Free" : `$${prompt.priceCents / 100}`
						}),
						/* @__PURE__ */ jsx("button", {
							className: "bm on",
							"aria-label": "Favorite",
							onClick: async () => {
								await toggleFavoriteAction({ data: { promptId: prompt.id } });
								show("Favorite state updated");
								router.invalidate();
							},
							children: /* @__PURE__ */ jsx(Icon, { name: "heart" })
						}),
						/* @__PURE__ */ jsx("button", {
							className: "add",
							onClick: async () => {
								await addCartAction({ data: { promptId: prompt.id } });
								show(`Added — ${prompt.title}`);
								router.invalidate();
							},
							children: prompt.priceCents === 0 ? "Get it free" : "Add to cart"
						})
					]
				}),
				/* @__PURE__ */ jsx("p", { children: /* @__PURE__ */ jsx(Link, {
					to: "/",
					children: "Back to gallery"
				}) })
			]
		})]
	}), /* @__PURE__ */ jsx(Toast, { message: toast })] });
}
//#endregion
//#region src/routes/prompts.$promptId.tsx?tsr-split=component
function PromptRoute() {
	const data = Route.useLoaderData();
	const prompt = {
		...data.prompt,
		imageUrl: imageUrl(data.prompt.id, data.prompt.aspectRatio)
	};
	return /* @__PURE__ */ jsx(Shell, {
		categories: data.shell.categories,
		cartCount: data.cart.count,
		children: /* @__PURE__ */ jsx(PromptDetail, { prompt })
	});
}
//#endregion
export { PromptRoute as component };
