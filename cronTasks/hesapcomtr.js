// cronTasks/hesapcomtr.js
const puppeteer = require("puppeteer");
const UserAgent = require("user-agents");
const { upsertAndArchive } = require("../lib/persist");

exports.run = async (
  url = "https://hesap.com.tr/urunler/mlbb-elmas-satin-al",
  opts = {}
) => {
  const categoryMap = {
    tr: "hesap-mlbb-tr",
    global: "hesap-mlbb-global",
    ...(opts.categoryMap || {}),
  };

  const decideCategory =
    typeof opts.decideCategory === "function"
      ? opts.decideCategory
      : (title) => {
          const t = (title || "").toLowerCase();
          if (/(global|world|int(erna(tio)?)?)/i.test(t)) return "global";
          if (/(t.r|türkiye|turkiye|tr sunucu|tr server)/i.test(t)) return "tr";
          return "tr";
        };

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const page = await browser.newPage();

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

    // KVKK/çerez (best-effort)
    try {
      await page.waitForSelector("button, .btn", { timeout: 5000 });
      await page.evaluate(() => {
        const texts = ["kabul", "accept", "onay", "tamam"];
        const btns = Array.from(document.querySelectorAll("button, .btn"));
        const hit = btns.find((b) =>
          texts.some((t) => (b.innerText || "").toLowerCase().includes(t))
        );
        if (hit) hit.click();
      });
    } catch {}

    // Auto-scroll
    async function autoScroll(p) {
      await p.evaluate(
        () =>
          new Promise((resolve) => {
            let total = 0;
            const distance = 800;
            const timer = setInterval(() => {
              const { scrollHeight } = document.documentElement;
              window.scrollBy(0, distance);
              total += distance;
              if (total >= scrollHeight - window.innerHeight - 200) {
                clearInterval(timer);
                resolve();
              }
            }, 200);
          })
      );
    }
    await autoScroll(page);

    // Kartlar geldi mi?
    const CARD_SEL =
      "section.product-listing-products ul.products li.col-12.prd div.item";
    await page.waitForFunction(
      (sel) => document.querySelectorAll(sel).length > 0,
      { timeout: 90000 },
      CARD_SEL
    );

    // Çekim
    const items = await page.evaluate(() => {
      const CARD_SEL =
        "section.product-listing-products ul.products li.col-12.prd div.item";
      const NAME_SEL =
        "div.row.g-3 .col-md-7 .l.position-relative a.d-flex span.product-name";
      const PRICE_SEL =
        "div.row.g-3 .col-md-5 .price-lg .new, div.row.g-3 .col-md-5 .price-lg span.new";

      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

      // TL/TRY/₺ temiz → numerik string döndür
      const parsePrice = (txt) => {
        if (!txt) return { raw: "", value: null, currency: null };
        const raw = clean(txt);
        const curMatch = raw.match(/₺|TL|TRY|\$|€|£/i);
        let currency = curMatch ? curMatch[0].toUpperCase() : "₺";
        if (currency === "TL" || currency === "TRY") currency = "₺";

        const numericStr = raw
          .replace(/(TL|TRY)/gi, "")
          .replace(/[₺$€£]/g, "")
          .replace(/[^\d,.\-]/g, "")
          .replace(/\.(?=\d{3}(\D|$))/g, "")
          .replace(",", ".")
          .trim();

        const value = parseFloat(numericStr);
        return {
          raw: numericStr, // "149.90"
          value: Number.isFinite(value) ? value : null,
          currency,
        };
      };

      const out = [];
      const cards = Array.from(document.querySelectorAll(CARD_SEL));
      for (const card of cards) {
        const nameEl = card.querySelector(NAME_SEL);
        let priceEl = card.querySelector(PRICE_SEL);
        if (!priceEl) {
          priceEl =
            card.querySelector(
              "div.row.g-3 .col-md-5 .price-sm .new, div.row.g-3 .col-md-5 .price .new"
            ) || card.querySelector("div.row.g-3 .col-md-5 [class*='price'] .new");
        }

        const title = clean(nameEl?.textContent || "");
        const price = parsePrice(priceEl?.textContent || "");
        if (!title || !price.raw) continue;

        out.push({
          title,
          priceText: price.raw,
          priceValue: price.value,
          currency: price.currency || "₺",
        });
      }
      return out;
    });

    if (!items || items.length === 0) {
      console.warn("Hiç ürün bulunamadı. Layout/selector değişmiş olabilir.");
      await browser.close();
      return;
    }

    // Kategoriye böl + UPSERT & ARCHIVE
    for (const item of items) {
      const group = decideCategory(item.title);
      const categoryName = categoryMap[group] || categoryMap.tr;

      const sellPriceStr =
        item.priceText?.trim() ||
        (Number.isFinite(item.priceValue) ? String(item.priceValue) : "");
      if (!sellPriceStr) continue;

      const sellPriceValue = Number.isFinite(item.priceValue)
        ? item.priceValue
        : (() => {
            const n = parseFloat(String(sellPriceStr).replace(",", "."));
            return Number.isFinite(n) ? n : null;
          })();

      try {
        await upsertAndArchive(
          {
            siteName: "hesapcomtr",
            categoryName,
            itemName: item.title,
            sellPrice: sellPriceStr,     // "149.90"
            sellPriceValue,
            currency: item.currency,
            url,
          },
          { archiveMode: "always" }
        );
        console.log(
          `Upsert: [${categoryName}] ${item.title} -> ${sellPriceStr} (${sellPriceValue ?? "NaN"} ${item.currency})`
        );
      } catch (err) {
        console.error(`Kaydetme hatası: [${categoryName}] ${item.title} ->`, err?.message || err);
      }
    }
  } catch (err) {
    console.error("Hesap.com.tr scrape hatası:", err?.message || err);
  } finally {
    await browser.close();
  }
};
