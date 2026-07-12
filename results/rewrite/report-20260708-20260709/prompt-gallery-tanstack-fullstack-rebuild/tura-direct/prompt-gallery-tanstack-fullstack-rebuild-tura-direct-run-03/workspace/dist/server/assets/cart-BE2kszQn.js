import { c as Dock, s as runCheckout, u as Sidebar } from "./serverFns-o3k0et2Q.js";
import { t as Route } from "./cart-kGnmoWDq.js";
import { useRouter } from "@tanstack/react-router";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/cart.tsx?tsr-split=component
var money = (c) => `$${(c / 100).toFixed(2)}`;
function CartPage() {
	const { cart, shell } = Route.useLoaderData();
	const router = useRouter();
	return /* @__PURE__ */ jsxs("div", {
		className: "app",
		children: [
			/* @__PURE__ */ jsx(Sidebar, {
				categories: shell.categories,
				counts: shell.counts
			}),
			/* @__PURE__ */ jsxs("main", {
				className: "main",
				children: [/* @__PURE__ */ jsx("header", {
					className: "topbar",
					children: /* @__PURE__ */ jsxs("section", {
						className: "hero",
						children: [/* @__PURE__ */ jsx("h1", { children: "Cart" }), /* @__PURE__ */ jsx("p", { children: "Checkout simulation uses the local database subtotal, marketplace fee, and total calculations." })]
					})
				}), /* @__PURE__ */ jsx("section", {
					className: "panel",
					children: cart.items.length ? /* @__PURE__ */ jsxs(Fragment, { children: [
						/* @__PURE__ */ jsx("div", {
							className: "cart-list",
							children: cart.items.map((i) => /* @__PURE__ */ jsxs("div", {
								className: "row",
								children: [/* @__PURE__ */ jsxs("span", { children: [
									i.title,
									/* @__PURE__ */ jsx("br", {}),
									/* @__PURE__ */ jsxs("small", { children: [
										i.creator,
										" × ",
										i.qty
									] })
								] }), /* @__PURE__ */ jsx("strong", { children: money(i.price_cents * i.qty) })]
							}, i.id))
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "row",
							children: [/* @__PURE__ */ jsx("span", { children: "Subtotal" }), /* @__PURE__ */ jsx("strong", { children: money(cart.subtotal) })]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "row",
							children: [/* @__PURE__ */ jsx("span", { children: "Marketplace fee" }), /* @__PURE__ */ jsx("strong", { children: money(cart.fee) })]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "row",
							children: [/* @__PURE__ */ jsx("span", { children: "Total" }), /* @__PURE__ */ jsx("strong", { children: money(cart.total) })]
						}),
						/* @__PURE__ */ jsx("button", {
							className: "lime",
							onClick: async () => {
								await runCheckout();
								await router.invalidate();
							},
							children: "Complete checkout"
						})
					] }) : /* @__PURE__ */ jsx("div", {
						className: "empty",
						children: "Your Cart is empty."
					})
				})]
			}),
			/* @__PURE__ */ jsx(Dock, {})
		]
	});
}
//#endregion
export { CartPage as component };
