const puppeteer = require("puppeteer");
const Item = require("../models/item");

exports.scrapeByNoGame = async (url, categoryName) => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  // Sayfadaki tüm ürünleri bekle
  await page.waitForSelector("[ins-product-price]", { timeout: 60000 });

  const items = await page.$$eval("[ins-product-price]", products =>
    products.map(p => {
      // En yakın .item-* container
      const container = p.closest("[class*='item-']");

      // Ürün adı: h2>a veya h2
      const title =
        container?.querySelector("h2 a, h2, h3, .product-name")?.textContent.trim() ||
        "Ürün adı bulunamadı";

      const price = p.getAttribute("ins-product-price");
      const salePrice = p.getAttribute("ins-product-sale-price");

      // indirim varsa indirimli fiyatı al, yoksa normal fiyat
      const finalPrice =
        salePrice && price !== salePrice ? salePrice : price;

      return { title, price: finalPrice };
    })
  );

  for (let item of items) {
    const product = new Item({
      siteName: "bynogame",
      categoryName,
      itemName: item.title,
      sellPrice: item.price,
    });

    await product.save();
    console.log(`Kaydedildi: ${item.title} - ${item.price}`);
  }

  await browser.close();
};
