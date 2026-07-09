import { c as Dock, o as putCart, u as Sidebar } from "./serverFns-o3k0et2Q.js";
import { t as Route } from "./prompts._promptId-Dm9cMMKM.js";
import { Link } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/prompts.$promptId.tsx?tsr-split=component
function money(c) {
	return c ? `$${(c / 100).toFixed(0)}` : "Free";
}
function PromptDetail() {
	const { prompt, shell } = Route.useLoaderData();
	if (!prompt) return /* @__PURE__ */ jsxs("div", {
		className: "app",
		children: [/* @__PURE__ */ jsx(Sidebar, {
			categories: shell.categories,
			counts: shell.counts
		}), /* @__PURE__ */ jsx("main", {
			className: "main",
			children: /* @__PURE__ */ jsx("div", {
				className: "empty",
				children: "Prompt not found."
			})
		})]
	});
	return /* @__PURE__ */ jsxs("div", {
		className: "app",
		children: [
			/* @__PURE__ */ jsx(Sidebar, {
				categories: shell.categories,
				counts: shell.counts
			}),
			/* @__PURE__ */ jsxs("main", {
				className: "main",
				children: [/* @__PURE__ */ jsx("div", {
					className: "topbar",
					children: /* @__PURE__ */ jsx(Link, {
						className: "ghost",
						to: "/",
						children: "Back to gallery"
					})
				}), /* @__PURE__ */ jsxs("section", {
					className: "detail",
					children: [/* @__PURE__ */ jsx("div", {
						className: "bigmedia",
						style: {
							"--a": prompt.a,
							"--b": prompt.b
						},
						children: /* @__PURE__ */ jsx("img", {
							src: prompt.image,
							alt: ""
						})
					}), /* @__PURE__ */ jsxs("article", {
						className: "panel",
						children: [
							/* @__PURE__ */ jsxs("p", {
								className: "mono",
								children: [
									prompt.model,
									" / ",
									prompt.category
								]
							}),
							/* @__PURE__ */ jsx("h1", { children: prompt.title }),
							/* @__PURE__ */ jsx("p", { children: prompt.summary }),
							/* @__PURE__ */ jsxs("div", {
								className: "row",
								children: [/* @__PURE__ */ jsx("span", { children: "Creator" }), /* @__PURE__ */ jsxs("strong", { children: [
									prompt.creator,
									" ",
									prompt.handle
								] })]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "row",
								children: [/* @__PURE__ */ jsx("span", { children: "Rating" }), /* @__PURE__ */ jsx("strong", { children: prompt.rating })]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "row",
								children: [/* @__PURE__ */ jsx("span", { children: "Sales" }), /* @__PURE__ */ jsx("strong", { children: prompt.sales })]
							}),
							/* @__PURE__ */ jsx("button", {
								className: "lime",
								onClick: () => putCart({ data: { id: prompt.id } }),
								children: prompt.price_cents ? `Add to Cart - ${money(prompt.price_cents)}` : "Get it free"
							})
						]
					})]
				})]
			}),
			/* @__PURE__ */ jsx(Dock, {})
		]
	});
}
//#endregion
export { PromptDetail as component };
