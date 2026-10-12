const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const mongoose = require('mongoose');

const csvPath = path.join(__dirname, '..', 'data', 'sales.csv');
const salesSchema = new mongoose.Schema({
  date: { type: Date, required: true }, product_id: { type: String, required: true },
  product_name: { type: String, required: true }, category: { type: String, default: 'Other' },
  price: { type: Number, required: true }, units_sold: { type: Number, required: true },
  customer_id: { type: String, default: 'unknown' }, stock: { type: Number, default: 0 }
}, { versionKey: false });
const Sale = mongoose.models.Sale || mongoose.model('Sale', salesSchema);

function normalize(row) {
  const date = new Date(row.date);
  const price = Number(row.price), units = Number(row.units_sold), stock = Number(row.stock || 0);
  if (!Number.isFinite(date.getTime()) || !row.product_id || !row.product_name || !Number.isFinite(price) || !Number.isFinite(units)) return null;
  return { date, product_id: String(row.product_id), product_name: String(row.product_name),
    category: String(row.category || 'Other'), price, units_sold: Math.max(0, units),
    customer_id: String(row.customer_id || 'unknown'), stock: Math.max(0, Number.isFinite(stock) ? stock : 0) };
}
function readCsv() {
  if (!fs.existsSync(csvPath)) return [];
  const rows = parse(fs.readFileSync(csvPath, 'utf8'), { columns: true, skip_empty_lines: true, trim: true });
  return rows.map(normalize).filter(Boolean);
}
async function getSales() {
  if (mongoose.connection.readyState === 1) {
    const docs = await Sale.find().lean();
    if (docs.length) return docs.map(d => ({...d, date: new Date(d.date)}));
  }
  return readCsv();
}
async function replaceSales(rows) {
  const clean = rows.map(normalize).filter(Boolean);
  if (!clean.length) throw new Error('No valid sales rows found.');
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  const headers = ['date','product_id','product_name','category','price','units_sold','customer_id','stock'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  fs.writeFileSync(csvPath, [headers.join(','), ...clean.map(r => headers.map(h => esc(h === 'date' ? r[h].toISOString().slice(0,10) : r[h])).join(','))].join('\n'));
  if (mongoose.connection.readyState === 1) {
    await Sale.deleteMany({});
    await Sale.insertMany(clean, { ordered: false });
  }
  return clean;
}
module.exports = { getSales, replaceSales, readCsv };
