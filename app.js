const mongoose = require("mongoose");
const express = require("express");
const app = express();
const Item = require("./models/item");
const ItemArchived = require("./models/itemArchived");
const cron = require("node-cron");
const bng = require("./cronTasks/bng");
const gamesatis = require("./cronTasks/gamesatis");
const hesapcomtr = require("./cronTasks/hesapcomtr");
const perdigital = require("./cronTasks/perdigital");
const vatangame = require("./cronTasks/vatangame");
const kabasakal = require("./cronTasks/kabasakal");





app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("view engine", "twig");


mongoose.connect("mongodb://127.0.0.1/diji-price-crawler")
  .then(() => {
    app.listen(3000, () => console.log("Server is running on http://localhost:3000"));
    console.log("DB Connection is set.");
  })
  .catch(err => console.log("DB error: " + err));

// Görünen site adları ve sıralama
const SITE_LABELS = {
  gamesatis: "GameSatış",
  hesapcomtr: "HesapComTR",
  vatangame: "VatanGame",
  bynogame: "ByNoGame",
  perdigital: "PerDigital",
  kabasakal: "Kabasakal",
};
const SITE_ORDER = ["gamesatis", "hesapcomtr", "vatangame", "bynogame", "perdigital", "kabasakal"];

const MLBB_CATEGORIES = [
  "gamesatis-mlbb-tr", "gamesatis-mlbb-global",
  "hesap-mlbb-tr", "hesap-mlbb-global",
  "vatangame-mlbb-tr", "vatangame-mlbb-global",
  "bynogame-mlbb-tr", "bynogame-mlbb-global",
  "perdigital-mlbb-tr", "perdigital-mlbb-global",
  "kabasakal-mlbb-tr", "kabasakal-mlbb-global",
];
const PUBG_CATEGORIES = [
  "gamesatis-pubgm",
  "hesap-pubgm-tr", "hesap-pubgm-global",
  "vatangame-pubgm-tr", "vatangame-pubgm-global",
  "bynogame-pubgm",
  "perdigital-pubgm-tr",
  "kabasakal-pubgm-tr",
];
const ALL_CATEGORIES = [...MLBB_CATEGORIES, ...PUBG_CATEGORIES];
const MLBB_SET = new Set(MLBB_CATEGORIES);
const PUBG_SET = new Set(PUBG_CATEGORIES);

