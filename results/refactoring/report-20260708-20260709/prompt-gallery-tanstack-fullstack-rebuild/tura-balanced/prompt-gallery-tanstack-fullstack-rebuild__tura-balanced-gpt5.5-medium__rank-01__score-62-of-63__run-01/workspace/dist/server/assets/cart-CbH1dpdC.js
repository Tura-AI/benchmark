import { n as useToast } from "./toast-0CjHUAlA.js";
import { n as checkoutCartFn } from "./queries-BQK17jAu.js";
import { t as Route } from "./cart-0aIRoLtU.js";
import { n as Icons, t as AppShell } from "./AppShell-CuCLkH6E.js";
import { useNavigate } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/cart.tsx?tsr-split=component
function CartRoute() {
	const { cart } = Route.useLoaderData();
	const navigate = useNavigate();
	const { showToast } = useToast();
	const checkout = async () => {
		const result = await checkoutCartFn();
		showToast(result.ok ? `Checkout complete: ${result.orderId}` : "Your cart is empty");
		await navigate({
			to: "/cart",
			replace: true
		});
	};
	return /* @__PURE__ */ jsx(AppShell, {
		cartCount: cart.totals.itemCount,
		children: /* @__PURE__ */ jsxs("div", {
			className: "cart-page",
			children: [/* @__PURE__ */ jsx("h1", { children: "Cart" }), /* @__PURE__ */ jsxs("section", {
				className: "panel",
				children: [cart.items.length === 0 ? /* @__PURE__ */ jsxs("div", {
					className: "empty",
					children: [/* @__PURE__ */ jsx("div", {
						className: "big",
						children: "Your cart is empty"
					}), /* @__PURE__ */ jsx("div", { children: "Choose prompts from the gallery to build a checkout." })]
				}) : cart.items.map((item) => /* @__PURE__ */ jsxs("div", {
					className: "cart-row",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "cart-main",
							children: [/* @__PURE__ */ jsx("img", {
								src: item.imageUrl,
								alt: ""
							}), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("strong", { children: item.title }), /* @__PURE__ */ jsx("div", {
								className: "model",
								children: item.model
							})] })]
						}),
						/* @__PURE__ */ jsxs("span", { children: ["Qty ", item.quantity] }),
						/* @__PURE__ */ jsxs("strong", { children: ["$", item.lineTotal.toFixed(2)] })
					]
				}, item.id)), /* @__PURE__ */ jsxs("div", {
					className: "summary",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "stat-row",
							children: [/* @__PURE__ */ jsx("span", { children: "Subtotal" }), /* @__PURE__ */ jsxs("strong", { children: ["$", cart.totals.subtotal.toFixed(2)] })]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "stat-row",
							children: [/* @__PURE__ */ jsx("span", { children: "Marketplace fee" }), /* @__PURE__ */ jsxs("strong", { children: ["$", cart.totals.fee.toFixed(2)] })]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "stat-row",
							children: [/* @__PURE__ */ jsx("span", { children: "Total" }), /* @__PURE__ */ jsxs("strong", { children: ["$", cart.totals.total.toFixed(2)] })]
						}),
						/* @__PURE__ */ jsxs("button", {
							className: "btn-ink",
							type: "button",
							onClick: () => void checkout(),
							children: [/* @__PURE__ */ jsx(Icons.ShoppingBag, { size: 16 }), " Checkout simulation"]
						})
					]
				})]
			})]
		})
	});
}
//#endregion
export { CartRoute as component };
