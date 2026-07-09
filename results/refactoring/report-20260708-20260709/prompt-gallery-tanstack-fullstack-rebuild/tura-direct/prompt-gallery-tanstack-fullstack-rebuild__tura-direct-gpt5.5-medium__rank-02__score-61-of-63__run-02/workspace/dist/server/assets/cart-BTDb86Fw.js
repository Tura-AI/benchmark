import { n as checkoutAction, s as removeCartAction } from "./functions-BOKx17ep.js";
import { t as Route } from "./cart-D_cpRbKK.js";
import { n as money } from "./PromptCard-DKVUoNlI.js";
import { useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/cart.tsx?tsr-split=component
function CartRoute() {
	const cart = Route.useLoaderData();
	const router = useRouter();
	const [notice, setNotice] = useState("");
	return /* @__PURE__ */ jsxs("section", {
		className: "cart",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "panel",
			children: [
				/* @__PURE__ */ jsx("p", {
					className: "eyebrow mono",
					children: "Cart and checkout simulation"
				}),
				/* @__PURE__ */ jsx("h1", { children: "Cart" }),
				cart.items.length ? cart.items.map((item) => /* @__PURE__ */ jsxs("div", {
					className: "cart-row",
					children: [
						/* @__PURE__ */ jsx("img", {
							src: item.image,
							alt: ""
						}),
						/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("b", { children: item.title }), /* @__PURE__ */ jsxs("p", {
							className: "desc",
							children: [
								item.model,
								" · ",
								item.creator,
								" · Qty ",
								item.quantity
							]
						})] }),
						/* @__PURE__ */ jsx("button", {
							className: "ghost",
							onClick: async () => {
								await removeCartAction({ data: item.id });
								router.invalidate();
							},
							children: "Remove"
						})
					]
				}, item.id)) : /* @__PURE__ */ jsx("p", { children: "Your Cart is empty. Save a Featured prompt or return to Popular prompts." }),
				/* @__PURE__ */ jsxs("div", {
					className: "totals",
					children: [
						/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "Subtotal" }), /* @__PURE__ */ jsx("b", { children: money(cart.totals.subtotalCents) })] }),
						/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "Marketplace fee" }), /* @__PURE__ */ jsx("b", { children: money(cart.totals.feeCents) })] }),
						/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "Total" }), /* @__PURE__ */ jsx("b", { children: money(cart.totals.totalCents) })] }),
						/* @__PURE__ */ jsx("button", {
							className: "primary",
							disabled: !cart.items.length,
							onClick: async () => {
								const res = await checkoutAction();
								setNotice(res.ok ? `Checkout complete: ${res.orderId}` : "Cart is empty");
								router.invalidate();
							},
							children: "Checkout"
						}),
						/* @__PURE__ */ jsx(Link, {
							className: "ghost",
							to: "/",
							children: "Continue shopping"
						})
					]
				})
			]
		}), notice ? /* @__PURE__ */ jsx("div", {
			role: "status",
			className: "toast",
			children: notice
		}) : null]
	});
}
//#endregion
export { CartRoute as component };
