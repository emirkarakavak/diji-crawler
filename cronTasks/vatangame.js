const puppeteer = require("puppeteer");
const Item = require("../models/item");

/**
 * Çok formatlı giriş desteği:
 * - scrapeVatanGame("https://...", "kategori")
 * - scrapeVatanGame(["https://...", "https://..."], "kategori")
 * - scrapeVatanGame([{ url: "...", categoryName: "..." }, ...])
 */
exports.run = async (input, categoryName) => {
  // ---- 1) GİRİŞ NORMALİZASYONU ----
  let tasks = [];

  const isObjArray = Array.isArray(input) && input.every(v => typeof v === "object" && v !== null);
  const isStrArray = Array.isArray(input) && input.every(v => typeof v === "string");
  const isStr = typeof input === "string";

  if (isObjArray) {
    // [{ url, categoryName }]
    tasks = input.map((t, i) => {
      if (!t?.url || !t?.categoryName) {
        throw new Error(`Task[${i}] eksik: url ve categoryName zorunlu`);
      }
      return { url: String(t.url).trim(), categoryName: String(t.categoryName).trim() };
    });
  } else if (isStrArray) {
    // ["https://..."] + categoryName (tek kategori hepsi için)
    if (!categoryName) throw new Error("categoryName eksik (string[] girişi için gerekli).");
    tasks = input.map(u => ({ url: String(u).trim(), categoryName: String(categoryName).trim() }));
  } else if (isStr) {
    // "https://..." + categoryName
    if (!categoryName) throw new Error("categoryName eksik (string girişi için gerekli).");
    tasks = [{ url: String(input).trim(), categoryName: String(categoryName).trim() }];
  } else {
    throw new Error("Geçersiz parametre. String, string[] veya {url, categoryName}[] beklenir.");
  }

  // ---- 2) SCRAPE ----
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(60000);

  try {
    for (const { url, categoryName } of tasks) {
      if (typeof url !== "string" || !url.startsWith("http")) {
        console.error("Geçersiz URL (string değil):", url);
        continue;
      }

      console.log(`Scraping: ${url} -> kategori: ${categoryName}`);

      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
      await page.waitForSelector("main#main .container-vg .card .card-body");

      const items = await page.evaluate(() => {
        const SELECTORS = {
          rowsAll: "main#main .container-vg .card .card-body div.row",
          name:
            ".inline-block.flex-column.justify-content-center.form-label-black.col-md-3.col-12 p.font-bold.form-label-black",
          price:
            ".d-flex.flex-column.justify-content-center.align-items-center.my-2.my-md-0.col-md-1.col-12 .text-center p.font-bold.form-label-black",
        };

        const cleanText = (t) => (t || "").replace(/\s+/g, " ").trim();

        const parsePrice = (txt) => {
          if (!txt) return { value: null, currency: null, raw: "" };
          const raw = cleanText(txt);
          const m = raw.match(/[₺$€£]/);
          const currency = m ? m[0] : "₺";
          const normalized = raw
            .replace(/[^\d,.\-]/g, "")
            .replace(/\.(?=\d{3}(\D|$))/g, "")
            .replace(",", ".");
          const value = parseFloat(normalized);
          return { value: isNaN(value) ? null : value, currency, raw };
        };

        const results = [];
        const rows = Array.from(document.querySelectorAll(SELECTORS.rowsAll));
        for (const row of rows) {
          const nameEl = row.querySelector(SELECTORS.name);
          const priceEl = row.querySelector(SELECTORS.price);
          if (!nameEl || !priceEl) continue;

          const title = cleanText(nameEl.textContent || "");
          const priceObj = parsePrice(priceEl.textContent || "");
          if (!title) continue;

          results.push({
            title,
            priceText: priceObj.raw,
            priceValue: priceObj.value,
            currency: priceObj.currency || "₺",
          });
        }
        return results;
      });

      if (!items || items.length === 0) {
        console.warn(`Hiç ürün bulunamadı: ${url}`);
        continue;
      }

      for (const item of items) {
        const product = new Item({
          siteName: "vatangame",
          categoryName,
          itemName: item.title,
          sellPrice: item.priceText || item.priceValue,
          currency: item.currency,
          sellPriceValue: item.priceValue,
          url,
        });

        await product.save();
        console.log(
          `Kaydedildi: ${item.title} - ${item.priceText} (${item.priceValue ?? "NaN"} ${item.currency})`
        );
      }
    }
  } catch (err) {
    console.error("VatanGame scrape hatası:", err?.message || err);
  } finally {
    await browser.close();
  }
};
