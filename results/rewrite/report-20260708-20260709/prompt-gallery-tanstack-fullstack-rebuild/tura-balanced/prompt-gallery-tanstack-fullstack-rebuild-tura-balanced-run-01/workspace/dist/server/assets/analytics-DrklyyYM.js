import { t as Route } from "./analytics-C2eS6eKo.js";
import { t as AppShell } from "./AppShell-CuCLkH6E.js";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/analytics.tsx?tsr-split=component
function money(value) {
	return `$${value.toFixed(2)}`;
}
function AnalyticsRoute() {
	const { analytics, cart } = Route.useLoaderData();
	return /* @__PURE__ */ jsx(AppShell, {
		cartCount: cart.totals.itemCount,
		children: /* @__PURE__ */ jsxs("div", {
			className: "analytics-page",
			children: [
				/* @__PURE__ */ jsx("h1", { children: "Creator analytics" }),
				/* @__PURE__ */ jsxs("div", {
					className: "metric-grid",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "metric",
							children: [/* @__PURE__ */ jsx("div", {
								className: "k",
								children: "Revenue"
							}), /* @__PURE__ */ jsx("div", {
								className: "v",
								children: money(analytics.overview.revenue)
							})]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "metric",
							children: [/* @__PURE__ */ jsx("div", {
								className: "k",
								children: "Orders"
							}), /* @__PURE__ */ jsx("div", {
								className: "v",
								children: analytics.overview.orders
							})]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "metric",
							children: [/* @__PURE__ */ jsx("div", {
								className: "k",
								children: "Avg order"
							}), /* @__PURE__ */ jsx("div", {
								className: "v",
								children: money(analytics.overview.averageOrderValue)
							})]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "metric",
							children: [/* @__PURE__ */ jsx("div", {
								className: "k",
								children: "Conversion"
							}), /* @__PURE__ */ jsxs("div", {
								className: "v",
								children: [analytics.overview.conversionRate, "x"]
							})]
						})
					]
				}),
				/* @__PURE__ */ jsx("section", {
					className: "table",
					"aria-label": "Creator revenue",
					children: analytics.creatorRevenue.map((row) => /* @__PURE__ */ jsxs("div", { children: [
						/* @__PURE__ */ jsx("strong", { children: row.creator }),
						/* @__PURE__ */ jsx("span", { children: money(row.revenue) }),
						/* @__PURE__ */ jsxs("span", { children: [money(row.payout), " payout"] })
					] }, row.creator))
				}),
				/* @__PURE__ */ jsx("section", {
					className: "table",
					"aria-label": "Category revenue",
					children: analytics.categoryRevenue.map((row) => /* @__PURE__ */ jsxs("div", { children: [
						/* @__PURE__ */ jsx("strong", { children: row.category }),
						/* @__PURE__ */ jsx("span", { children: money(row.revenue) }),
						/* @__PURE__ */ jsxs("span", { children: [row.units, " units"] })
					] }, row.category))
				}),
				/* @__PURE__ */ jsx("section", {
					className: "table",
					"aria-label": "Daily sales trend",
					children: analytics.dailySales.map((row) => /* @__PURE__ */ jsxs("div", { children: [
						/* @__PURE__ */ jsx("strong", { children: row.day }),
						/* @__PURE__ */ jsx("span", { children: money(row.revenue) }),
						/* @__PURE__ */ jsxs("span", { children: [row.orders, " orders"] })
					] }, row.day))
				})
			]
		})
	});
}
//#endregion
export { AnalyticsRoute as component };
