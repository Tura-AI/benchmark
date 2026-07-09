import { t as Route } from "./cart-DpqfGVfd.js";
import { a as getCartFn, c as removeFromCartFn, n as checkoutFn } from "./market-CFU9gbvr.js";
import { t as Icons } from "./icons-DqNOm4Um.js";
import { t as Toast } from "./Toast-B3itatf9.js";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/cart.tsx?tsr-split=component
function CartPage() {
	const [cart, setCart] = useState(Route.useLoaderData());
	const [toast, setToast] = useState(null);
	useEffect(() => {
		getCartFn().then(setCart);
	}, []);
	return /* @__PURE__ */ jsxs("main", {
		className: "checkout-page",
		children: [
			/* @__PURE__ */ jsxs(Link, {
				to: "/",
				className: "back-link",
				children: [/* @__PURE__ */ jsx(Icons.ChevronRight, {}), " Continue shopping"]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "checkout-grid",
				children: [/* @__PURE__ */ jsxs("section", { children: [
					/* @__PURE__ */ jsx("p", {
						className: "mono kicker",
						children: "Cart"
					}),
					/* @__PURE__ */ jsx("h1", { children: "Cart and checkout" }),
					/* @__PURE__ */ jsx("div", {
						className: "cart-list",
						children: cart.items.length ? cart.items.map((item) => /* @__PURE__ */ jsxs("article", {
							className: "cart-item",
							children: [
								/* @__PURE__ */ jsx("img", {
									src: item.image,
									alt: item.title
								}),
								/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h3", { children: item.title }), /* @__PURE__ */ jsxs("p", { children: [
									item.model,
									" · ",
									item.creator,
									" · Qty ",
									item.quantity
								] })] }),
								/* @__PURE__ */ jsx("strong", { children: item.price === 0 ? "Free" : `$${item.lineTotal.toFixed(2)}` }),
								/* @__PURE__ */ jsx("button", {
									className: "icon-btn",
									"aria-label": `Remove ${item.title}`,
									onClick: async () => {
										setCart(await removeFromCartFn({ data: { promptId: item.id } }));
										setToast({ text: "Removed from Cart" });
									},
									children: /* @__PURE__ */ jsx(Icons.X, {})
								})
							]
						}, item.id)) : /* @__PURE__ */ jsxs("div", {
							className: "empty small",
							children: [/* @__PURE__ */ jsx("div", {
								className: "big",
								children: "Your Cart is empty"
							}), /* @__PURE__ */ jsx("p", { children: "Favorites and Featured prompts are waiting in the gallery." })]
						})
					})
				] }), /* @__PURE__ */ jsxs("aside", {
					className: "summary-panel",
					children: [
						/* @__PURE__ */ jsx("h2", { children: "Order summary" }),
						/* @__PURE__ */ jsxs("div", {
							className: "summary-row",
							children: [/* @__PURE__ */ jsx("span", { children: "Subtotal" }), /* @__PURE__ */ jsxs("strong", { children: ["$", cart.totals.subtotal.toFixed(2)] })]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "summary-row",
							children: [/* @__PURE__ */ jsx("span", { children: "Marketplace fee" }), /* @__PURE__ */ jsxs("strong", { children: ["$", cart.totals.platformFee.toFixed(2)] })]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "summary-row total",
							children: [/* @__PURE__ */ jsx("span", { children: "Total" }), /* @__PURE__ */ jsxs("strong", { children: ["$", cart.totals.total.toFixed(2)] })]
						}),
						/* @__PURE__ */ jsx("button", {
							className: "checkout-btn",
							disabled: !cart.items.length,
							onClick: async () => {
								const result = await checkoutFn();
								setCart(result.cart);
								setToast({ text: result.ok ? `Checkout complete: order #${result.orderId}` : "Cart is empty" });
							},
							children: "Simulate checkout"
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
export { CartPage as component };
