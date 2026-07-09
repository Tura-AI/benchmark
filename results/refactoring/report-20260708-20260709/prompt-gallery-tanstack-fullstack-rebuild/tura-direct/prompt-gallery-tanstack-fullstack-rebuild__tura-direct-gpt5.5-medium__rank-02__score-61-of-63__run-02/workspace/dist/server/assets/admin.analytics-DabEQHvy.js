import { t as Route } from "./admin.analytics-CZLEwAWd.js";
import { n as money } from "./PromptCard-DKVUoNlI.js";
import { Link } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/admin.analytics.tsx?tsr-split=component
function AnalyticsRoute() {
	const data = Route.useLoaderData();
	return /* @__PURE__ */ jsx("section", {
		className: "analytics",
		children: /* @__PURE__ */ jsxs("div", {
			className: "panel",
			children: [
				/* @__PURE__ */ jsx("p", {
					className: "eyebrow mono",
					children: "Creator/admin analytics"
				}),
				/* @__PURE__ */ jsx("h1", { children: "Marketplace performance" }),
				/* @__PURE__ */ jsxs("div", {
					className: "analytics-grid",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "metric",
							children: [
								/* @__PURE__ */ jsx("span", { children: "Orders" }),
								/* @__PURE__ */ jsx("br", {}),
								/* @__PURE__ */ jsx("b", { children: data.summary.orders })
							]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "metric",
							children: [
								/* @__PURE__ */ jsx("span", { children: "Revenue" }),
								/* @__PURE__ */ jsx("br", {}),
								/* @__PURE__ */ jsx("b", { children: money(data.summary.grossCents) })
							]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "metric",
							children: [
								/* @__PURE__ */ jsx("span", { children: "Average order value" }),
								/* @__PURE__ */ jsx("br", {}),
								/* @__PURE__ */ jsx("b", { children: money(data.summary.averageOrderValueCents) })
							]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "metric",
							children: [
								/* @__PURE__ */ jsx("span", { children: "Conversion rate" }),
								/* @__PURE__ */ jsx("br", {}),
								/* @__PURE__ */ jsxs("b", { children: [data.summary.conversionRate, "%"] })
							]
						})
					]
				}),
				/* @__PURE__ */ jsx("h2", { children: "Creator revenue" }),
				data.creatorRevenue.map((row) => /* @__PURE__ */ jsxs("div", {
					className: "metric-row",
					children: [/* @__PURE__ */ jsxs("span", { children: [
						row.name,
						" ",
						row.handle
					] }), /* @__PURE__ */ jsx("b", { children: money(row.revenueCents) })]
				}, row.handle)),
				/* @__PURE__ */ jsx("h2", { children: "Category revenue" }),
				data.categoryRevenue.map((row) => /* @__PURE__ */ jsxs("div", {
					className: "metric-row",
					children: [/* @__PURE__ */ jsx("span", { children: row.name }), /* @__PURE__ */ jsx("b", { children: money(row.revenueCents) })]
				}, row.name)),
				/* @__PURE__ */ jsx("h2", { children: "Daily sales trend" }),
				data.dailySales.map((row) => /* @__PURE__ */ jsxs("div", {
					className: "metric-row",
					children: [/* @__PURE__ */ jsxs("span", { children: [
						row.day,
						" · ",
						row.orders,
						" order(s)"
					] }), /* @__PURE__ */ jsx("b", { children: money(row.totalCents) })]
				}, row.day)),
				/* @__PURE__ */ jsx(Link, {
					className: "ghost",
					to: "/",
					children: "Back to storefront"
				})
			]
		})
	});
}
//#endregion
export { AnalyticsRoute as component };