// ---- Yardımcılar ----
const normName = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\b(tr|türkiye|turkiye|global|world|server|sunucu)\b/g, " ")
    .replace(/[^\w+.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripRegionWord = (s) => String(s || "").replace(/\s+(TR|Global)\b/i, "").trim();

const fmtPriceTR = (input) => {
  if (input == null) return null;
  const n = Number(String(input).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  try {
    return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return n.toFixed(2).replace(".", ",");
  }
};

// ---- Route ----
app.get("/", async (req, res) => {
  try {
    const items = await Item.find(
      { categoryName: { $in: ALL_CATEGORIES } },
      { siteName: 1, categoryName: 1, itemName: 1, sellPrice: 1, sellPriceValue: 1 }
    ).lean();

    const model = {
      mlbb: { id: "mlbb", label: "Mobile Legends", sites: {} },
      pubgm: { id: "pubgm", label: "Pubg Mobile", sites: {} },
    };

    for (const it of items) {
      const cat = it.categoryName || "";
      const game = MLBB_SET.has(cat) ? "mlbb" : (PUBG_SET.has(cat) ? "pubgm" : null);
      if (!game) continue;

      const region = /global/i.test(cat) ? "global" : "tr";
      const siteId = String(it.siteName || "").toLowerCase();
      const siteLabel = SITE_LABELS[siteId] || it.siteName || siteId || "Bilinmeyen";

      if (!model[game].sites[siteId]) {
        model[game].sites[siteId] = { id: siteId, label: siteLabel, _rows: new Map() };
      }
      const group = model[game].sites[siteId];

      const key = normName(it.itemName);
      const row = group._rows.get(key) || { 
        name: stripRegionWord(it.itemName), 
        originalName: it.itemName, // <-- Burası değişti
        tr: null, 
        global: null 
      };

      const priceNum = Number(
        String((it.sellPriceValue ?? it.sellPrice) ?? "").replace(",", ".")
      );
      const priceStr =
        fmtPriceTR(Number.isFinite(priceNum) ? priceNum : it.sellPrice) ||
        (it.sellPrice ?? "").replace(".", ",");

      if (region === "tr") row.tr = priceStr || row.tr;
      else row.global = priceStr || row.global;

      group._rows.set(key, row);
    }

    // Map → Array ve sıralamalar
    const finalizeSites = (sitesObj) => {
      const ids = Object.keys(sitesObj).sort(
        (a, b) => SITE_ORDER.indexOf(a) - SITE_ORDER.indexOf(b)
      );
      return ids.map((sid) => {
        const site = sitesObj[sid];
        const rows = Array.from(site._rows.values()).sort((a, b) => {
          const av = Number(String(a.tr || a.global || "").replace(",", "."));
          const bv = Number(String(b.tr || b.global || "").replace(",", "."));
          if (Number.isFinite(av) && Number.isFinite(bv)) return av - bv;
          return String(a.name).localeCompare(String(b.name), "tr");
        });
        return { id: site.id, label: site.label, rows };
      });
    };

    const categories = [
      { id: model.mlbb.id, label: model.mlbb.label, sites: finalizeSites(model.mlbb.sites) },
      { id: model.pubgm.id, label: model.pubgm.label, sites: finalizeSites(model.pubgm.sites) },
    ];

    res.render("index.twig", { categories });
  } catch (err) {
    console.error("Front render hatası:", err?.message || err);
    res.status(500).send("Hata");
  }
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const pipeline = [
  {
    name: "bynogame mlbb TR",
    run: () => bng.run(
      "https://www.bynogame.com/tr/oyunlar/mobile-legends/mobile-legends-turkiye",
      "bynogame-mlbb-tr"
    ),
  },
   
  {
    name: "bynogame mlbb GLOBAL",
    run: () => bng.run(
      "https://www.bynogame.com/tr/oyunlar/mobile-legends/mobile-legends-global",
      "bynogame-mlbb-global"
    ),
  },
  {
    name: "bynogame GLOBAL",
    run: () => bng.run(
      "https://www.bynogame.com/tr/oyunlar/pubg/pubg-mobile-uc",
      "bynogame-pubgm"
    ),
  },
  {
    name: "GameSatış (TR+GLOBAL)",
    run: () => gamesatis.run([
      { url: "https://www.gamesatis.com/mobile-legends-elmas-tr", categoryName: "gamesatis-mlbb-tr" },
      { url: "https://www.gamesatis.com/mobile-legends-elmas-global", categoryName: "gamesatis-mlbb-global" },
      { url: "https://www.gamesatis.com/pubg-mobile-uc", categoryName: "gamesatis-pubgm" },
    ]),
  },
  {
    name: "Hesap.com.tr (tek sayfa TR+GLOBAL)",
    run: () => hesapcomtr.run("https://hesap.com.tr/urunler/mlbb-elmas-satin-al", {
      categoryMap: { tr: "hesap-mlbb-tr", global: "hesap-mlbb-global" },
      decideCategory: (title) => title.toLowerCase().includes("global") ? "global" : "tr",
    }),
  },
  {
    name: "Hesap.com.tr PUBG (TR)",
    run: () =>
      hesapcomtr.run("https://hesap.com.tr/urunler/pubg-mobile-uc-satin-al", {
        categoryMap: { tr: "hesap-pubgm-tr" },
        decideCategory: () => "tr",
      }),
  },
  {
    name: "Perdigital (TR)",
    run: () => perdigital.run([
      { url: "https://www.perdigital.com/mobile-legends-elmas", categoryName: "perdigital-mlbb-tr" },

    ]),
  },
  {
    name: "Perdigital (GLOBAL)",
    run: () => perdigital.run([
      { url: "https://www.perdigital.com/mobile-legends-elmas-global", categoryName: "perdigital-mlbb-global" },
    ]),
  },
  {
    name: "Perdigital PUBG",
    run: () => perdigital.run([
      { url: "https://www.perdigital.com/online-oyun/tencent-games/pubg-mobile-uc", categoryName: "perdigital-pubgm-tr" },
    ]),
  },
  {
    name: "VatanGame (TR+GLOBAL)",
    run: () => vatangame.run([
      { url: "https://vatangame.com/oyunlar/mobile-legends-bang-bang-elmas", categoryName: "vatangame-mlbb-tr" },
      { url: "https://vatangame.com/oyunlar/global-mobile-legends-bang-bang-elmas", categoryName: "vatangame-mlbb-global" },
    ]),
  },
  {
    name: "VatanGame PUBG (TR)",
    run: () => vatangame.run([
      { url: "https://vatangame.com/oyunlar/pubg-mobile-uc-tr", categoryName: "vatangame-pubgm-tr" },
    ]),
  },
  {
    name: "Kabasakal PUBG (TR)",
    run: () => kabasakal.run([
      { url: "https://kabasakalonline.com/urunler/106/pubg-mobile", categoryName: "kabasakal-pubgm-tr" },
    ]),
  },
  {
    name: "Kabasakal MLBB (TR)",
    run: () => kabasakal.run([
      { url: "https://kabasakalonline.com/urunler/127/mobile-legends-elmas-tr", categoryName: "kabasakal-mlbb-tr" },
    ]),
  },
  {
    name: "Kabasakal MLBB (GLOBAL)",
    run: () => kabasakal.run([
      { url: "https://kabasakalonline.com/urunler/239/mobile-legends-global-elmas", categoryName: "kabasakal-mlbb-global" },
    ]),
  }
    
];

async function runAllOnce(selected = []) {
  const list = selected.length
    ? pipeline.filter(p => selected.includes(p.name) || selected.includes(p.name.split(" ")[0].toLowerCase()))
    : pipeline;

  for (const task of list) {
    const t0 = Date.now();
    console.log(`\n▶ ${task.name} başlıyor`);
    try {

      await task.run();
      console.log(`✓ ${task.name} bitti (${((Date.now() - t0) / 1000).toFixed(1)} sn)`);
    } catch (err) {
      console.error(`✗ ${task.name} hata:`, err?.message || err);
    }
    await sleep(1500); // siteleri üzmeyelim
  }
  console.log("\n✔ Tüm işler tamam.");
}

// Fiyat geçmişini getiren yeni API uç noktası
app.get('/api/price-history', async (req, res) => {
  const { itemName } = req.query;

  if (!itemName) {
    return res.status(400).json({ error: "itemName parametresi gerekli." });
  }

  try {
    // Veritabanından tüm fiyat geçmişini al
    const history = await Item.find({ itemName: itemName })
      .sort({ createdAt: 1 }) // Tarihe göre sırala
      .lean();

    // Veriyi front-end'in beklediği formata dönüştür
    const priceHistory = history.map(item => {
      const region = /global/i.test(item.categoryName) ? 'global' : 'tr';
      const priceValue = item.sellPriceValue ?? item.sellPrice;

      return {
        itemName: item.itemName,
        createdAt: item.createdAt,
        // Bölgeye göre fiyatları ayır
        sellPriceTR: region === 'tr' ? priceValue : null,
        sellPriceGlobal: region === 'global' ? priceValue : null,
      };
    });

    res.json(priceHistory);
  } catch (err) {
    console.error("Fiyat geçmişi API hatası:", err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});


app.get('/items/filter', async (req, res) => {
  let { start, end, category, site, page } = req.query;

  if (!category || !site) {
    return res.json({ success: false, rows: [] });
  }

  page = parseInt(page) || 1;
  const limit = 25;
  const skip = (page - 1) * limit;

  const startDate = start ? new Date(start) : new Date('1970-01-01'); // filtre yoksa tüm kayıtlar
  const endDate = end ? new Date(end) : new Date(); // bugünkü tarih
  endDate.setHours(23, 59, 59, 999);

  try {
    const CATEGORY_MAP = {
      mlbb: MLBB_CATEGORIES,
      pubgm: PUBG_CATEGORIES
    };

    const categoriesToSearch = CATEGORY_MAP[category] || [];
    const siteRegex = new RegExp(`^${site}`, "i");

    const totalCount = await Item.countDocuments({
      categoryName: { $in: categoriesToSearch },
      siteName: { $regex: siteRegex },
      createdAt: { $gte: startDate, $lte: endDate }
    });

    const items = await Item.find({
      categoryName: { $in: categoriesToSearch },
      siteName: { $regex: siteRegex },
      createdAt: { $gte: startDate, $lte: endDate }
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const rows = items.map(it => {
      const region = /global/i.test(it.categoryName) ? 'global' : 'tr';
      return {
        name: it.itemName,
        tr: region === 'tr' ? it.sellPrice : '-',
        global: region === 'global' ? it.sellPrice : '-'
      };
    });

    const totalPages = Math.ceil(totalCount / limit);

    res.json({ success: true, rows, page, totalPages, totalCount });
  } catch (err) {
    console.error(err);
    res.json({ success: false, rows: [] });
  }
});





runAllOnce().catch(e => console.error("cron hata:", e));

   cron.schedule("*/30 * * * *", () => {
     runAllOnce().catch(e => console.error("cron hata:", e));
   }, {
     scheduled: true, // default true zaten
  timezone: "Europe/Istanbul" // saat dilimini netleştirmek istersen
   });