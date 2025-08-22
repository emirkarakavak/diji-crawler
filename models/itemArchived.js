const mongoose = require('mongoose');

const itemArchivedSchema = new mongoose.Schema({
  siteName:     { type: String, required: true },
  categoryName: { type: String, required: true },
  itemName:     { type: String, required: true },
  sellPrice:    { type: String, required: true },
  archivedAt: { type: Date, default: Date.now }
}, { timestamps: true });

itemArchivedSchema.index({ siteName: 1, categoryName: 1, itemName: 1, archivedAt: -1 });

const ItemArchived = new mongoose.model('ItemArchived', itemArchivedSchema);

module.exports = ItemArchived;
