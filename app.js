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
  kabasakalonline: "Kabasakal Online",
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
    // Index kullanır: categoryName $in
    const items = await Item.find(
      { categoryName: { $in: ALL_CATEGORIES } },
      { siteName: 1, categoryName: 1, itemName: 1, sellPrice: 1, sellPriceValue: 1 } // projection
    ).sort({ createdAt: 1 }).lean();

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
      const row = group._rows.get(key) || { name: stripRegionWord(it.itemName), tr: null, global: null };

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


function parseDateOnly(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
}

app.get('/items/:name/prices', async (req, res) => {
  try {
    // ---- params
    const itemNameRaw = req.params.name;
    const siteName = req.query.siteId || undefined;
    const categoryName = req.query.category || undefined;

    const startStr = req.query.start;
    const endStr = req.query.end;
    const start = startStr ? parseDateOnly(startStr) : new Date(0);
    const end = endStr ? parseDateOnly(endStr) : new Date();
    if (!start || !end) return res.status(400).json({ error: 'invalid_date' });
    const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000);

    // İstekle gelen adı normalize et (sondaki "Global" varyasyonlarını at)
    const suffixRe = /[\s\-–—\(\[]+(?:global|tr)(?:\)|\])?\s*$/i;
    let itemNameNorm = String(req.params.name || '').trim();
    while (suffixRe.test(itemNameNorm)) {
      itemNameNorm = itemNameNorm.replace(suffixRe, '').trim();
    }

    // itemName hariç filtreler
    const baseMatch = {
      createdAt: { $gte: start, $lt: endExclusive }
    };
    if (siteName) baseMatch.siteName = siteName;
    if (categoryName) baseMatch.categoryName = categoryName;

    const pipeline = [
      // 0) önce tarih/site/category ile daralt
      { $match: baseMatch },

      // 1) itemName'i pipeline içinde normalize et (sondaki "Global" varyasyonlarını sil)
      {
  $addFields: {
    _itemNameNorm: {
      $function: {
        body: function (s) {
          if (s == null) return null;
          s = String(s).trim();
          var re = /[\s\-–—\(\[]+(?:global|tr)(?:\)|\])?\s*$/i;
          // Sonda birden fazla etiket varsa (ör. " - TR (Global)") hepsini sil
          while (re.test(s)) {
            s = s.replace(re, '').trim();
          }
          return s;
        },
        args: ["$itemName"],
        lang: "js"
      }
    }
  }
      },

      // 2) normalize ettiğimiz isim ile eşleştir
      { $match: { $expr: { $eq: ["$_itemNameNorm", itemNameNorm] } } },

      // 3) fiyat ham değer
      { $addFields: { _priceRaw: "$sellPrice" } },

      // 4) string'e çevir + kırp
      {
        $addFields: {
          _priceStr: {
            $cond: [
              { $eq: [{ $type: "$_priceRaw" }, "string"] },
              { $trim: { input: "$_priceRaw" } },
              { $toString: "$_priceRaw" }
            ]
          }
        }
      },

      // 5) yerel formatı normalize et -> double
      {
        $addFields: {
          priceNum: {
            $function: {
              body: function (s) {
                if (s == null) return null;
                s = String(s).replace(/\s+/g, '').replace(/[^\d.,-]/g, '');
                const hasComma = s.indexOf(',') !== -1;
                const hasDot = s.indexOf('.') !== -1;

                if (hasComma && hasDot) {
                  const lastComma = s.lastIndexOf(',');
                  const lastDot = s.lastIndexOf('.');
                  if (lastComma > lastDot) { s = s.replace(/\./g, '').replace(',', '.'); }
                  else { s = s.replace(/,/g, ''); }
                } else if (hasComma) {
                  const parts = s.split(',');
                  if (parts.length > 2) { const dec = parts.pop(); s = parts.join('') + '.' + dec; }
                  else { s = s.replace(',', '.'); }
                } else if (hasDot) {
                  const parts = s.split('.');
                  if (parts.length > 2) {
                    const last = parts.pop();
                    if (last.length === 3) { s = parts.join('') + last; }
                    else { s = parts.join('') + '.' + last; }
                  } else {
                    const idx = s.indexOf('.'); const fracLen = s.length - idx - 1;
                    if (fracLen === 3) s = s.replace('.', '');
                  }
                }
                const num = parseFloat(s);
                return isNaN(num) ? null : num;
              },
              args: ["$_priceStr"],
              lang: "js"
            }
          }
        }
      },

      // 6) null fiyatları at
      { $match: { priceNum: { $ne: null } } },

      // 7) gün (Europe/Istanbul)
      {
        $addFields: {
          dayStr: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
              timezone: "Europe/Istanbul"
            }
          }
        }
      },

      // 8) gün içi son kaydı almak için sırala
      { $sort: { createdAt: 1 } },

      // 9) Gün + Kategori bazında günlük SON fiyat
      {
        $group: {
          _id: { day: "$dayStr", category: "$categoryName" },
          price: { $last: "$priceNum" },
          currency: { $last: "$currency" }
        }
      },

      // 10) facet: kategori serileri + tüm günler
      {
        $facet: {
          perCategory: [
            {
              $group: {
                _id: "$_id.category",
                points: { $push: { day: "$_id.day", price: "$price" } },
                currency: { $first: "$currency" }
              }
            },
            { $unwind: { path: "$points", preserveNullAndEmptyArrays: true } },
            { $sort: { "_id": 1, "points.day": 1 } },
            {
              $group: {
                _id: "$_id",
                points: { $push: "$points" },
                currency: { $first: "$currency" }
              }
            }
          ],
          allDays: [
            { $group: { _id: null, days: { $addToSet: "$_id.day" } } },
            { $project: { _id: 0, days: 1 } }
          ]
        }
      }
    ];

    const agg = await ItemArchived.aggregate(pipeline).exec();
    const perCategory = agg[0]?.perCategory || [];
    const labels = (agg[0]?.allDays?.[0]?.days || []).sort();

    const datasets = perCategory.map(cat => {
      const map = new Map(cat.points.map(p => [p.day, p.price]));
      const data = labels.map(d => (map.has(d) ? map.get(d) : null));
      return {
        label: cat._id || 'unknown',
        data,
        currency: cat.currency || 'TRY'
      };
    });
    console.log(datasets);
    res.json({ labels, datasets });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});







