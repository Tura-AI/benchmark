import { v as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { t as Route } from "./admin.analytics-BzyuSkkp.mjs";
import { t as FormatMoney } from "./FormatMoney-Bn-zIFbQ.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/admin.analytics-Bqp-ZSD7.js
var import_jsx_runtime = require_jsx_runtime();
function AnalyticsPage() {
	const analytics = Route.useLoaderData();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "analytics-page",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
				className: "back-link",
				href: "/",
				children: "POWERPROMPT Gallery"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "analytics-head",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "Creator analytics" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Total revenue" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormatMoney, { value: analytics.totalRevenue }) })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "AOV" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormatMoney, { value: analytics.averageOrderValue }) })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Conversion" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [analytics.conversionRate, "%"] })] })
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "analytics-grid",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "panel",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Creator revenue" }), analytics.creatorRevenue.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: row.creator }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormatMoney, { value: row.revenue }) })] }, row.creatorId))]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "panel",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Category totals" }), analytics.categoryRevenue.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: row.category }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormatMoney, { value: row.revenue }) })] }, row.category))]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "panel",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Daily sales" }), analytics.trend.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: row.date }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormatMoney, { value: row.revenue }),
							" (",
							row.change >= 0 ? "+" : "",
							row.change,
							")"
						] })] }, row.date))]
					})
				]
			})
		]
	});
}
//#endregion
export { AnalyticsPage as component };
