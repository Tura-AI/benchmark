import { i as Price, n as useToast } from "./Toast-BeHSCiBQ.js";
import { a as toggleFavoriteServer, t as addToCartServer } from "./market-api-BGNTLaER.js";
import { useMemo, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { ArrowRight, Bookmark, ShoppingBag } from "lucide-react";
//#region src/components/Gallery.tsx
function imageUrl(prompt, width = 720) {
	const [w, h] = prompt.aspect.split("/").map(Number);
	return `https://picsum.photos/seed/${prompt.imageSeed}/${width}/${Math.round(width * h / w)}`;
}
function fmt(n) {
	return n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(".0", "")}k` : String(n);
}
function Gallery({ prompts }) {
	const columns = useMemo(() => {
		const out = [
			[],
			[],
			[],
			[],
			[]
		];
		prompts.forEach((prompt, index) => out[index % out.length].push(prompt));
		return out;
	}, [prompts]);
	if (!prompts.length) return /* @__PURE__ */ jsxs("div", {
		className: "empty",
		children: [/* @__PURE__ */ jsx("div", {
			className: "big",
			children: "Nothing here yet"
		}), /* @__PURE__ */ jsx("div", { children: "Try a different filter or search." })]
	});
	return /* @__PURE__ */ jsx("div", {
		className: "masonry",
		children: columns.map((column, index) => /* @__PURE__ */ jsx("div", {
			className: "ms-col",
			children: column.map((prompt) => /* @__PURE__ */ jsx(PromptTile, { prompt }, prompt.id))
		}, index))
	});
}
function PromptTile({ prompt }) {
	const [favorite, setFavorite] = useState(Boolean(prompt.favorite));
	const router = useRouter();
	const { showToast } = useToast();
	async function save(event) {
		event.preventDefault();
		event.stopPropagation();
		const next = await toggleFavoriteServer({ data: prompt.id });
		setFavorite(next.favorite);
		showToast(next.favorite ? "Saved to favorites" : "Removed from favorites");
		router.invalidate();
	}
	async function cart(event) {
		event.preventDefault();
		event.stopPropagation();
		await addToCartServer({ data: prompt.id });
		showToast(`Added - ${prompt.title}`);
		router.invalidate();
	}
	return /* @__PURE__ */ jsxs(Link, {
		className: `tile ${favorite ? "saved" : ""}`,
		to: "/prompts/$promptId",
		params: { promptId: String(prompt.id) },
		style: { "--ar": prompt.aspect },
		children: [
			/* @__PURE__ */ jsx("div", {
				className: "savedmark",
				children: /* @__PURE__ */ jsx(Bookmark, {})
			}),
			/* @__PURE__ */ jsx("div", {
				className: "media",
				children: /* @__PURE__ */ jsx("img", {
					src: imageUrl(prompt),
					alt: prompt.title,
					loading: "lazy"
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
						className: `bm ${favorite ? "on" : ""}`,
						onClick: save,
						"aria-label": favorite ? "Unsave prompt" : "Save prompt",
						children: /* @__PURE__ */ jsx(Bookmark, {})
					})]
				}), /* @__PURE__ */ jsxs("div", { children: [
					/* @__PURE__ */ jsx("h3", { children: prompt.title }),
					/* @__PURE__ */ jsxs("p", { children: [
						prompt.category,
						" · ",
						prompt.creator,
						" · ",
						fmt(prompt.sold),
						" sold"
					] }),
					/* @__PURE__ */ jsxs("div", {
						className: "ov__row",
						children: [/* @__PURE__ */ jsx(Price, { price: prompt.price }), /* @__PURE__ */ jsxs("button", {
							className: "add",
							onClick: cart,
							children: ["Add ", /* @__PURE__ */ jsx(ArrowRight, {})]
						})]
					})
				] })]
			})
		]
	});
}
function PromptPreview({ prompt }) {
	const router = useRouter();
	const { showToast } = useToast();
	return /* @__PURE__ */ jsx("section", {
		className: "lb open inline",
		children: /* @__PURE__ */ jsxs("div", {
			className: "lb__card",
			children: [/* @__PURE__ */ jsx("div", {
				className: "lb__img",
				children: /* @__PURE__ */ jsx("img", {
					src: imageUrl(prompt, 900),
					alt: prompt.title
				})
			}), /* @__PURE__ */ jsxs("div", {
				className: "lb__info",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "model",
						children: [
							/* @__PURE__ */ jsx("span", { className: "d" }),
							prompt.model,
							" · ",
							prompt.category
						]
					}),
					/* @__PURE__ */ jsx("h2", { children: prompt.title }),
					/* @__PURE__ */ jsx("p", {
						className: "desc",
						children: prompt.description
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "stats",
						children: [
							/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
								className: "k",
								children: "Rating"
							}), /* @__PURE__ */ jsxs("div", {
								className: "v",
								children: ["★ ", prompt.rating]
							})] }),
							/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
								className: "k",
								children: "Sold"
							}), /* @__PURE__ */ jsx("div", {
								className: "v",
								children: fmt(prompt.sold)
							})] }),
							/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
								className: "k",
								children: "Seller"
							}), /* @__PURE__ */ jsx("div", {
								className: "v",
								children: prompt.creator
							})] })
						]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "lb__buy",
						children: [/* @__PURE__ */ jsx(Price, { price: prompt.price }), /* @__PURE__ */ jsxs("button", {
							className: "add",
							onClick: async () => {
								await addToCartServer({ data: prompt.id });
								showToast(`Added - ${prompt.title}`);
								router.invalidate();
							},
							children: [
								/* @__PURE__ */ jsx(ShoppingBag, {}),
								" ",
								prompt.price === 0 ? "Get it free" : "Add to cart"
							]
						})]
					})
				]
			})]
		})
	});
}
//#endregion
export { PromptPreview as n, Gallery as t };
