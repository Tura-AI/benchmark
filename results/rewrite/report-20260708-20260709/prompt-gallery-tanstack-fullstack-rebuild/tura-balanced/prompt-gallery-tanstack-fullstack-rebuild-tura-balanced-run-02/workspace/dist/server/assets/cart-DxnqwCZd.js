import { n as checkoutAction, s as removeCartAction } from "./marketplace-sbgQtYxN.js";
import { t as Route } from "./cart-BX88Wv0x.js";
import { t as Shell } from "./layout-2vooB8mZ.js";
import { useRouter } from "@tanstack/react-router";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region src/components/cart.tsx
function CartView({ cart }) {
	const router = useRouter();
	const money = (cents) => `$${(cents / 100).toFixed(2)}`;
	return /* @__PURE__ */ jsxs("section", {
		className: "checkout",
		children: [/* @__PURE__ */ jsx("h1", { children: "Cart" }), cart.items.length === 0 ? /* @__PURE__ */ jsx("p", {
			className: "desc",
			children: "Your cart is empty. Add a prompt from the gallery to start checkout."
		}) : /* @__PURE__ */ jsxs(Fragment, { children: [
			/* @__PURE__ */ jsx("div", {
				className: "list",
				children: cart.items.map((item) => /* @__PURE__ */ jsxs("div", {
					className: "line-item",
					children: [
						/* @__PURE__ */ jsx("img", {
							src: item.imageUrl,
							alt: ""
						}),
						/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("strong", { children: item.title }), /* @__PURE__ */ jsxs("div", {
							className: "k",
							children: [
								item.model,
								" · ",
								item.category,
								" · Qty ",
								item.quantity
							]
						})] }),
						/* @__PURE__ */ jsxs("div", { children: [
							/* @__PURE__ */ jsx("strong", { children: money(item.lineTotalCents) }),
							/* @__PURE__ */ jsx("br", {}),
							/* @__PURE__ */ jsx("button", {
								onClick: async () => {
									await removeCartAction({ data: { promptId: item.id } });
									router.invalidate();
								},
								children: "Remove"
							})
						] })
					]
				}, item.id))
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "total-row",
				children: [/* @__PURE__ */ jsx("span", { children: "Subtotal" }), /* @__PURE__ */ jsx("span", { children: money(cart.subtotalCents) })]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "total-row",
				children: [/* @__PURE__ */ jsx("span", { children: "Marketplace fee" }), /* @__PURE__ */ jsx("span", { children: money(cart.feeCents) })]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "total-row final",
				children: [/* @__PURE__ */ jsx("span", { children: "Total" }), /* @__PURE__ */ jsx("span", { children: money(cart.totalCents) })]
			}),
			/* @__PURE__ */ jsx("button", {
				className: "btn-ink",
				onClick: async () => {
					await checkoutAction();
					router.invalidate();
				},
				children: "Simulate checkout"
			})
		] })]
	});
}
//#endregion
//#region src/routes/cart.tsx?tsr-split=component
function CartRoute() {
	const data = Route.useLoaderData();
	return /* @__PURE__ */ jsx(Shell, {
		categories: data.shell.categories,
		cartCount: data.cart.count,
		children: /* @__PURE__ */ jsx(CartView, { cart: data.cart })
	});
}
//#endregion
export { CartRoute as component };