const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const pipeline = [
  // {
  //   name: "bynogame mlbb TR",
  //   run: () => bng.run(
  //     "https://www.bynogame.com/tr/oyunlar/mobile-legends/mobile-legends-turkiye",
  //     "bynogame-mlbb-tr"
  //   ),
  // },
  // {
  //   name: "bynogame mlbb GLOBAL",
  //   run: () => bng.run(
  //     "https://www.bynogame.com/tr/oyunlar/mobile-legends/mobile-legends-global",
  //     "bynogame-mlbb-global"
  //   ),
  // },
  // {
  //   name: "bynogame GLOBAL",
  //   run: () => bng.run(
  //     "https://www.bynogame.com/tr/oyunlar/pubg/pubg-mobile-uc",
  //     "bynogame-pubgm"
  //   ),
  // },
  {
    name: "GameSatış (TR+GLOBAL)",
    run: () => gamesatis.run([
      { url: "https://www.gamesatis.com/mobile-legends-elmas-tr", categoryName: "gamesatis-mlbb-tr" },
      { url: "https://www.gamesatis.com/mobile-legends-elmas-global", categoryName: "gamesatis-mlbb-global" },
      { url: "https://www.gamesatis.com/pubg-mobile-uc", categoryName: "gamesatis-pubgm" },
    ]),
  },
  // {
  //   name: "Hesap.com.tr (tek sayfa TR+GLOBAL)",
  //   run: () => hesapcomtr.run("https://hesap.com.tr/urunler/mlbb-elmas-satin-al", {
  //     categoryMap: { tr: "hesap-mlbb-tr", global: "hesap-mlbb-global" },
  //     decideCategory: (title) => title.toLowerCase().includes("global") ? "global" : "tr",
  //   }),
  // },
  // {
  //   name: "Hesap.com.tr PUBG (TR)",
  //   run: () =>
  //     hesapcomtr.run("https://hesap.com.tr/urunler/pubg-mobile-uc-satin-al", {
  //       categoryMap: { tr: "hesap-pubgm-tr" },
  //       decideCategory: () => "tr",
  //     }),
  // },
  // {
  //   name: "Perdigital (TR)",
  //   run: () => perdigital.run([
  //     { url: "https://www.perdigital.com/mobile-legends-elmas", categoryName: "perdigital-mlbb-tr" },

  //   ]),
  // },
  // {
  //   name: "Perdigital (GLOBAL)",
  //   run: () => perdigital.run([
  //     { url: "https://www.perdigital.com/mobile-legends-elmas-global", categoryName: "perdigital-mlbb-global" },
  //   ]),
  // },
  // {
  //   name: "Perdigital PUBG",
  //   run: () => perdigital.run([
  //     { url: "https://www.perdigital.com/online-oyun/tencent-games/pubg-mobile-uc", categoryName: "perdigital-pubgm-tr" },
  //   ]),
  // },
  // {
  //   name: "VatanGame (TR+GLOBAL)",
  //   run: () => vatangame.run([
  //     { url: "https://vatangame.com/oyunlar/mobile-legends-bang-bang-elmas", categoryName: "vatangame-mlbb-tr" },
  //     { url: "https://vatangame.com/oyunlar/global-mobile-legends-bang-bang-elmas", categoryName: "vatangame-mlbb-global" },
  //   ]),
  // },
  // {
  //   name: "VatanGame PUBG (TR)",
  //   run: () => vatangame.run([
  //     { url: "https://vatangame.com/oyunlar/pubg-mobile-uc-tr", categoryName: "vatangame-pubgm-tr" },
  //   ]),
  // },
  // {
  //   name: "Kabasakal PUBG (TR)",
  //   run: () => kabasakal.run([
  //     { url: "https://kabasakalonline.com/urunler/106/pubg-mobile", categoryName: "kabasakal-pubgm-tr" },
  //   ]),
  // },
  // {
  //   name: "Kabasakal MLBB (TR)",
  //   run: () => kabasakal.run([
  //     { url: "https://kabasakalonline.com/urunler/127/mobile-legends-elmas-tr", categoryName: "kabasakal-mlbb-tr" },
  //   ]),
  // },
  // {
  //   name: "Kabasakal MLBB (GLOBAL)",
  //   run: () => kabasakal.run([
  //     { url: "https://kabasakalonline.com/urunler/239/mobile-legends-global-elmas", categoryName: "kabasakal-mlbb-global" },
  //   ]),
  // }
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
    await sleep(3000); // siteleri üzmeyelim
  }
  console.log("\n✔ Tüm işler tamam.");
}
// runAllOnce().catch(e => console.error("cron hata:", e));

// cron.schedule("*/30 * * * *", () => {
//   runAllOnce().catch(e => console.error("cron hata:", e));
// }, {
//   scheduled: true, // default true zaten
//   timezone: "Europe/Istanbul" // saat dilimini netleştirmek istersen
// });