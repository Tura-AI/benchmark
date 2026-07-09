import { jsx } from "react/jsx-runtime";
import { C as CartPage } from "./CartPage-CXOMPmEy.js";
import { b as Route } from "./router-Dz0Qc7P8.js";
import "@tanstack/react-router";
import "react";
import "../server.js";
import "node:async_hooks";
import "h3-v2";
import "@tanstack/router-core";
import "seroval";
import "@tanstack/history";
import "@tanstack/router-core/ssr/client";
import "@tanstack/router-core/ssr/server";
import "@tanstack/react-router/ssr/server";
import "zod";
import "./db-Dyq5Uycb.js";
import "better-sqlite3";
import "node:fs";
import "node:path";
const SplitComponent = () => /* @__PURE__ */ jsx(CartPage, { initialCart: Route.useLoaderData() });
export {
  SplitComponent as component
};
