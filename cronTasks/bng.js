const puppeteer = require("puppeteer");
const UserAgent = require("user-agents");
const Item = require("../models/item");

exports.run = async (url, categoryName) => {
  if (!url || !categoryName) throw new Error("url ve categoryName zorunlu.");

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const page = await browser.newPage();

  // UA & headers
  const ua = new UserAgent({ deviceCategory: "desktop" }).toString();
  await page.setUserAgent(ua);
  await page.setExtraHTTPHeaders({
    "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
  });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  await page.setViewport({ width: 1366, height: 768 });
  page.setDefaultNavigationTimeout(90000);
  page.setDefaultTimeout(90000);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });

    // ürünler
    await page.waitForSelector("[ins-product-price]", { timeout: 90000 });

    const items = await page.$$eval("[ins-product-price]", (products) =>
      products.map((p) => {
        const container = p.closest("[class*='item-']");
        const title =
          container?.querySelector("h2 a, h2, h3, .product-name")?.textContent
            .replace(/\s+/g, " ")
            .trim() || "Ürün adı bulunamadı";

        const price = p.getAttribute("ins-product-price");
        const salePrice = p.getAttribute("ins-product-sale-price");
        const finalPrice = salePrice && price !== salePrice ? salePrice : price;

        return { title, price: (finalPrice || "").trim() };
      })
    );

    for (const item of items) {
      if (!item.title || !item.price) continue;
      try {
        const product = new Item({
          siteName: "bynogame",
          categoryName,
          itemName: item.title,
          sellPrice: item.price, // ins-product-price → zaten numerik string
          url,
        });
        await product.save();
        console.log(`Kaydedildi: ${item.title} - ${item.price}`);
      } catch (err) {
        if (err?.code === 11000) {
          console.warn(`Duplicate, atlandı: ${item.title}`);
          continue;
        }
        console.error(`Kaydetme hatası (${item.title}):`, err?.message || err);
      }
    }
  } catch (err) {
    console.error("Bynogame scrape hatası:", err?.message || err);
  } finally {
    await browser.close();
  }
};
