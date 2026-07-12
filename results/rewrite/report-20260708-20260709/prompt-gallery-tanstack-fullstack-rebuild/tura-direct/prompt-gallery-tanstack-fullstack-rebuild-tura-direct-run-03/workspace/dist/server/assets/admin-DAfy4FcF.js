import { c as Dock, u as Sidebar } from "./serverFns-o3k0et2Q.js";
import { t as Route } from "./admin-BJ2c5yM2.js";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/admin.tsx?tsr-split=component
var money = (c) => `$${(Number(c || 0) / 100).toFixed(0)}`;
function AdminPage() {
	const { analytics: a, shell } = Route.useLoaderData();
	return /* @__PURE__ */ jsxs("div", {
		className: "app",
		children: [
			/* @__PURE__ */ jsx(Sidebar, {
				categories: shell.categories,
				counts: shell.counts
			}),
			/* @__PURE__ */ jsxs("main", {
				className: "main",
				children: [
					/* @__PURE__ */ jsx("header", {
						className: "topbar",
						children: /* @__PURE__ */ jsxs("section", {
							className: "hero",
							children: [/* @__PURE__ */ jsxs("h1", { children: [
								"Creator",
								/* @__PURE__ */ jsx("br", {}),
								"Analytics"
							] }), /* @__PURE__ */ jsx("p", { children: "Revenue, conversion, average order value, category totals, and sales trends are calculated in SQLite queries." })]
						})
					}),
					/* @__PURE__ */ jsxs("section", {
						className: "kpis",
						children: [
							/* @__PURE__ */ jsxs("div", {
								className: "kpi",
								children: [/* @__PURE__ */ jsx("span", { children: "Revenue" }), /* @__PURE__ */ jsx("strong", { children: money(a.totals.revenue) })]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "kpi",
								children: [/* @__PURE__ */ jsx("span", { children: "Orders" }), /* @__PURE__ */ jsx("strong", { children: a.totals.orders })]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "kpi",
								children: [/* @__PURE__ */ jsx("span", { children: "Average order value" }), /* @__PURE__ */ jsx("strong", { children: money(a.totals.aov) })]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "kpi",
								children: [/* @__PURE__ */ jsx("span", { children: "Conversion rate" }), /* @__PURE__ */ jsxs("strong", { children: [a.conversion.rate, "%"] })]
							})
						]
					}),
					/* @__PURE__ */ jsx("h2", { children: "Creator revenue" }),
					/* @__PURE__ */ jsx("table", {
						className: "table",
						children: /* @__PURE__ */ jsx("tbody", { children: a.creators.map((r) => /* @__PURE__ */ jsxs("tr", { children: [
							/* @__PURE__ */ jsx("td", { children: r.name }),
							/* @__PURE__ */ jsxs("td", { children: [r.sales, " sales"] }),
							/* @__PURE__ */ jsx("td", { children: money(r.revenue) })
						] }, r.name)) })
					}),
					/* @__PURE__ */ jsx("h2", { children: "Category totals" }),
					/* @__PURE__ */ jsx("table", {
						className: "table",
						children: /* @__PURE__ */ jsx("tbody", { children: a.categories.map((r) => /* @__PURE__ */ jsxs("tr", { children: [/* @__PURE__ */ jsx("td", { children: r.name }), /* @__PURE__ */ jsx("td", { children: money(r.revenue) })] }, r.name)) })
					}),
					/* @__PURE__ */ jsx("h2", { children: "Daily trend" }),
					/* @__PURE__ */ jsx("table", {
						className: "table",
						children: /* @__PURE__ */ jsx("tbody", { children: a.trends.map((r) => /* @__PURE__ */ jsxs("tr", { children: [
							/* @__PURE__ */ jsx("td", { children: r.day }),
							/* @__PURE__ */ jsxs("td", { children: [r.orders, " orders"] }),
							/* @__PURE__ */ jsx("td", { children: money(r.revenue) })
						] }, r.day)) })
					})
				]
			}),
			/* @__PURE__ */ jsx(Dock, {})
		]
	});
}
//#endregion
export { AdminPage as component };
