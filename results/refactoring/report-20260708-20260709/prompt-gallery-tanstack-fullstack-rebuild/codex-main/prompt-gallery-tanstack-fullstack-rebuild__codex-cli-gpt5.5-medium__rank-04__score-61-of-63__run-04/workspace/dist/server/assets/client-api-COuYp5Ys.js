//#region src/client-api.ts
async function postJson(url, body) {
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: body === void 0 ? void 0 : JSON.stringify(body)
	});
	if (!response.ok) throw new Error(await response.text());
	return response.json();
}
async function getJson(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(await response.text());
	return response.json();
}
//#endregion
export { postJson as n, getJson as t };
