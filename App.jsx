import React, { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, ChartNoAxesCombined, ChevronDown, CircleDollarSign, Download, Package, RefreshCw, Search, ShoppingBag, Sparkles, Users, WandSparkles } from 'lucide-react';

const API = 'http://127.0.0.1:8000';
const money = n => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n||0);
function App(){
  const [summary,setSummary]=useState(null), [products,setProducts]=useState([]), [alerts,setAlerts]=useState([]);
  const [selected,setSelected]=useState(''), [horizon,setHorizon]=useState(8), [forecast,setForecast]=useState(null);
  const [recs,setRecs]=useState(null), [query,setQuery]=useState(''), [loading,setLoading]=useState(true), [error,setError]=useState('');
  const [uploadMsg,setUploadMsg]=useState('');
  async function refresh(){
    setLoading(true);setError('');
    try{
      const [s,p,a]=await Promise.all([fetch(`${API}/api/summary`),fetch(`${API}/api/products`),fetch(`${API}/api/inventory-alerts`)]);
      if(!s.ok||!p.ok||!a.ok) throw new Error('Backend request failed. Make sure FastAPI is running.');
      const sv=await s.json(), pv=await p.json(), av=await a.json();
      setSummary(sv);setProducts(pv);setAlerts(av);
      setSelected(old=>pv.some(x=>x.product_id===old)?old:(pv[0]?.product_id||''));
    }catch(e){setError(e.message+' Start the backend using the README instructions.')}
    finally{setLoading(false)}
  }
  useEffect(()=>{refresh()},[]);
  useEffect(()=>{if(selected){runForecast();runRecs()}},[selected,horizon]);
  async function runForecast(){
    try{const r=await fetch(`${API}/api/forecast/${encodeURIComponent(selected)}?horizon=${horizon}`);if(r.ok)setForecast(await r.json())}
    catch{}
  }
  async function runRecs(){
    try{const r=await fetch(`${API}/api/recommendations/${encodeURIComponent(selected)}`);if(r.ok)setRecs(await r.json())}
    catch{}
  }
  const filtered=useMemo(()=>products.filter(p=>(p.product_name+' '+p.category+' '+p.product_id).toLowerCase().includes(query.toLowerCase())),[products,query]);
  const trend=useMemo(()=>forecast?[...forecast.historical.slice(-21).map(x=>({date:x.date.slice(5),actual:x.actual_units})),...forecast.forecast.slice(0,horizon).map(x=>({date:x.date.slice(5),predicted:x.predicted_units}))]:[],[forecast,horizon]);
  async function upload(e){
    const file=e.target.files?.[0];if(!file)return;
    const fd=new FormData();fd.append('file',file);
    try{const r=await fetch(`${API}/api/upload`,{method:'POST',body:fd});const d=await r.json();if(!r.ok)throw new Error(d.detail||'Upload failed');setUploadMsg(`${d.rows} rows imported successfully`);await refresh()}
    catch(err){setUploadMsg(err.message)}
  }
  const exportForecast=()=>{if(!forecast)return;const csv='date,predicted_units\n'+forecast.forecast.map(x=>`${x.date},${x.predicted_units}`).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='demand-forecast.csv';a.click();URL.revokeObjectURL(a.href)};
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><ChartNoAxesCombined size={22}/></div><div><b>DemandWise</b><small>AI RETAIL INTELLIGENCE</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <a className="nav-item active"><Activity size={17}/> Overview</a>
      <a className="nav-item" href="#forecast"><ChartNoAxesCombined size={17}/> Demand forecasting</a>
      <a className="nav-item" href="#recommendations"><Sparkles size={17}/> Recommendations</a>
      <a className="nav-item" href="#inventory"><Boxes size={17}/> Inventory alerts</a>
      <div className="sidebar-bottom"><div className="status-dot"/> <span>Forecast engine</span><strong>Ready</strong><p>Retail analytics workspace</p></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><div className="eyebrow">RETAIL INTELLIGENCE / OVERVIEW</div><h1>Demand dashboard</h1><p>Understand sales today. Plan demand tomorrow.</p></div><div className="top-actions"><label className="upload-btn"><Download size={16}/> Import CSV<input type="file" accept=".csv" onChange={upload} hidden/></label><button className="icon-btn" onClick={refresh} title="Refresh"><RefreshCw size={17}/></button></div></header>
      {uploadMsg&&<div className="notice">{uploadMsg}</div>}
      {error&&<div className="error-banner"><AlertTriangle size={18}/><span>{error}</span><button onClick={refresh}>Retry</button></div>}
      {loading&&!summary?<div className="loading">Connecting to DemandWise API…</div>:summary&&<>
        <section className="kpis">
          <KPI icon={<CircleDollarSign/>} label="Total revenue" value={money(summary.total_revenue)} change="Across imported sales" color="purple"/>
          <KPI icon={<ShoppingBag/>} label="Units sold" value={summary.units_sold.toLocaleString('en-IN')} change={`${summary.orders.toLocaleString()} sales records`} color="blue"/>
          <KPI icon={<Package/>} label="Products tracked" value={summary.products} change="Unique products" color="orange"/>
          <KPI icon={<Users/>} label="Customers" value={summary.customers.toLocaleString('en-IN')} change="Unique customer IDs" color="green"/>
        </section>
        <section className="grid-two">
          <div className="panel" id="forecast"><div className="panel-head"><div><div className="eyebrow">MACHINE LEARNING</div><h2>Weekly demand forecast</h2><p>Historical weekly sales and predicted product demand</p></div><div className="controls"><select value={selected} onChange={e=>setSelected(e.target.value)}>{products.map(p=><option key={p.product_id} value={p.product_id}>{p.product_name}</option>)}</select><select value={horizon} onChange={e=>setHorizon(Number(e.target.value))}><option value={4}>4 weeks</option><option value={8}>8 weeks</option><option value={12}>12 weeks</option></select></div></div>
            {forecast?<><div className="forecast-stats"><div><span>Expected units</span><b>{Math.round(forecast.total_predicted_units).toLocaleString('en-IN')}</b></div><div><span>Weekly average</span><b>{(forecast.average_weekly_demand ?? forecast.average_daily_demand ?? 0).toFixed(1)}</b></div><div><span>Model MAE</span><b>{forecast.mae===null?'N/A':forecast.mae}</b></div></div><div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{top:12,right:10,left:-18,bottom:0}}><defs><linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b7cff" stopOpacity={0.3}/><stop offset="95%" stopColor="#8b7cff" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#222a40"/><XAxis dataKey="date" tick={{fill:'#8c96b1',fontSize:10}} axisLine={false} tickLine={false} interval="preserveStartEnd"/><YAxis tick={{fill:'#8c96b1',fontSize:10}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:'#11182b',border:'1px solid #29324a',borderRadius:10,color:'#eef2ff'}}/><Area type="monotone" dataKey="actual" name="Actual units" stroke="#8b7cff" fill="url(#actualFill)" strokeWidth={2} connectNulls/><Area type="monotone" dataKey="predicted" name="Predicted units" stroke="#35c9b1" fill="transparent" strokeWidth={2} strokeDasharray="5 4" connectNulls/></AreaChart></ResponsiveContainer></div><div className="chart-foot"><span><i className="legend purple"/> Actual sales</span><span><i className="legend teal"/> Forecast</span><span className="method">{forecast.method}</span><button className="text-btn" onClick={exportForecast}>Export forecast ↓</button></div></>:<div className="empty">Select a product to generate a forecast.</div>}
          </div>
          <div className="panel"><div className="panel-head"><div><div className="eyebrow">SALES PERFORMANCE</div><h2>Top-selling products</h2><p>Ranked by total units sold</p></div></div><div className="bar-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={summary.top_products} layout="vertical" margin={{top:4,right:12,left:0,bottom:4}}><CartesianGrid strokeDasharray="3 3" stroke="#222a40" horizontal={false}/><XAxis type="number" tick={{fill:'#8c96b1',fontSize:10}} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="product_name" width={105} tick={{fill:'#b5bdd2',fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:'#11182b',border:'1px solid #29324a',borderRadius:10,color:'#eef2ff'}}/><Bar dataKey="units_sold" name="Units sold" fill="#8274f7" radius={[0,5,5,0]} barSize={19}/></BarChart></ResponsiveContainer></div><div className="insight"><Sparkles size={17}/><span><b>Quick insight</b><br/>Use product forecasts alongside recent sales before adjusting stock levels.</span></div></div>
        </section>
        <section className="grid-two lower">
          <div className="panel" id="recommendations"><div className="panel-head"><div><div className="eyebrow">PERSONALIZATION</div><h2>Product recommendations</h2><p>Similar products based on category, price and popularity</p></div><WandSparkles size={20} className="heading-icon"/></div><div className="source-product"><span className="source-icon"><ShoppingBag size={18}/></span><div><small>SELECTED PRODUCT</small><b>{recs?.source_product||'Choose a product'}</b></div><ChevronDown size={16}/></div><div className="recommendation-list">{recs?.recommendations?.length?recs.recommendations.map((r,i)=><div className="recommendation" key={r.product_id}><div className="rank">{String(i+1).padStart(2,'0')}</div><div className="rec-info"><b>{r.product_name}</b><span>{r.category} · {r.units_sold.toLocaleString()} units sold</span></div><div className="rec-price">{money(r.price)}<small>Similarity {Math.round(r.score*100)}%</small></div></div>):<div className="empty">Add more products to see recommendations.</div>}</div></div>
          <div className="panel" id="inventory"><div className="panel-head"><div><div className="eyebrow">STOCK MONITOR</div><h2>Inventory alerts</h2><p>Stock estimates are indicative; source dataset has no actual inventory</p></div><span className="count-badge">{alerts.length} alerts</span></div><div className="inventory-list">{alerts.length?alerts.slice(0,6).map(a=><div className="inventory-row" key={a.product_id}><div className={`alert-icon ${a.status.toLowerCase()}`}><AlertTriangle size={17}/></div><div className="inventory-info"><b>{a.product_name}</b><span>{a.stock} units in stock · {a.avg_daily_demand}/day average</span></div><div className="days-left"><b>{a.estimated_days_left}</b><small>days left</small></div></div>):<div className="empty">No low-stock alerts based on the current dataset.</div>}</div><p className="footnote">Estimates use the last 7 days of recorded sales. They are indicative, not purchase orders.</p></div>
        </section>
        <section className="panel product-panel"><div className="panel-head"><div><div className="eyebrow">CATALOG</div><h2>Product performance</h2><p>Search products and inspect sales and stock</p></div><div className="searchbox"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search products…"/></div></div><div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>CATEGORY</th><th>PRICE</th><th>UNITS SOLD</th><th>REVENUE</th><th>STOCK</th></tr></thead><tbody>{filtered.slice(0,12).map(p=><tr key={p.product_id} onClick={()=>setSelected(p.product_id)} className={p.product_id===selected?'selected-row':''}><td><span className="product-name"><span className="product-avatar"><Package size={15}/></span><span>{p.product_name}<small>ID: {p.product_id}</small></span></span></td><td><span className="category-pill">{p.category}</span></td><td>{money(p.price)}</td><td>{p.units_sold.toLocaleString('en-IN')}</td><td>{money(p.revenue)}</td><td>{p.stock}</td></tr>)}</tbody></table>{filtered.length===0&&<div className="empty">No products match your search.</div>}</div></section>
      </>}
      <footer>DemandWise AI · Weekly sales forecasting with Python ML <span>Forecasts are estimates, not guarantees.</span></footer>
    </main>
  </div>
}
function KPI({icon,label,value,change,color}){return <div className="kpi-card"><div className="kpi-top"><span>{label}</span><span className={`kpi-icon ${color}`}>{icon}</span></div><strong>{value}</strong><div className="kpi-change"><span className="neutral-dot"/> {change}</div></div>}
export default App;
