const mongoose = require("mongoose");
const express = require("express");
const app = express();
const scraper = require("./cronTasks/bng");




app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("view engine", "twig");


mongoose.connect("mongodb://127.0.0.1/diji-price-crawler")
  .then(() => {
    app.listen(3000, () => console.log("Server is running on http://localhost:3000"));
    console.log("DB Connection is set.");
  })
  .catch(err => console.log("DB error: " + err));

(async () => {
  // Mobile Legends Türkiye
  await scraper.scrapeByNoGame(
    "https://www.bynogame.com/tr/oyunlar/mobile-legends/mobile-legends-turkiye",
    "bynogame-mlbb-tr"
  );

  // Mobile Legends Global
  await scraper.scrapeByNoGame(
    "https://www.bynogame.com/tr/oyunlar/mobile-legends/mobile-legends-global",
    "bynogame-mlbb-global"
  );
})();