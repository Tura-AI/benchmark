import { c as Dock, o as putCart, t as favoritePrompt, u as Sidebar } from "./serverFns-o3k0et2Q.js";
import { t as Route } from "./routes-DvAczL0M.js";
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/index.tsx?tsr-split=component
function money(c) {
	return c ? `$${(c / 100).toFixed(0)}` : "Free";
}
function Storefront() {
	const data = Route.useLoaderData();
	const search = Route.useSearch();
	const nav = useNavigate({ from: "/" });
	const [drawer, setDrawer] = useState(false), [toast, setToast] = useState(""), [preview, setPreview] = useState(null);
	const go = (patch) => nav({ search: (old) => ({
		...old,
		...patch
	}) });
	const flash = (msg) => {
		setToast(msg);
		window.setTimeout(() => setToast(""), 1800);
	};
	return /* @__PURE__ */ jsxs("div", {
		className: "app",
		children: [
			/* @__PURE__ */ jsx(Sidebar, {
				open: drawer,
				onClose: () => setDrawer(false),
				categories: data.categories,
				counts: data.counts
			}),
			/* @__PURE__ */ jsxs("main", {
				className: "main",
				children: [/* @__PURE__ */ jsxs("header", {
					className: "topbar",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "mobile-row",
							children: [/* @__PURE__ */ jsx("button", {
								className: "burger",
								onClick: () => setDrawer(true),
								children: "Menu"
							}), /* @__PURE__ */ jsx("strong", { children: "POWERPROMPT" })]
						}),
						/* @__PURE__ */ jsxs("section", {
							className: "hero",
							children: [/* @__PURE__ */ jsxs("h1", { children: [
								"Prompt",
								/* @__PURE__ */ jsx("br", {}),
								"Gallery"
							] }), /* @__PURE__ */ jsx("p", { children: "Image-led prompt packs ranked from marketplace activity, with saved favorites, cart checkout, and creator sales data." })]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "toolbar",
							children: [
								/* @__PURE__ */ jsx("div", {
									className: "tabs",
									role: "tablist",
									children: [
										"all",
										"GPT-4o",
										"Claude",
										"Midjourney",
										"Flux"
									].map((m) => /* @__PURE__ */ jsx("button", {
										className: `tab ${search.model === m || !search.model && m === "all" ? "active" : ""}`,
										onClick: () => go({ model: m }),
										children: m === "all" ? "Featured" : m
									}, m))
								}),
								/* @__PURE__ */ jsx("div", {
									className: "sorts",
									children: [
										"featured",
										"newest",
										"popular"
									].map((s) => /* @__PURE__ */ jsx("button", {
										className: `sort ${search.sort === s ? "active" : ""}`,
										onClick: () => go({ sort: s }),
										children: s[0].toUpperCase() + s.slice(1)
									}, s))
								}),
								/* @__PURE__ */ jsxs("label", {
									className: "search",
									children: [/* @__PURE__ */ jsx("span", { children: "Search" }), /* @__PURE__ */ jsx("input", {
										value: search.q ?? "",
										onChange: (e) => go({ q: e.target.value }),
										placeholder: "cream, Flux, Claude"
									})]
								})
							]
						})
					]
				}), data.prompts.length ? /* @__PURE__ */ jsx("section", {
					className: "grid",
					"aria-label": "Prompt cards",
					children: data.prompts.map((p) => /* @__PURE__ */ jsxs("article", {
						className: "card",
						children: [/* @__PURE__ */ jsxs(Link, {
							to: "/prompts/$promptId",
							params: { promptId: p.id },
							children: [/* @__PURE__ */ jsxs("div", {
								className: "media",
								style: {
									"--ratio": p.ratio,
									"--a": p.a,
									"--b": p.b
								},
								children: [/* @__PURE__ */ jsx("img", {
									src: p.image,
									alt: ""
								}), /* @__PURE__ */ jsxs("div", {
									className: "overlay",
									children: [/* @__PURE__ */ jsx("button", {
										className: "mini",
										type: "button",
										onClick: (e) => {
											e.preventDefault();
											setPreview(p);
										},
										children: "Preview"
									}), /* @__PURE__ */ jsx("button", {
										className: "mini",
										type: "button",
										onClick: async (e) => {
											e.preventDefault();
											await putCart({ data: { id: p.id } });
											flash(`Added ${p.title}`);
										},
										children: "Cart"
									})]
								})]
							}), /* @__PURE__ */ jsxs("div", {
								className: "body",
								children: [/* @__PURE__ */ jsx("h3", { children: p.title }), /* @__PURE__ */ jsxs("div", {
									className: "meta",
									children: [
										/* @__PURE__ */ jsx("span", { children: p.model }),
										/* @__PURE__ */ jsx("span", { children: p.category }),
										/* @__PURE__ */ jsx("span", { children: p.creator }),
										/* @__PURE__ */ jsx("span", {
											className: "price",
											children: money(p.price_cents)
										})
									]
								})]
							})]
						}), /* @__PURE__ */ jsx("button", {
							className: "mini",
							"aria-label": "Toggle favorite",
							onClick: async () => {
								await favoritePrompt({ data: { id: p.id } });
								flash(p.favorite ? "Removed from Favorites" : "Saved to Favorites");
							},
							children: p.favorite ? "Saved" : "Save"
						})]
					}, p.id))
				}) : /* @__PURE__ */ jsx("div", {
					className: "empty",
					children: "No prompts match these filters."
				})]
			}),
			/* @__PURE__ */ jsx(Dock, {}),
			toast && /* @__PURE__ */ jsx("div", {
				className: "toast",
				role: "status",
				children: toast
			}),
			preview && /* @__PURE__ */ jsx("div", {
				className: "modal",
				onClick: () => setPreview(null),
				children: /* @__PURE__ */ jsxs("div", {
					className: "modal-card",
					onClick: (e) => e.stopPropagation(),
					children: [/* @__PURE__ */ jsx("button", {
						className: "close",
						onClick: () => setPreview(null),
						children: "×"
					}), /* @__PURE__ */ jsxs("div", {
						className: "detail",
						children: [/* @__PURE__ */ jsx("div", {
							className: "bigmedia",
							style: {
								"--a": preview.a,
								"--b": preview.b
							},
							children: /* @__PURE__ */ jsx("img", {
								src: preview.image,
								alt: ""
							})
						}), /* @__PURE__ */ jsxs("section", {
							className: "panel",
							children: [
								/* @__PURE__ */ jsxs("p", {
									className: "mono",
									children: [
										preview.model,
										" / ",
										preview.category
									]
								}),
								/* @__PURE__ */ jsx("h1", { children: preview.title }),
								/* @__PURE__ */ jsx("p", { children: preview.summary }),
								/* @__PURE__ */ jsx("button", {
									className: "lime",
									onClick: async () => {
										await putCart({ data: { id: preview.id } });
										flash("Added to Cart");
										setPreview(null);
									},
									children: preview.price_cents ? "Add to Cart" : "Get it free"
								})
							]
						})]
					})]
				})
			})
		]
	});
}
//#endregion
export { Storefront as component };
