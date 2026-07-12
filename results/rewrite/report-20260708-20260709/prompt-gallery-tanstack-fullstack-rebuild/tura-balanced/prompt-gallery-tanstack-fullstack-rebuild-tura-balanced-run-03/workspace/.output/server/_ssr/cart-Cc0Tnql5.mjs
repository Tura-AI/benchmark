import { _ as useRouter, v as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as checkoutCart, s as removePromptFromCart } from "./server-Cp9Zv1gM.mjs";
import { t as FormatMoney } from "./FormatMoney-Bn-zIFbQ.mjs";
import { t as Route } from "./cart-Dc0eYN_R.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/cart-Cc0Tnql5.js
var import_jsx_runtime = require_jsx_runtime();
function CartPage() {
	const cart = Route.useLoaderData();
	const router = useRouter();
	async function remove(promptId) {
		await removePromptFromCart({ data: { promptId } });
		await router.invalidate();
	}
	async function checkout() {
		if (!cart.count) return;
		await checkoutCart();
		await router.invalidate();
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "cart-page",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
			className: "back-link",
			href: "/",
			children: "POWERPROMPT Gallery"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "cart-panel",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "Cart" }),
				cart.items.length ? cart.items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
					className: "cart-row",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
							src: item.image,
							alt: ""
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: item.title }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
							item.model,
							" / ",
							item.category
						] })] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormatMoney, { value: item.lineTotal }) }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							onClick: () => remove(item.id),
							children: "Remove"
						})
					]
				}, item.id)) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "empty-copy",
					children: "Your cart is empty."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "cart-totals",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["Subtotal ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormatMoney, { value: cart.subtotal }) })] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["Platform fee ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormatMoney, { value: cart.fee }) })] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["Total ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormatMoney, { value: cart.total }) })] })
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "checkout",
					onClick: checkout,
					disabled: !cart.count,
					children: "Checkout simulation"
				})
			]
		})]
	});
}
//#endregion
export { CartPage as component };
