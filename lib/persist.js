// lib/persist.js
const Item = require("../models/item");
let ItemArchived = null;
try {
  ItemArchived = require("../models/itemArchived");
} catch (_) {}

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

/**
 * Upsert + (opsiyonel) arşiv.
 * options.archiveMode: "none" | "price-change" | "always"
 *  - "price-change" (önerilen): fiyat değiştiyse eski kaydı archive'a yaz.
 */
exports.upsertAndArchive = async (doc, options = {}) => {
  const {
    siteName, categoryName, itemName,
    sellPrice, sellPriceValue, currency, url,
  } = doc;

  const archiveMode = options.archiveMode || "price-change";

  const filter = {
    siteName: norm(siteName),
    categoryName: norm(categoryName),
    itemName: norm(itemName),
  };

  const update = {
    $set: {
      sellPrice: norm(sellPrice),
      sellPriceValue: Number.isFinite(+sellPriceValue) ? +sellPriceValue : null,
      currency: currency || "₺",
      url,
      updatedAt: new Date(),
    },
    $setOnInsert: { createdAt: new Date() },
  };

  // Orijinal (eski) dokümanı döndür ki karşılaştırma yapalım
  const res = await Item.findOneAndUpdate(filter, update, {
    upsert: true,
    new: false,        // eski döner
    rawResult: true,   // {lastErrorObject, value, ok}
  });

  const existed = !!(res?.lastErrorObject?.updatedExisting);
  const prev = res?.value || null;

  // Arşivle
  if (archiveMode !== "none" && ItemArchived) {
    const priceChanged =
      existed && prev && norm(prev.sellPrice) !== norm(sellPrice);

    if ((archiveMode === "always") || (archiveMode === "price-change" && priceChanged)) {
      const snap = prev?.toObject ? prev.toObject() : prev;
      if (snap) {
        await ItemArchived.create({
          siteName: snap.siteName,
          categoryName: snap.categoryName,
          itemName: snap.itemName,
          sellPrice: snap.sellPrice,
        });
      }
    }
  }

  return { inserted: !existed, updated: existed, previous: prev };
};
