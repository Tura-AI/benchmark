import { n as useToast } from "./useToast-DprI_C5-.js";
import { n as postJson } from "./client-api-COuYp5Ys.js";
import { t as Route } from "./cart-DKJFx6gC.js";
import { t as Chrome } from "./Chrome-DrR7oFgJ.js";
import { Link, useRouter } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { Trash2 } from "lucide-react";
//#region src/routes/cart.tsx?tsr-split=component
function CartPage() {
	const { cart, categories } = Route.useLoaderData();
	const router = useRouter();
	const toast = useToast();
	async function remove(promptId) {
		await postJson("/api/cart", {
			action: "remove",
			promptId
		});
		await router.invalidate();
		toast("Removed from cart");
	}
	async function checkout() {
		const result = await postJson("/api/cart", { action: "checkout" });
		await router.invalidate();
		toast(result.message);
	}
	return /* @__PURE__ */ jsx(Chrome, {
		categories,
		cartCount: cart.totals.count,
		children: /* @__PURE__ */ jsxs("section", {
			className: "checkout",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "page-head",
				children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h1", { children: "Cart" }), /* @__PURE__ */ jsx("p", {
					className: "desc",
					children: "Checkout simulation with database-calculated subtotal, fee, and total."
				})] }), /* @__PURE__ */ jsx(Link, {
					className: "secondary",
					to: "/",
					children: "Keep browsing"
				})]
			}), /* @__PURE__ */ jsxs("div", {
				className: "checkout-grid",
				children: [/* @__PURE__ */ jsx("div", {
					className: "cart-list",
					children: cart.items.length ? cart.items.map((item) => /* @__PURE__ */ jsxs("article", {
						className: "cart-item",
						children: [
							/* @__PURE__ */ jsx("img", {
								src: item.imageUrl,
								alt: ""
							}),
							/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("b", { children: item.title }), /* @__PURE__ */ jsxs("div", {
								className: "desc",
								children: [
									item.model,
									" · ",
									item.category,
									" · ",
									item.creator,
									" · Qty ",
									item.quantity
								]
							})] }),
							/* @__PURE__ */ jsxs("div", {
								className: "price",
								children: [
									"$",
									item.lineTotal.toFixed(2),
									/* @__PURE__ */ jsx("button", {
										className: "save-btn",
										"aria-label": `Remove ${item.title}`,
										onClick: () => remove(item.id),
										children: /* @__PURE__ */ jsx(Trash2, { size: 15 })
									})
								]
							})
						]
					}, item.id)) : /* @__PURE__ */ jsx("div", {
						className: "panel",
						children: "Your cart is empty. Featured, Newest, Popular, Favorites, and Cart are all waiting in the dock."
					})
				}), /* @__PURE__ */ jsxs("aside", {
					className: "panel totals",
					children: [
						/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "Subtotal" }), /* @__PURE__ */ jsxs("b", { children: ["$", cart.totals.subtotal.toFixed(2)] })] }),
						/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "Marketplace fee" }), /* @__PURE__ */ jsxs("b", { children: ["$", cart.totals.fee.toFixed(2)] })] }),
						/* @__PURE__ */ jsxs("div", {
							className: "grand",
							children: [/* @__PURE__ */ jsx("span", { children: "Total" }), /* @__PURE__ */ jsxs("b", { children: ["$", cart.totals.total.toFixed(2)] })]
						}),
						/* @__PURE__ */ jsx("button", {
							className: "primary",
							disabled: !cart.items.length,
							onClick: checkout,
							children: "Checkout"
						})
					]
				})]
			})]
		})
	});
}
//#endregion
export { CartPage as component };
