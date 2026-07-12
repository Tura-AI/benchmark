import { c as toggleFavoriteAction, t as addCartAction } from "./functions-BOKx17ep.js";
import { useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/components/PromptCard.tsx
var money = (cents) => cents === 0 ? "Free" : `$${(cents / 100).toFixed(0)}`;
function PromptCard({ prompt }) {
	const router = useRouter();
	const [favorite, setFavorite] = useState(Boolean(prompt.favorite));
	const [notice, setNotice] = useState("");
	return /* @__PURE__ */ jsxs("article", {
		className: "card",
		style: { ["--ratio"]: prompt.ratio },
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "media",
				children: [/* @__PURE__ */ jsx("img", {
					src: prompt.image,
					alt: `${prompt.title} preview`,
					loading: "lazy"
				}), /* @__PURE__ */ jsxs("div", {
					className: "overlay",
					children: [/* @__PURE__ */ jsx(Link, {
						to: "/prompts/$promptId",
						params: { promptId: prompt.id },
						children: "Preview"
					}), /* @__PURE__ */ jsx("button", {
						onClick: async () => {
							await addCartAction({ data: prompt.id });
							setNotice(`${prompt.title} added to Cart`);
							router.invalidate();
						},
						children: prompt.priceCents ? "Add" : "Get free"
					})]
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "card-body",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "meta mono",
						children: [
							/* @__PURE__ */ jsx("span", { children: prompt.model }),
							/* @__PURE__ */ jsx("span", { children: prompt.category }),
							prompt.featured ? /* @__PURE__ */ jsx("span", { children: "Featured" }) : null
						]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "title",
						children: [/* @__PURE__ */ jsx("h2", { children: prompt.title }), /* @__PURE__ */ jsx("span", {
							className: "price",
							children: money(prompt.priceCents)
						})]
					}),
					/* @__PURE__ */ jsx("p", {
						className: "desc",
						children: prompt.description
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "actions",
						children: [/* @__PURE__ */ jsx("button", {
							className: `fav ${favorite ? "on" : ""}`,
							"aria-pressed": favorite,
							onClick: async () => {
								const next = await toggleFavoriteAction({ data: prompt.id });
								setFavorite(next.favorite);
								setNotice(next.favorite ? "Saved to Favorites" : "Removed from Favorites");
							},
							children: favorite ? "Saved" : "Save"
						}), /* @__PURE__ */ jsx(Link, {
							to: "/prompts/$promptId",
							params: { promptId: prompt.id },
							children: "Detail"
						})]
					})
				]
			}),
			notice ? /* @__PURE__ */ jsx("div", {
				role: "status",
				className: "toast",
				children: notice
			}) : null
		]
	});
}
//#endregion
export { money as n, PromptCard as t };
