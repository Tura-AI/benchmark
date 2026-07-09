import { i as Price, n as useToast } from "./Toast-BeHSCiBQ.js";
import { i as removeFromCartServer, r as checkoutServer } from "./market-api-BGNTLaER.js";
import { t as Route } from "./cart-Bi18NBQC.js";
import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { CheckCircle2, Trash2 } from "lucide-react";
//#region src/routes/cart.tsx?tsr-split=component
function CartPage() {
	const cart = Route.useLoaderData();
	const router = useRouter();
	const { showToast } = useToast();
	const [paid, setPaid] = useState(null);
	return /* @__PURE__ */ jsxs("div", {
		className: "commerce-page",
		children: [/* @__PURE__ */ jsxs("header", {
			className: "page-head",
			children: [/* @__PURE__ */ jsx("p", {
				className: "mono",
				children: "Cart"
			}), /* @__PURE__ */ jsx("h1", { children: "Review your POWERPROMPT stack" })]
		}), /* @__PURE__ */ jsxs("section", {
			className: "checkout-grid",
			children: [/* @__PURE__ */ jsx("div", {
				className: "cart-list",
				children: cart.items.length ? cart.items.map((item) => /* @__PURE__ */ jsxs("article", {
					className: "line-item",
					children: [
						/* @__PURE__ */ jsx("img", {
							src: `https://picsum.photos/seed/${item.imageSeed}/220/180`,
							alt: ""
						}),
						/* @__PURE__ */ jsxs("div", { children: [
							/* @__PURE__ */ jsx("p", {
								className: "model-pill",
								children: item.model
							}),
							/* @__PURE__ */ jsx("h3", { children: item.title }),
							/* @__PURE__ */ jsxs("p", { children: [
								item.category,
								" · ",
								item.creator
							] })
						] }),
						/* @__PURE__ */ jsx(Price, { price: item.price }),
						/* @__PURE__ */ jsx("button", {
							className: "icon-button",
							"aria-label": `Remove ${item.title}`,
							onClick: async () => {
								await removeFromCartServer({ data: item.id });
								showToast("Removed from cart");
								router.invalidate();
							},
							children: /* @__PURE__ */ jsx(Trash2, {})
						})
					]
				}, item.id)) : /* @__PURE__ */ jsxs("div", {
					className: "empty compact",
					children: [/* @__PURE__ */ jsx("div", {
						className: "big",
						children: "Your cart is empty"
					}), /* @__PURE__ */ jsx("div", { children: "Browse the gallery and add a paid or free prompt." })]
				})
			}), /* @__PURE__ */ jsxs("aside", {
				className: "summary-panel",
				children: [
					/* @__PURE__ */ jsx("h2", { children: "Checkout simulation" }),
					/* @__PURE__ */ jsxs("div", {
						className: "sum-row",
						children: [/* @__PURE__ */ jsx("span", { children: "Items" }), /* @__PURE__ */ jsx("b", { children: cart.totals.itemCount })]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "sum-row",
						children: [/* @__PURE__ */ jsx("span", { children: "Subtotal" }), /* @__PURE__ */ jsxs("b", { children: ["$", cart.totals.subtotal] })]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "sum-row",
						children: [/* @__PURE__ */ jsx("span", { children: "Platform fee" }), /* @__PURE__ */ jsxs("b", { children: ["$", cart.totals.platformFee] })]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "sum-row total",
						children: [/* @__PURE__ */ jsx("span", { children: "Total" }), /* @__PURE__ */ jsxs("b", { children: ["$", cart.totals.total] })]
					}),
					/* @__PURE__ */ jsxs("button", {
						className: "checkout-btn",
						disabled: !cart.items.length,
						onClick: async () => {
							const result = await checkoutServer();
							if (result.ok) {
								setPaid(result.orderId);
								showToast(`Order #${result.orderId} paid`);
							}
							router.invalidate();
						},
						children: [/* @__PURE__ */ jsx(CheckCircle2, {}), " Complete checkout"]
					}),
					paid && /* @__PURE__ */ jsxs("p", {
						className: "success-note",
						children: [
							"Order #",
							paid,
							" is recorded in analytics."
						]
					})
				]
			})]
		})]
	});
}
//#endregion
export { CartPage as component };
