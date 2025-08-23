const mongoose = require("mongoose");
const express = require("express");
const app = express();
const bng = require("./cronTasks/bng");
const gamesatis = require("./cronTasks/gamesatis");
const hesapcomtr = require("./cronTasks/hesapcomtr");
const perdigital = require("./cronTasks/perdigital");
const vatangame = require("./cronTasks/vatangame");




app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("view engine", "twig");


mongoose.connect("mongodb://127.0.0.1/diji-price-crawler")
  .then(() => {
    app.listen(3000, () => console.log("Server is running on http://localhost:3000"));
    console.log("DB Connection is set.");
  })
  .catch(err => console.log("DB error: " + err));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const pipeline = [
  {
    name: "bynogame mlbb TR",
    run: () => bng.run(
      "https://www.bynogame.com/tr/oyunlar/mobile-legends/mobile-legends-turkiye",
      "bynogame-mlbb-tr"
    ),
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

runAllOnce().catch(e => console.error("cron hata:", e));