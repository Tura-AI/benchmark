import { c as toggleFavoriteAction, t as addCartAction } from "./functions-BOKx17ep.js";
import { t as Route } from "./prompts._promptId-BqtgXY8h.js";
import { n as money } from "./PromptCard-DKVUoNlI.js";
import { useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/prompts.$promptId.tsx?tsr-split=component
function PromptDetail() {
	const prompt = Route.useLoaderData();
	const router = useRouter();
	const [favorite, setFavorite] = useState(Boolean(prompt?.favorite));
	const [notice, setNotice] = useState("");
	if (!prompt) return /* @__PURE__ */ jsx("div", {
		className: "detail",
		children: /* @__PURE__ */ jsxs("div", {
			className: "panel",
			children: [/* @__PURE__ */ jsx("h1", { children: "Prompt not found" }), /* @__PURE__ */ jsx(Link, {
				to: "/",
				children: "Back to gallery"
			})]
		})
	});
	return /* @__PURE__ */ jsxs("section", {
		className: "detail",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "detail-grid",
			children: [/* @__PURE__ */ jsx("img", {
				src: prompt.image,
				alt: `${prompt.title} full preview`
			}), /* @__PURE__ */ jsxs("div", {
				className: "panel",
				children: [
					/* @__PURE__ */ jsxs("p", {
						className: "eyebrow mono",
						children: [
							prompt.model,
							" · ",
							prompt.category,
							" · ",
							prompt.featured ? "Featured" : "New prompt"
						]
					}),
					/* @__PURE__ */ jsx("h1", { children: prompt.title }),
					/* @__PURE__ */ jsx("p", { children: prompt.description }),
					/* @__PURE__ */ jsxs("p", { children: [
						/* @__PURE__ */ jsx("b", { children: money(prompt.priceCents) }),
						" by ",
						prompt.creator,
						" ",
						prompt.creatorHandle
					] }),
					/* @__PURE__ */ jsxs("p", {
						className: "desc",
						children: [
							"Creator focus: ",
							prompt.creatorSpecialty,
							". Rating ",
							prompt.rating,
							"; ",
							prompt.sales,
							" marketplace sales."
						]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "actions",
						children: [
							/* @__PURE__ */ jsx("button", {
								className: "primary",
								onClick: async () => {
									await addCartAction({ data: prompt.id });
									setNotice("Added to Cart");
									router.invalidate();
								},
								children: prompt.priceCents ? "Add to Cart" : "Get free"
							}),
							/* @__PURE__ */ jsx("button", {
								className: `fav ${favorite ? "on" : ""}`,
								"aria-pressed": favorite,
								onClick: async () => {
									const next = await toggleFavoriteAction({ data: prompt.id });
									setFavorite(next.favorite);
									setNotice(next.favorite ? "Saved to Favorites" : "Removed from Favorites");
								},
								children: favorite ? "Saved" : "Save"
							}),
							/* @__PURE__ */ jsx(Link, {
								to: "/",
								children: "Back"
							})
						]
					})
				]
			})]
		}), notice ? /* @__PURE__ */ jsx("div", {
			role: "status",
			className: "toast",
			children: notice
		}) : null]
	});
}
//#endregion
export { PromptDetail as component };
