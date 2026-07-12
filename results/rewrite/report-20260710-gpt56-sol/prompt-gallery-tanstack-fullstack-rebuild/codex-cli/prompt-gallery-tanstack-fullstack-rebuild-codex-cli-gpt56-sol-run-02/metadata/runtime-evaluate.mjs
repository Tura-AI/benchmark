import { chromium } from "playwright";
const port = Number(process.argv[2]);
const screenshot = process.argv[3];
const browser = await chromium.launch({ headless: true });
async function scan(name, viewport, screenshotPath) {
  const page = await browser.newPage({ viewport });
  const started = performance.now();
  await page.goto("http://127.0.0.1:" + port, { waitUntil: "networkidle", timeout: 60_000 });
  const loadMs = Math.round(performance.now() - started);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const data = await page.evaluate(() => {
    const bodyText = document.body.innerText || "";
    const overflow = document.documentElement.scrollWidth > window.innerWidth + 2;
    const controls = [...document.querySelectorAll("button,a,input,select,textarea")];
    const images = [...document.images].map((img) => ({ src: img.currentSrc || img.src, complete: img.complete, width: img.naturalWidth, height: img.naturalHeight }));
    const perf = performance.getEntriesByType("navigation")[0];
    const styles = [...document.querySelectorAll("*")].slice(0, 400).map((el) => {
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        bg: cs.backgroundColor,
        bgImage: cs.backgroundImage,
        color: cs.color,
        font: cs.fontFamily,
        radius: cs.borderRadius,
        shadow: cs.boxShadow,
        border: cs.borderColor,
        display: cs.display,
        position: cs.position,
        opacity: cs.opacity,
        transform: cs.transform,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
      };
    });
    const colorSet = new Set(styles.flatMap((item) => [item.bg, item.color]).filter((value) => value && value !== "rgba(0, 0, 0, 0)"));
    const fontSet = new Set(styles.map((item) => item.font).filter(Boolean));
    const h1 = document.querySelector("h1");
    const hero = h1?.closest("section,main,header,div");
    const heroRect = hero?.getBoundingClientRect();
    const articles = [...document.querySelectorAll("article")].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 40 && rect.height > 40;
    });
    const cards = articles.map((el) => {
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { width: Math.round(rect.width), height: Math.round(rect.height), radius: cs.borderRadius, shadow: cs.boxShadow };
    });
    const firstViewportElements = styles.filter((item) => item.top < window.innerHeight && item.width > 8 && item.height > 8);
    const richBackgrounds = styles.filter((item) => item.bgImage && item.bgImage !== "none").length;
    const decorativeSurfaces = styles.filter((item) =>
      (item.bg && item.bg !== "rgba(0, 0, 0, 0)") ||
      (item.bgImage && item.bgImage !== "none") ||
      (item.shadow && item.shadow !== "none") ||
      (item.radius && item.radius !== "0px")
    ).length;
    const h1Style = h1 ? getComputedStyle(h1) : null;
    const identityTerms = ["POWERPROMPT", "GPT-4o", "Claude", "Midjourney", "Flux", "Featured", "Newest", "Popular", "Favorites", "Cart"];
    const lowerText = bodyText.toLowerCase();
    const unlabeledControls = controls.filter((el) => {
      const text = (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
      return !text && !el.closest("label");
    }).length;
    return {
      title: document.title,
      body_chars: bodyText.length,
      heading_count: document.querySelectorAll("h1,h2,h3").length,
      h1_text_chars: (h1?.innerText || "").trim().length,
      interactive_count: controls.length,
      unlabeled_controls: unlabeledControls,
      image_count: images.length,
      broken_images: images.filter((img) => !img.complete || img.width === 0).length,
      horizontal_overflow: overflow,
      dom_nodes: document.querySelectorAll("*").length,
      section_count: document.querySelectorAll("section,article,aside,header,footer,main").length,
      article_count: articles.length,
      nav_count: document.querySelectorAll("nav,aside,header").length,
      button_count: document.querySelectorAll("button").length,
      link_count: document.querySelectorAll("a[href]").length,
      form_field_count: document.querySelectorAll("input,select,textarea").length,
      visible_svg_count: [...document.querySelectorAll("svg")].filter((el) => el.getBoundingClientRect().width > 4).length,
      color_count: colorSet.size,
      font_count: fontSet.size,
      shadow_count: styles.filter((item) => item.shadow && item.shadow !== "none").length,
      radius_count: styles.filter((item) => item.radius && item.radius !== "0px").length,
      layout_count: styles.filter((item) => item.display === "grid" || item.display === "flex").length,
      rich_background_count: richBackgrounds,
      decorative_surface_count: decorativeSurfaces,
      first_viewport_surface_count: firstViewportElements.filter((item) =>
        (item.bg && item.bg !== "rgba(0, 0, 0, 0)") ||
        (item.bgImage && item.bgImage !== "none") ||
        (item.shadow && item.shadow !== "none")
      ).length,
      card_count: cards.length,
      card_min_height: cards.length ? Math.min(...cards.map((item) => item.height)) : 0,
      card_max_height: cards.length ? Math.max(...cards.map((item) => item.height)) : 0,
      card_height_delta: cards.length ? Math.max(...cards.map((item) => item.height)) - Math.min(...cards.map((item) => item.height)) : 0,
      card_min_width: cards.length ? Math.min(...cards.map((item) => item.width)) : 0,
      h1_font_px: h1Style ? Number.parseFloat(h1Style.fontSize) : 0,
      identity_term_count: identityTerms.filter((term) => lowerText.includes(term.toLowerCase())).length,
      hero_height: heroRect ? Math.round(heroRect.height) : 0,
      hero_top: heroRect ? Math.round(heroRect.top) : null,
      viewport_width: window.innerWidth,
      scroll_height: document.documentElement.scrollHeight,
      transfer_size: Math.round((performance.getEntriesByType("resource") || []).reduce((sum, item) => sum + (item.transferSize || 0), 0)),
      resource_count: performance.getEntriesByType("resource").length,
      dom_content_loaded_ms: perf ? Math.round(perf.domContentLoadedEventEnd) : null,
    };
  });
  await page.close();
  return { name, load_ms: loadMs, screenshot: screenshotPath, ...data };
}
const mobileScreenshot = screenshot.replace(/[^/\\]+$/, "mobile.png");
const desktop = await scan("desktop", { width: 1440, height: 980 }, screenshot);
const mobile = await scan("mobile", { width: 390, height: 844 }, mobileScreenshot);
await browser.close();
console.log(JSON.stringify({
  pass: desktop.body_chars > 500 && mobile.body_chars > 500 && !desktop.horizontal_overflow && !mobile.horizontal_overflow,
  load_ms: desktop.load_ms,
  screenshot,
  screenshots_dir: screenshot.replace(/[/\\][^/\\]+$/, ""),
  desktop,
  mobile,
  body_chars: desktop.body_chars,
  heading_count: desktop.heading_count,
  interactive_count: desktop.interactive_count,
  image_count: desktop.image_count,
  broken_images: desktop.broken_images + mobile.broken_images,
  horizontal_overflow: desktop.horizontal_overflow || mobile.horizontal_overflow,
  dom_nodes: desktop.dom_nodes,
  transfer_size: desktop.transfer_size,
  dom_content_loaded_ms: desktop.dom_content_loaded_ms,
}, null, 2));
