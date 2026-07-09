import { t as Route } from "./admin-xZo6KPD8.js";
import { t as Chrome } from "./Chrome-DrR7oFgJ.js";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/admin.tsx?tsr-split=component
function AdminPage() {
	const { analytics, categories, cart } = Route.useLoaderData();
	return /* @__PURE__ */ jsx(Chrome, {
		categories,
		cartCount: cart.totals.count,
		children: /* @__PURE__ */ jsxs("section", {
			className: "admin",
			children: [
				/* @__PURE__ */ jsx("div", {
					className: "page-head",
					children: /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h1", { children: "Creator analytics" }), /* @__PURE__ */ jsx("p", {
						className: "desc",
						children: "Revenue, conversion, category totals, and daily sales are queried from SQLite."
					})] })
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "admin-grid",
					children: [
						/* @__PURE__ */ jsx(Metric, {
							label: "Gross revenue",
							value: `$${analytics.summary.grossRevenue.toFixed(2)}`
						}),
						/* @__PURE__ */ jsx(Metric, {
							label: "Orders",
							value: String(analytics.summary.orders)
						}),
						/* @__PURE__ */ jsx(Metric, {
							label: "Conversion",
							value: `${analytics.summary.conversionRate}%`
						}),
						/* @__PURE__ */ jsx(Metric, {
							label: "Average order value",
							value: `$${analytics.summary.averageOrderValue.toFixed(2)}`
						})
					]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "two-col",
					children: [/* @__PURE__ */ jsx(Table, {
						title: "Creator revenue",
						rows: analytics.creators,
						columns: [
							"name",
							"units",
							"creatorRevenue"
						],
						money: "creatorRevenue"
					}), /* @__PURE__ */ jsx(Table, {
						title: "Category revenue",
						rows: analytics.categories,
						columns: [
							"name",
							"units",
							"revenue"
						],
						money: "revenue"
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "two-col",
					children: [/* @__PURE__ */ jsx(Table, {
						title: "Daily sales",
						rows: analytics.daily,
						columns: [
							"day",
							"orders",
							"revenue"
						],
						money: "revenue"
					}), /* @__PURE__ */ jsx(Table, {
						title: "Model mix",
						rows: analytics.modelMix,
						columns: [
							"model",
							"units",
							"revenue"
						],
						money: "revenue"
					})]
				})
			]
		})
	});
}
function Metric({ label, value }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "metric",
		children: [/* @__PURE__ */ jsx("span", {
			className: "side-label",
			style: {
				padding: 0,
				margin: 0
			},
			children: label
		}), /* @__PURE__ */ jsx("b", { children: value })]
	});
}
function Table({ title, rows, columns, money }) {
	return /* @__PURE__ */ jsxs("section", {
		className: "panel",
		children: [/* @__PURE__ */ jsx("h2", { children: title }), /* @__PURE__ */ jsxs("table", {
			className: "table",
			children: [/* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsx("tr", { children: columns.map((column) => /* @__PURE__ */ jsx("th", { children: column }, column)) }) }), /* @__PURE__ */ jsx("tbody", { children: rows.map((row, index) => /* @__PURE__ */ jsx("tr", { children: columns.map((column) => /* @__PURE__ */ jsx("td", { children: column === money ? `$${Number(row[column]).toFixed(2)}` : row[column] }, column)) }, index)) })]
		})]
	});
}
//#endregion
export { AdminPage as component };
