require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const mongoose = require('mongoose');
const { getSales, replaceSales } = require('./data');
const { buildForecast } = require('./forecast');

const app = express();
const port = Number(process.env.PORT || 8000);
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8001';

function groupProducts(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.product_id)) map.set(r.product_id, { product_id:r.product_id, product_name:r.product_name,
      category:r.category, priceSum:0, priceCount:0, units_sold:0, stock:Number(r.stock||0), lastDate:new Date(r.date), revenue:0 });
    const p = map.get(r.product_id); p.priceSum += Number(r.price); p.priceCount++; p.units_sold += Number(r.units_sold);
    p.revenue += Number(r.price)*Number(r.units_sold);
    if (new Date(r.date) >= p.lastDate) { p.stock = Number(r.stock||0); p.lastDate = new Date(r.date); }
  }
  return [...map.values()].map(p=>({product_id:p.product_id, product_name:p.product_name, category:p.category,
    price:Number((p.priceSum/p.priceCount).toFixed(2)), units_sold:Math.round(p.units_sold), stock:Math.round(p.stock), revenue:Number(p.revenue.toFixed(2))}));
}
function recommendationScore(target, candidate, maxUnits, priceScale) {
  const category = target.category === candidate.category ? 1 : 0;
  const price = Math.exp(-Math.abs(target.price-candidate.price)/priceScale);
  const popularity = candidate.units_sold / maxUnits;
  return 0.55*category + 0.30*price + 0.15*popularity;
}
app.get('/', (_req,res)=>res.json({name:'DemandWise AI API', status:'running', docs:'API routes are listed in README.md'}));
app.get('/api/health', (_req,res)=>res.json({status:'ok', database:mongoose.connection.readyState===1?'connected':'CSV fallback'}));
app.get('/api/summary', async (_req,res,next)=>{
  try { const rows=await getSales(); const products=groupProducts(rows); const revenue=rows.reduce((s,r)=>s+r.price*r.units_sold,0);
    const daily=new Map(); for(const r of rows){const k=new Date(r.date).toISOString().slice(0,10);daily.set(k,(daily.get(k)||0)+r.units_sold)}
    const top=[...products].sort((a,b)=>b.units_sold-a.units_sold).slice(0,6);
    res.json({total_revenue:Number(revenue.toFixed(2)),units_sold:Math.round(rows.reduce((s,r)=>s+r.units_sold,0)),products:products.length,
      customers:new Set(rows.map(r=>r.customer_id)).size,orders:rows.length,
      daily_sales:[...daily.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-30).map(([date,units])=>({date,units:Math.round(units)})),
      top_products:top.map(p=>({product_name:p.product_name,units_sold:p.units_sold}))});
  } catch(e){next(e)}
});
app.get('/api/products', async (_req,res,next)=>{try{const rows=await getSales();res.json(groupProducts(rows).sort((a,b)=>b.revenue-a.revenue))}catch(e){next(e)}});
app.get('/api/forecast/:productId', async (req,res,next)=>{
  try {
    const horizon=Number(req.query.horizon||8);
    if(![4,8,12].includes(horizon))return res.status(400).json({detail:'horizon must be 4, 8, or 12 weeks'});
    const rows=await getSales();
    const p=rows.filter(r=>String(r.product_id)===req.params.productId).sort((a,b)=>new Date(a.date)-new Date(b.date));
    if(!p.length)return res.status(404).json({detail:'Product ID not found.'});
    const observations=p.map(r=>({date:new Date(r.date).toISOString().slice(0,10),units_sold:Number(r.units_sold)}));
    const response=await fetch(`${ML_SERVICE_URL}/forecast`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({product_id:req.params.productId,product_name:p[0].product_name,horizon,observations})});
    const result=await response.json().catch(()=>({detail:'Python ML service returned an invalid response.'}));
    if(!response.ok)return res.status(response.status).json(result);
    res.json(result);
  }catch(e){if(e.cause?.code==='ECONNREFUSED'||e.code==='ECONNREFUSED')return res.status(503).json({detail:'Python ML service is not running. Start it from the ml_service folder on port 8001.'});next(e)}
});
app.get('/api/recommendations/:productId', async (req,res,next)=>{
  try {const rows=await getSales();const products=groupProducts(rows);const target=products.find(p=>p.product_id===req.params.productId);
    if(!target)return res.status(404).json({detail:'Product ID not found.'});
    const candidates=products.filter(p=>p.product_id!==target.product_id);const maxUnits=Math.max(1,...candidates.map(p=>p.units_sold));
    const priceScale=Math.max(1,Math.sqrt(products.reduce((s,p)=>s+(p.price-target.price)**2,0)/Math.max(1,products.length)));
    const recommendations=candidates.map(p=>({...p,score:recommendationScore(target,p,maxUnits,priceScale)})).sort((a,b)=>b.score-a.score).slice(0,Math.min(20,Math.max(1,Number(req.query.limit)||5)));
    res.json({source_product:target.product_name,recommendations:recommendations.map(p=>({product_id:p.product_id,product_name:p.product_name,category:p.category,price:p.price,units_sold:p.units_sold,score:Number(p.score.toFixed(3))}))});
  }catch(e){next(e)}
});
app.get('/api/inventory-alerts', async (_req,res,next)=>{
  try {const rows=await getSales();const map=new Map();for(const r of rows){const k=r.product_id;if(!map.has(k))map.set(k,[]);map.get(k).push(r)}const alerts=[];
    for(const [id,arr] of map){arr.sort((a,b)=>new Date(a.date)-new Date(b.date));const latest=arr[arr.length-1];const end=new Date(latest.date);const recent=arr.filter(r=>(end-new Date(r.date))/86400000<=6);const avg=recent.reduce((s,r)=>s+r.units_sold,0)/7;const days=avg>0?latest.stock/avg:null;
      if(days!==null&&days<=14)alerts.push({product_id:id,product_name:latest.product_name,stock:Math.round(latest.stock),avg_daily_demand:Number(avg.toFixed(2)),estimated_days_left:Number(days.toFixed(1)),status:days<=5?'Critical':'Low'});
    }res.json(alerts.sort((a,b)=>a.estimated_days_left-b.estimated_days_left));
  }catch(e){next(e)}
});
app.post('/api/upload', upload.single('file'), async (req,res,next)=>{
  try {
    if(!req.file)return res.status(400).json({detail:'Please select a CSV file.'});
    const records=parse(req.file.buffer,{columns:true,skip_empty_lines:true,trim:true,relax_column_count:true});
    if(!records.length)return res.status(400).json({detail:'The CSV file is empty.'});
    let normalized=records;
    // Support the original weekly store/SKU dataset directly: week, store_id, sku_id, units_sold.
    if(['week','store_id','sku_id','units_sold'].every(k=>k in records[0])){
      const latestUnits=new Map();
      for(const r of records){const id=`store_${r.store_id}_sku_${r.sku_id}`;const d=parseWeeklyDate(r.week);const old=latestUnits.get(id);if(d&&(!old||d>old.date))latestUnits.set(id,{date:d,units:Math.max(0,Number(r.units_sold)||0)});}
      normalized=records.map(r=>{
        const date=parseWeeklyDate(r.week);const id=`store_${r.store_id}_sku_${r.sku_id}`;
        const total=Number(r.total_price),base=Number(r.base_price);const price=Number.isFinite(total)&&total>0?total:(Number.isFinite(base)?base:0);
        return {date:date?date.toISOString().slice(0,10):'',product_id:id,product_name:`SKU ${r.sku_id} — Store ${r.store_id}`,
          category:`Store ${r.store_id}`,price,units_sold:r.units_sold,customer_id:`store_${r.store_id}`,
          stock:Math.round((latestUnits.get(id)?.units||0)*3)};
      });
    }
    const required=['date','product_id','product_name','category','price','units_sold','customer_id','stock'];
    const missing=required.filter(k=>!(k in (normalized[0]||{})));
    if(missing.length)return res.status(400).json({detail:`Missing required columns: ${missing.join(', ')}. For weekly sales use week, store_id, sku_id, units_sold, total_price, base_price.`});
    const clean=await replaceSales(normalized);
    res.json({message:'Dataset uploaded successfully.',rows:clean.length,products:new Set(clean.map(r=>r.product_id)).size,
      dataset_type:records[0].week?'weekly_store_sku_sales':'standard_sales',note:records[0].week?'Forecasts use weekly observations. Stock is a synthetic placeholder because the source has no stock column.':''});
  }catch(e){next(e)}
});
function parseWeeklyDate(value){
  if(!value)return null;
  const s=String(value).trim();
  // The training file uses DD/MM/YY dates; handle ISO dates too.
  let m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if(m){let year=Number(m[3]);if(year<100)year+=year>=70?1900:2000;const d=new Date(Date.UTC(year,Number(m[2])-1,Number(m[1])));return Number.isNaN(d.getTime())?null:d;}
  const d=new Date(s);return Number.isNaN(d.getTime())?null:d;
}
app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({detail:err.message||'Internal server error'})});
async function start(){
  if(process.env.MONGODB_URI){try{await mongoose.connect(process.env.MONGODB_URI, {serverSelectionTimeoutMS:2500});console.log('MongoDB connected.')}catch(e){console.warn('MongoDB unavailable; using bundled CSV fallback:',e.message)}}
  app.listen(port,()=>console.log(`DemandWise API listening on http://127.0.0.1:${port}`));
}
start();
