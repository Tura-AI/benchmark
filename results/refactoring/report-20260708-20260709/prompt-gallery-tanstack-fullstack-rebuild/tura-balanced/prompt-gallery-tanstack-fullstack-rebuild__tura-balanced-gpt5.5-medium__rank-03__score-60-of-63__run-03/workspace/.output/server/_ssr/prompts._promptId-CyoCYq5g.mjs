import { h as Link, v as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { t as FormatMoney } from "./FormatMoney-Bn-zIFbQ.mjs";
import { t as Route } from "./prompts._promptId-Bv4Hj3ZK.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/prompts._promptId-CyoCYq5g.js
var import_jsx_runtime = require_jsx_runtime();
function PromptDetail() {
	const prompt = Route.useLoaderData();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "detail-page",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
			href: "/",
			className: "back-link",
			children: "POWERPROMPT Gallery"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "detail-card",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "detail-media",
				style: { aspectRatio: prompt.aspect },
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
					src: prompt.image,
					alt: prompt.title
				})
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "detail-copy",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "model",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "d" }),
							prompt.model,
							" / ",
							prompt.category
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: prompt.title }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: prompt.description }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
						className: "stats",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Rating" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: prompt.rating.toFixed(1) })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Sold" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: prompt.sold.toLocaleString() })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Seller" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: prompt.creator })] })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "detail-buy",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormatMoney, { value: prompt.price }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: "/cart",
							className: "btn-ink",
							children: "Cart"
						})]
					})
				]
			})]
		})]
	});
}
//#endregion
export { PromptDetail as component };
