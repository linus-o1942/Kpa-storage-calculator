const RATES = {
  "Local Import":   { transitLocal:"Local",   freeDays:5,  rate1:{20:30,40:60},  rate2:{20:50,40:100}, tier1End:21,     remarshal:{20:60,40:90} },
  "Transit Import": { transitLocal:"Transit", freeDays:15, rate1:{20:30,40:60},  rate2:{20:50,40:100}, tier1End:21,     remarshal:{20:60,40:90} },
  "Dangerous Cargo":{ transitLocal:"Special", freeDays:1,  rate1:{20:53,40:80},  rate2:{20:53,40:80},  tier1End:999999, remarshal:{20:60,40:90} },
  "Out of Gauge":   { transitLocal:"Special", freeDays:1,  rate1:{20:90,40:130}, rate2:{20:90,40:130}, tier1End:999999, remarshal:{20:60,40:90} },
};

// Self-propelled (RORO) weight categories. Shore Handling / Wharfage come
// from self_propelled_units.xls; storageLocal / storageTransit (per unit,
// per day) come from storage_self_propelled_units.xls. Terminal User Fee
// is per CBM and is identical across all five categories.
const SP_CATEGORIES = [
  { key:"cat1", label:"Saloon, Station Wagon, Van, CUV (not exceeding 1.5 MT)",       shoreHandling:90,  wharfage:75,  storageLocal:20,  storageTransit:15  },
  { key:"cat2", label:"Station Wagon, Pick-up, SUV, CUV (not exceeding 2.0 MT)",      shoreHandling:120, wharfage:90,  storageLocal:25,  storageTransit:20  },
  { key:"cat3", label:"Mid-sized Truck, Minibus, Tractor (not exceeding 5.0 MT)",     shoreHandling:300, wharfage:200, storageLocal:50,  storageTransit:40  },
  { key:"cat4", label:"Bus, Truck, Tractor, Light Forklift (not exceeding 10 MT)",    shoreHandling:495, wharfage:400, storageLocal:120, storageTransit:100 },
  { key:"cat5", label:"Construction/Industrial Vehicle, Heavy Equipment (over 10 MT)",shoreHandling:800, wharfage:600, storageLocal:200, storageTransit:150 },
];
const SP_TERMINAL_FEE_PER_CBM = 2.00;

// "Other charges" — one-time, except Reefer Plug-in which accrues per hour.
// Values from Tabulated_kpa_charges.xlsx.
const OTHER_CATEGORIES = {
  "Standard Local / Reefer":  { kind:"sized",    shoreHandling:{20:120,40:180}, wharfage:{20:88,40:132}, imco:null,               reefer:{20:2,40:3} },
  "Standard Transit":         { kind:"sized",    shoreHandling:{20:90, 40:135}, wharfage:{20:88,40:132}, imco:null,               reefer:null },
  "Hazardous Local":          { kind:"sized",    shoreHandling:{20:120,40:180}, wharfage:{20:88,40:132}, imco:{20:21,40:32},      reefer:null },
  "Hazardous Transit":        { kind:"sized",    shoreHandling:{20:90, 40:135}, wharfage:{20:88,40:132}, imco:{20:18,40:27},      reefer:null },
  "Flat Racks (Machinery)":   { kind:"sized",    shoreHandling:{20:230,40:345}, wharfage:{20:88,40:132}, imco:null,               reefer:null },
  "Flat Racks (Trucks/Units)":{ kind:"units",    shoreHandling:{1:880,2:1060}, wharfage:{1:103,2:206}, quayside:{1:100,2:200} },
  "Loose Cargo":              { kind:"quantity", shoreHandling:{Local:9.00,Transit:7.40}, wharfage:{Local:6.80,Transit:6.80}, quayside:{Local:1.50,Transit:1.50}, unitLabel:"Ton/CBM" },
  "Self-Propelled Units (RORO)": { kind:"selfpropelled", quaysidePerCBM: SP_TERMINAL_FEE_PER_CBM },
};
// Categories where the cargo is not containerised — reference field only, no container number.
const NON_CONTAINERISED = new Set(["Loose Cargo", "Self-Propelled Units (RORO)"]);

let containers = [];
let spUnits = [];
let otherCharges = [];
let expandedId = null;
let nextId = 1;
let spNextId = 1;
let ocNextId = 1;

/* ---------------- DATE HELPERS ---------------- */
function parseDate(str){ return new Date(str + "T00:00:00"); }
function addDays(date, n){ const d = new Date(date); d.setDate(d.getDate()+n); return d; }
function daysBetween(a,b){ return Math.round((b - a) / 86400000); }
function fmtDate(d){
  if(!d) return "—";
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'2-digit' });
}
function fmtDateTime(d){
  if(!d) return "—";
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'2-digit' }) + ' ' +
         d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
}
function fmtMoney(n){ return "$" + n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}); }
function todayISO(){
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
}
function nowDateTimeLocal(){
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// Reefer plug-in bills any commenced hour as a full hour (standard terminal
// billing convention) — e.g. 3h 10m plugged in bills as 4 hours.
function hoursBetween(startLocalStr, asOfLocalStr){
  if(!startLocalStr || !asOfLocalStr) return 0;
  const start = new Date(startLocalStr);
  const asOf = new Date(asOfLocalStr);
  const diffMs = asOf - start;
  if(diffMs <= 0) return 0;
  return Math.ceil(diffMs / 3600000);
}



/* ---------------- CALC ---------------- */
function computeContainer(c, asOf){
  const rate = RATES[c.category];
  const discharge = parseDate(c.date);
  const elapsedRaw = daysBetween(discharge, asOf);
  const elapsed = Math.max(elapsedRaw, 0);
  const future = elapsedRaw < 0;

  const freeDays = rate.freeDays;
  const tier1EndDay = rate.tier1End;
  const tier1Days = Math.max(Math.min(elapsed, tier1EndDay) - freeDays, 0);
  const tier2Days = Math.max(elapsed - tier1EndDay, 0);
  const daysPayable = tier1Days + tier2Days;

  const rate1 = rate.rate1[c.size];
  const rate2 = rate.rate2[c.size];
  const tier1Amount = tier1Days * rate1;
  const tier2Amount = tier2Days * rate2;
  const remarshal = daysPayable > 0 ? rate.remarshal[c.size] : 0;
  const total = tier1Amount + tier2Amount + remarshal;

  const freeStart = addDays(discharge, 1);
  const freeEnd = addDays(discharge, freeDays);
  const tier1Start = tier1Days > 0 ? addDays(discharge, freeDays+1) : null;
  const tier1EndDate = tier1Days > 0 ? addDays(discharge, Math.min(elapsed, tier1EndDay)) : null;
  const tier2Start = tier2Days > 0 ? addDays(discharge, tier1EndDay+1) : null;
  const tier2EndDate = tier2Days > 0 ? addDays(discharge, elapsed) : null;

  return {
    elapsed, future, freeDays, tier1Days, tier2Days, daysPayable,
    rate1, rate2, tier1Amount, tier2Amount, remarshal, total,
    freeStart, freeEnd, tier1Start, tier1EndDate, tier2Start, tier2EndDate,
    transitLocal: rate.transitLocal
  };
}

/* ---------------- RENDER ---------------- */
function getAsOf(){
  const v = document.getElementById('asOfDate').value;
  return v ? parseDate(v) : parseDate(todayISO());
}

function render(){
  const asOf = getAsOf();
  const tbody = document.getElementById('tbody');
  const emptyState = document.getElementById('emptyState');
  tbody.innerHTML = "";

  if(containers.length === 0){
    emptyState.style.display = "block";
  } else {
    emptyState.style.display = "none";
  }

  let grandTotal = 0;

  containers.forEach(c => {
    const r = computeContainer(c, asOf);
    grandTotal += r.total;

    const badgeClass = r.transitLocal === "Transit" ? "transit" : (r.transitLocal === "Local" ? "local" : "special");

    // main row
    const tr = document.createElement('tr');
    tr.className = 'row' + (expandedId === c.id ? ' expanded' : '');
    tr.dataset.id = c.id;

    const scale = Math.max(r.elapsed, r.freeDays, 1);
    const freeW = Math.min(r.elapsed, r.freeDays);
    const t1W = r.tier1Days;
    const t2W = r.tier2Days;

    tr.innerHTML = `
      <td><span class="expand-icon">▶</span></td>
      <td><span class="container-no">${c.number || '—'}</span></td>
      <td class="mono">${c.size}'</td>
      <td><span class="badge ${badgeClass}">${c.category}</span></td>
      <td class="mono">${fmtDate(parseDate(c.date))}</td>
      <td class="mono">${r.future ? '<span class="warn">future</span>' : r.elapsed + 'd'}</td>
      <td class="gauge-cell">
        <div class="gauge">
          <div class="seg free" style="flex:${freeW || 0.001}"></div>
          <div class="seg tier1" style="flex:${t1W || 0.001}"></div>
          <div class="seg tier2" style="flex:${t2W || 0.001}"></div>
        </div>
        <div class="gauge-caption">${r.daysPayable>0 ? 'in tier since ' + fmtDate(r.tier1Start || r.tier2Start) : 'within free period'}</div>
      </td>
      <td><span class="days-payable ${r.daysPayable>0?'pos':'zero'}">${r.daysPayable}d</span></td>
      <td class="total-amt">${fmtMoney(r.total)}</td>
      <td><button class="del-btn" data-del="${c.id}" title="Remove">×</button></td>
    `;
    tbody.appendChild(tr);

    // detail row
    const detailTr = document.createElement('tr');
    detailTr.className = 'detail';
    detailTr.style.display = expandedId === c.id ? 'table-row' : 'none';
    detailTr.innerHTML = `
      <td colspan="10">
        <div class="detail-inner">
          <div class="tier-card">
            <h3>Free period</h3>
            <div class="dates">${fmtDate(r.freeStart)}<span class="arrow">→</span>${fmtDate(r.freeEnd)}</div>
            <div class="metrics"><span>${r.freeDays} days free</span><b>$0.00</b></div>
          </div>
          <div class="tier-card t1 ${r.tier1Days===0?'inactive':''}">
            <h3>Tier 1</h3>
            <div class="dates">${r.tier1Days>0 ? fmtDate(r.tier1Start)+' <span class="arrow">→</span> '+fmtDate(r.tier1EndDate) : 'Not yet reached'}</div>
            <div class="metrics"><span>${r.tier1Days} days @ ${fmtMoney(r.rate1)}/day</span><b>${fmtMoney(r.tier1Amount)}</b></div>
          </div>
          <div class="tier-card t2 ${r.tier2Days===0?'inactive':''}">
            <h3>Tier 2</h3>
            <div class="dates">${r.tier2Days>0 ? 'from '+fmtDate(r.tier2Start)+' <span class="arrow">→</span> '+fmtDate(r.tier2EndDate)+' (to date)' : 'Not yet reached'}</div>
            <div class="metrics"><span>${r.tier2Days} days @ ${fmtMoney(r.rate2)}/day</span><b>${fmtMoney(r.tier2Amount)}</b></div>
          </div>
          <div class="remarshal-line">
            <span>Re-marshalling — one-time charge, applies once free period expires (${r.transitLocal} · ${c.size}')</span>
            <b>${r.daysPayable>0 ? fmtMoney(r.remarshal) : 'not applicable'}</b>
          </div>
        </div>
      </td>
    `;
    tbody.appendChild(detailTr);
  });

  document.getElementById('grandTotal').textContent = fmtMoney(grandTotal);
  document.getElementById('countHint').textContent = containers.length + (containers.length===1 ? ' container' : ' containers');
  if(typeof updateTab1GrandTotal === 'function') updateTab1GrandTotal();
}

/* ---------------- EVENTS ---------------- */
document.getElementById('tbody').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if(del){
    const id = Number(del.dataset.del);
    containers = containers.filter(c => c.id !== id);
    if(expandedId === id) expandedId = null;
    render();
    return;
  }
  const row = e.target.closest('tr.row');
  if(row){
    const id = Number(row.dataset.id);
    expandedId = expandedId === id ? null : id;
    render();
  }
});

document.getElementById('addBtn').addEventListener('click', () => {
  const number = document.getElementById('inNumber').value.trim().toUpperCase();
  const size = document.getElementById('inSize').value;
  const category = document.getElementById('inCategory').value;
  const date = document.getElementById('inDate').value;
  const warn = document.getElementById('formWarn');

  if(!number || !date){
    warn.textContent = "Container number and discharge date are required.";
    warn.style.display = "block";
    return;
  }
  warn.style.display = "none";

  containers.push({ id: nextId++, number, size, category, date });
  document.getElementById('inNumber').value = "";
  document.getElementById('inDate').value = "";
  document.getElementById('inNumber').focus();
  render();
});

document.getElementById('inNumber').addEventListener('keydown', (e) => {
  if(e.key === 'Enter') document.getElementById('addBtn').click();
});

document.getElementById('asOfDate').addEventListener('change', () => {
  render();
  renderSP();
});

/* export / import */
document.getElementById('exportBtn').addEventListener('click', () => {
  const data = JSON.stringify({ asOfDate: document.getElementById('asOfDate').value, containers }, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'storage-calculator-data.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('fileInput').click();
});

document.getElementById('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try{
      const data = JSON.parse(evt.target.result);
      if(data.containers){
        containers = data.containers;
        nextId = Math.max(0, ...containers.map(c=>c.id)) + 1;
      }
      if(data.asOfDate) document.getElementById('asOfDate').value = data.asOfDate;
      render();
    }catch(err){
      alert('Could not read that file — please select a JSON file exported from this tool.');
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

document.getElementById('exportCsvBtn').addEventListener('click', () => {
  const asOf = getAsOf();
  let rows = [["Container","Size","Category","Discharge Date","Days Elapsed","Free Days","Tier1 Days","Tier1 Amount","Tier2 Days","Tier2 Amount","Days Payable","Re-marshalling","Total Amount","Transit/Local"]];
  containers.forEach(c => {
    const r = computeContainer(c, asOf);
    rows.push([c.number, c.size+"'", c.category, c.date, r.elapsed, r.freeDays, r.tier1Days, r.tier1Amount.toFixed(2), r.tier2Days, r.tier2Amount.toFixed(2), r.daysPayable, r.remarshal.toFixed(2), r.total.toFixed(2), r.transitLocal]);
  });
  const csv = rows.map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'storage-charges.csv';
  a.click();
  URL.revokeObjectURL(url);
});

/* ---------------- UPLOAD: PARSE KPA CONTAINER DOCUMENT ---------------- */
function normText(s){
  return (s || "").replace(/\u00A0/g, ' ').replace(/\s+/g,' ').trim();
}
function findValueByLabel(doc, labelText){
  const tds = doc.querySelectorAll('td');
  for(const td of tds){
    if(normText(td.textContent).toLowerCase() === labelText.toLowerCase()){
      const sib = td.nextElementSibling;
      if(sib) return normText(sib.textContent);
    }
  }
  return null;
}
function parseKPADocument(htmlText){
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');

  const numberRaw = findValueByLabel(doc, 'Container No');
  const szTpRaw = findValueByLabel(doc, 'SzTp');
  const gateInRaw = findValueByLabel(doc, 'Gate In Date');

  const result = { number:null, size:null, date:null, warnings:[] };

  if(numberRaw) result.number = numberRaw.toUpperCase();
  else result.warnings.push('Container No not found');

  if(szTpRaw){
    const first = szTpRaw.trim().charAt(0);
    if(first === '4') result.size = '40';
    else if(first === '2') result.size = '20';
    else result.warnings.push(`SzTp "${szTpRaw}" not recognised (expected to start with 2 or 4) — set size manually`);
  } else {
    result.warnings.push('SzTp not found');
  }

  if(gateInRaw){
    const datePart = gateInRaw.split(' ')[0]; // drop time, keep date only
    const m = datePart.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if(m){
      result.date = `${m[3]}-${m[2]}-${m[1]}`; // yyyy-mm-dd
    } else {
      result.warnings.push(`Gate In Date "${gateInRaw}" not in DD/MM/YYYY format — set date manually`);
    }
  } else {
    result.warnings.push('Gate In Date not found');
  }

  return result;
}

document.getElementById('uploadDocBtn').addEventListener('click', () => {
  document.getElementById('docFileInput').click();
});

document.getElementById('docFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    const banner = document.getElementById('parseBanner');
    try{
      const parsed = parseKPADocument(evt.target.result);
      let filled = [];
      if(parsed.number){ document.getElementById('inNumber').value = parsed.number; filled.push('Container Number: ' + parsed.number); }
      if(parsed.size){ document.getElementById('inSize').value = parsed.size; filled.push('Size: ' + parsed.size + "'"); }
      if(parsed.date){ document.getElementById('inDate').value = parsed.date; filled.push('Discharge Date: ' + parsed.date); }

      if(filled.length){
        banner.className = 'parse-banner ok';
        banner.textContent = 'Loaded from document — ' + filled.join(' · ') +
          '. Select the category, then click "+ Add container".' +
          (parsed.warnings.length ? '  (' + parsed.warnings.join('; ') + ')' : '');
      } else {
        banner.className = 'parse-banner err';
        banner.textContent = 'Could not find container details in this document. ' + parsed.warnings.join('; ');
      }
    }catch(err){
      banner.className = 'parse-banner err';
      banner.textContent = 'Could not read this file — please upload the saved container-detail webpage (.html).';
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

/* ---------------- WORD REPORT ---------------- */
function generateWordReport(){
  const asOf = getAsOf();
  const asOfDT = getOCAsOf();
  if(containers.length === 0 && spUnits.length === 0 && otherCharges.length === 0){
    alert('Add at least one item (container, self-propelled unit, or other charge) before downloading a report.');
    return;
  }

  const rows = containers.map(c => ({ c, r: computeContainer(c, asOf) }));
  let grand = 0;

  const containerBlocks = rows.map(({c, r}, idx) => {
    grand += r.total;
    const subtotal = r.tier1Amount + r.tier2Amount;
    const pageBreak = idx > 0 ? "style='page-break-before:always;'" : "";
    return `
      <div ${pageBreak}>
        <h2 style="font-family:'Arial',sans-serif;color:#153152;font-size:16pt;border-bottom:2pt solid #153152;padding-bottom:4pt;">
          Container ${c.number}
        </h2>

        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:'Arial',sans-serif;font-size:10.5pt;margin-bottom:14pt;">
          <tr style="background:#153152;color:#ffffff;">
            <td colspan="4"><b>CONTAINER TRAITS</b></td>
          </tr>
          <tr>
            <td width="25%"><b>Container Number</b></td><td width="25%">${c.number}</td>
            <td width="25%"><b>Size</b></td><td width="25%">${c.size}'</td>
          </tr>
          <tr>
            <td><b>Category</b></td><td>${c.category}</td>
            <td><b>Transit / Local</b></td><td>${r.transitLocal}</td>
          </tr>
          <tr>
            <td><b>Discharge Date</b></td><td>${fmtDate(parseDate(c.date))}</td>
            <td><b>As-of Date</b></td><td>${fmtDate(asOf)}</td>
          </tr>
          <tr>
            <td><b>Days Elapsed</b></td><td>${r.elapsed}</td>
            <td><b>Days Payable</b></td><td>${r.daysPayable}</td>
          </tr>
        </table>

        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:'Arial',sans-serif;font-size:10.5pt;">
          <tr style="background:#153152;color:#ffffff;">
            <td><b>Storage Level</b></td><td><b>Date Range</b></td><td><b>Days</b></td><td><b>Rate/Day</b></td><td><b>Amount</b></td>
          </tr>
          <tr>
            <td>Free Period</td>
            <td>${fmtDate(r.freeStart)} &rarr; ${fmtDate(r.freeEnd)}</td>
            <td>${r.freeDays}</td><td>&mdash;</td><td>$0.00</td>
          </tr>
          <tr>
            <td>Tier 1</td>
            <td>${r.tier1Days>0 ? fmtDate(r.tier1Start)+' &rarr; '+fmtDate(r.tier1EndDate) : 'Not reached'}</td>
            <td>${r.tier1Days}</td><td>${fmtMoney(r.rate1)}</td><td>${fmtMoney(r.tier1Amount)}</td>
          </tr>
          <tr>
            <td>Tier 2</td>
            <td>${r.tier2Days>0 ? 'from '+fmtDate(r.tier2Start)+' &rarr; '+fmtDate(r.tier2EndDate) : 'Not reached'}</td>
            <td>${r.tier2Days}</td><td>${fmtMoney(r.rate2)}</td><td>${fmtMoney(r.tier2Amount)}</td>
          </tr>
          <tr style="background:#EEF3F6;">
            <td colspan="4" align="right"><b>SUBTOTAL (Storage, Tier 1 + Tier 2)</b></td>
            <td><b>${fmtMoney(subtotal)}</b></td>
          </tr>
          <tr>
            <td colspan="4" align="right">Re-marshalling (one-time charge)</td>
            <td>${r.daysPayable>0 ? fmtMoney(r.remarshal) : 'N/A'}</td>
          </tr>
          <tr style="background:#153152;color:#ffffff;">
            <td colspan="4" align="right"><b>GRAND TOTAL — ${c.number}</b></td>
            <td><b>${fmtMoney(r.total)}</b></td>
          </tr>
        </table>
      </div>`;
  }).join('');

  const summaryRows = rows.map(({c, r}) => `
    <tr>
      <td>${c.number}</td><td>${c.size}'</td><td>${c.category}</td><td>${r.daysPayable}</td><td>${fmtMoney(r.total)}</td>
    </tr>`).join('');

  const summaryBlock = rows.length > 1 ? `
    <div style="page-break-before:always;">
      <h2 style="font-family:'Arial',sans-serif;color:#153152;font-size:16pt;border-bottom:2pt solid #153152;padding-bottom:4pt;">
        Summary — All Containers
      </h2>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:'Arial',sans-serif;font-size:10.5pt;">
        <tr style="background:#153152;color:#ffffff;">
          <td><b>Container</b></td><td><b>Size</b></td><td><b>Category</b></td><td><b>Days Payable</b></td><td><b>Total</b></td>
        </tr>
        ${summaryRows}
        <tr style="background:#153152;color:#ffffff;">
          <td colspan="4" align="right"><b>GRAND TOTAL — ALL CONTAINERS</b></td>
          <td><b>${fmtMoney(grand)}</b></td>
        </tr>
      </table>
    </div>` : '';

  /* ---- SELF-PROPELLED UNITS ---- */
  const spRows = spUnits.map(u => ({ u, r: computeSPUnit(u, asOf) }));
  let spGrand = 0;
  const spBlocks = spRows.map(({u, r}) => {
    spGrand += r.total;
    return `
      <div style="page-break-before:always;">
        <h2 style="font-family:'Arial',sans-serif;color:#153152;font-size:16pt;border-bottom:2pt solid #153152;padding-bottom:4pt;">
          Self-Propelled Unit — ${u.reference}
        </h2>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:'Arial',sans-serif;font-size:10.5pt;margin-bottom:14pt;">
          <tr style="background:#153152;color:#ffffff;"><td colspan="4"><b>UNIT TRAITS</b></td></tr>
          <tr><td width="25%"><b>Cargo Reference</b></td><td width="25%">${u.reference}</td><td width="25%"><b>Local / Transit</b></td><td width="25%">${u.transitLocal}</td></tr>
          <tr><td><b>Weight Category</b></td><td colspan="3">${r.catLabel}</td></tr>
          <tr><td><b>Discharge Date</b></td><td>${fmtDate(parseDate(u.date))}</td><td><b>As-of Date</b></td><td>${fmtDate(asOf)}</td></tr>
          <tr><td><b>Days Elapsed</b></td><td>${r.elapsed}</td><td><b>Free Days</b></td><td>${r.freeDays}</td></tr>
        </table>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:'Arial',sans-serif;font-size:10.5pt;">
          <tr style="background:#153152;color:#ffffff;"><td><b>Charge</b></td><td><b>Days Payable</b></td><td><b>Rate/Day</b></td><td><b>Amount</b></td></tr>
          <tr><td>Storage</td><td>${r.daysPayable}</td><td>${fmtMoney(r.rate)}</td><td>${fmtMoney(r.total)}</td></tr>
          <tr style="background:#153152;color:#ffffff;">
            <td colspan="3" align="right"><b>GRAND TOTAL — ${u.reference}</b></td><td><b>${fmtMoney(r.total)}</b></td>
          </tr>
        </table>
      </div>`;
  }).join('');

  const spSummaryRows = spRows.map(({u, r}) => `
    <tr><td>${u.reference}</td><td>${r.catLabel}</td><td>${u.transitLocal}</td><td>${r.daysPayable}</td><td>${fmtMoney(r.total)}</td></tr>`).join('');

  const spSummaryBlock = spRows.length > 1 ? `
    <div style="page-break-before:always;">
      <h2 style="font-family:'Arial',sans-serif;color:#153152;font-size:16pt;border-bottom:2pt solid #153152;padding-bottom:4pt;">Summary — All Self-Propelled Units</h2>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:'Arial',sans-serif;font-size:10.5pt;">
        <tr style="background:#153152;color:#ffffff;"><td><b>Reference</b></td><td><b>Weight Category</b></td><td><b>Local/Transit</b></td><td><b>Days Payable</b></td><td><b>Total</b></td></tr>
        ${spSummaryRows}
        <tr style="background:#153152;color:#ffffff;"><td colspan="4" align="right"><b>GRAND TOTAL — ALL SELF-PROPELLED UNITS</b></td><td><b>${fmtMoney(spGrand)}</b></td></tr>
      </table>
    </div>` : '';

  /* ---- OTHER CHARGES ---- */
  const ocRows = otherCharges.map(item => ({ item, r: computeOtherCharge(item, asOfDT) }));
  let ocGrand = 0;
  const ocRow = (label, val) => val > 0 ? `<tr><td>${label}</td><td colspan="3">${fmtMoney(val)}</td></tr>` : `<tr><td>${label}</td><td colspan="3">N/A</td></tr>`;
  const ocBlocks = ocRows.map(({item, r}) => {
    ocGrand += r.total;
    return `
      <div style="page-break-before:always;">
        <h2 style="font-family:'Arial',sans-serif;color:#153152;font-size:16pt;border-bottom:2pt solid #153152;padding-bottom:4pt;">
          Other Charges — ${item.reference}
        </h2>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:'Arial',sans-serif;font-size:10.5pt;margin-bottom:14pt;">
          <tr style="background:#153152;color:#ffffff;"><td colspan="4"><b>CHARGE TRAITS</b></td></tr>
          <tr><td width="25%"><b>Reference</b></td><td width="25%">${item.reference}</td><td width="25%"><b>Category</b></td><td width="25%">${item.category}</td></tr>
          <tr><td><b>Size / Units / Weight Cat.</b></td><td colspan="3">${r.label}</td></tr>
        </table>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:'Arial',sans-serif;font-size:10.5pt;">
          <tr style="background:#153152;color:#ffffff;"><td><b>Charge Type</b></td><td colspan="3"><b>Amount</b></td></tr>
          ${ocRow('Shore Handling', r.shoreHandling)}
          ${ocRow('Wharfage', r.wharfage)}
          ${ocRow('IMCO Surcharge', r.imco)}
          <tr><td>Reefer Plug-in</td><td colspan="3">${r.reeferAmount > 0 ? fmtMoney(r.reeferAmount) + ' (' + r.reeferHours + ' hrs)' : 'N/A'}</td></tr>
          ${ocRow('Quayside / Terminal Fee', r.quayside)}
          <tr style="background:#153152;color:#ffffff;"><td colspan="3" align="right"><b>GRAND TOTAL — ${item.reference}</b></td><td><b>${fmtMoney(r.total)}</b></td></tr>
        </table>
      </div>`;
  }).join('');

  const ocSummaryRows = ocRows.map(({item, r}) => `
    <tr><td>${item.reference}</td><td>${item.category}</td><td>${r.label}</td><td>${fmtMoney(r.total)}</td></tr>`).join('');

  const ocSummaryBlock = ocRows.length > 1 ? `
    <div style="page-break-before:always;">
      <h2 style="font-family:'Arial',sans-serif;color:#153152;font-size:16pt;border-bottom:2pt solid #153152;padding-bottom:4pt;">Summary — All Other Charges</h2>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:'Arial',sans-serif;font-size:10.5pt;">
        <tr style="background:#153152;color:#ffffff;"><td><b>Reference</b></td><td><b>Category</b></td><td><b>Size/Units/Cat</b></td><td><b>Total</b></td></tr>
        ${ocSummaryRows}
        <tr style="background:#153152;color:#ffffff;"><td colspan="3" align="right"><b>GRAND TOTAL — ALL OTHER CHARGES</b></td><td><b>${fmtMoney(ocGrand)}</b></td></tr>
      </table>
    </div>` : '';

  /* ---- COMBINED GRAND TOTAL ---- */
  const totalItems = rows.length + spRows.length + ocRows.length;
  const combinedTotal = grand + spGrand + ocGrand;
  const combinedBlock = totalItems > 1 ? `
    <div style="page-break-before:always;">
      <h2 style="font-family:'Arial',sans-serif;color:#153152;font-size:16pt;border-bottom:2pt solid #153152;padding-bottom:4pt;">Combined Grand Total</h2>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:'Arial',sans-serif;font-size:11pt;">
        <tr><td width="70%">Storage &amp; Remarshalling — Containers</td><td><b>${fmtMoney(grand)}</b></td></tr>
        <tr><td>Storage — Self-Propelled Units</td><td><b>${fmtMoney(spGrand)}</b></td></tr>
        <tr><td>Other Charges</td><td><b>${fmtMoney(ocGrand)}</b></td></tr>
        <tr style="background:#153152;color:#ffffff;"><td><b>COMBINED GRAND TOTAL</b></td><td><b>${fmtMoney(combinedTotal)}</b></td></tr>
      </table>
    </div>` : '';

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="utf-8">
      <title>Storage Charge Report</title>
      <!--[if gte mso 9]>
      <xml>
        <w:WordDocument>
          <w:View>Print</w:View>
          <w:Zoom>100</w:Zoom>
          <w:DoNotOptimizeForBrowser/>
        </w:WordDocument>
      </xml>
      <![endif]-->
      <style>
        @page Section1 {
          size: 21cm 29.7cm;
          margin: 2cm 1.8cm 2.4cm 1.8cm;
          mso-footer: f1;
        }
        div.Section1 { page: Section1; }
        body { font-family:'Arial',sans-serif; color:#141F29; }
        p.MsoFooter, p.MsoHeader { margin:0; font-size:9pt; font-family:'Arial',sans-serif; color:#4B5A67; }
      </style>
    </head>
    <body>
      <div style='mso-element:footer' id="f1">
        <p class="MsoFooter" style="text-align:center;border-top:1.5pt solid #C9A24A;padding-top:5pt;color:#153152;font-weight:bold;">
          <i>Powered by Omlin Consultancy</i>
        </p>
      </div>

      <div class="Section1">
        <table border="0" cellpadding="0" cellspacing="0" style="width:100%;background:#153152;margin-bottom:14pt;">
          <tr>
            <td style="padding:14pt 16pt;border-bottom:3pt solid #C9A24A;">
              <table border="0" cellpadding="0" cellspacing="0"><tr>
                <td style="width:40pt;vertical-align:middle;">
                  <div style="width:30pt;height:30pt;border:1.5pt solid #C9A24A;border-radius:6pt;text-align:center;line-height:30pt;color:#C9A24A;font-family:'Arial',sans-serif;font-size:13pt;">&#9875;</div>
                </td>
                <td style="vertical-align:middle;padding-left:8pt;">
                  <div style="font-family:'Arial',sans-serif;color:#ffffff;font-size:15pt;font-weight:bold;letter-spacing:0.5pt;">OMLIN CONSULTANCY LTD</div>
                  <div style="font-family:'Arial',sans-serif;color:#E7D8A9;font-size:8pt;letter-spacing:1pt;">SHIPPING &middot; CUSTOMS &middot; LOGISTICS</div>
                </td>
              </tr></table>
            </td>
          </tr>
        </table>
        <h1 style="font-family:'Arial',sans-serif;color:#153152;font-size:20pt;margin-bottom:2pt;">Storage Charge Report</h1>
        <p style="font-family:'Arial',sans-serif;color:#4B5A67;font-size:10pt;margin-top:0;">Terminal Tariff · KPA Charges &nbsp;|&nbsp; As of ${fmtDate(asOf)}</p>
        ${containerBlocks}
        ${summaryBlock}
        ${spBlocks}
        ${spSummaryBlock}
        ${ocBlocks}
        ${ocSummaryBlock}
        ${combinedBlock}
      </div>
    </body>
    </html>`;

  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Storage_Charge_Report.doc';
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('wordBtn').addEventListener('click', generateWordReport);

/* ---------------- PDF REPORT ---------------- */
function generatePDFReport(){
  const asOf = getAsOf();
  const asOfDT = getOCAsOf();
  if(containers.length === 0 && spUnits.length === 0 && otherCharges.length === 0){
    alert('Add at least one item (container, self-propelled unit, or other charge) before downloading a report.');
    return;
  }
  if(!window.jspdf){
    alert('PDF library did not load — please check your internet connection and try again.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'pt', format:'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const navy = [21,49,82];
  const gold = [201,162,74];
  const ink = [20,31,41];
  const inkSoft = [75,90,103];

  const rows = containers.map(c => ({ c, r: computeContainer(c, asOf) }));
  let grand = 0;

  function drawHeader(title){
    doc.setFillColor(...navy);
    doc.rect(0, 0, pageW, 72, 'F');
    doc.setDrawColor(...gold);
    doc.setLineWidth(2);
    doc.line(0, 72, pageW, 72);

    doc.setDrawColor(...gold);
    doc.setLineWidth(1.4);
    doc.circle(40, 36, 15, 'S');
    doc.circle(40, 30, 4, 'S');
    doc.line(40, 34, 40, 44);
    doc.line(34, 38, 46, 38);

    doc.setTextColor(255,255,255);
    doc.setFont('helvetica','bold');
    doc.setFontSize(14);
    doc.text('OMLIN CONSULTANCY LTD', 64, 30);
    doc.setFont('helvetica','normal');
    doc.setFontSize(8.5);
    doc.setTextColor(231,216,169);
    doc.text('SHIPPING  ·  CUSTOMS  ·  LOGISTICS', 64, 42);

    doc.setFont('helvetica','bold');
    doc.setFontSize(11);
    doc.setTextColor(255,255,255);
    doc.text(title, pageW - 40, 30, { align:'right' });
    doc.setFont('helvetica','normal');
    doc.setFontSize(8.5);
    doc.setTextColor(201,213,223);
    doc.text('As of ' + fmtDate(asOf), pageW - 40, 42, { align:'right' });
  }

  function drawFooter(){
    const pageCount = doc.internal.getNumberOfPages();
    for(let i=1;i<=pageCount;i++){
      doc.setPage(i);
      doc.setDrawColor(...gold);
      doc.setLineWidth(0.6);
      doc.line(40, pageH - 42, pageW - 40, pageH - 42);
      doc.setFont('helvetica','italic');
      doc.setFontSize(9);
      doc.setTextColor(...navy);
      doc.text('Powered by Omlin Consultancy', pageW/2, pageH - 28, { align:'center' });
      doc.setFont('helvetica','normal');
      doc.setFontSize(8);
      doc.setTextColor(...inkSoft);
      doc.text('Page ' + i + ' of ' + pageCount, pageW - 40, pageH - 28, { align:'right' });
    }
  }

  rows.forEach(({c, r}, idx) => {
    grand += r.total;
    if(idx > 0) doc.addPage();
    drawHeader('Storage Charge Report');

    doc.setTextColor(...ink);
    doc.setFont('helvetica','bold');
    doc.setFontSize(13);
    doc.text('Container ' + c.number, 40, 100);

    doc.autoTable({
      startY: 112,
      theme:'grid',
      styles:{ font:'helvetica', fontSize:9, textColor:ink, lineColor:[211,217,220], lineWidth:0.5 },
      headStyles:{ fillColor:navy, textColor:255, fontStyle:'bold' },
      margin:{ left:40, right:40 },
      head:[['Container Traits','','','']],
      body:[
        ['Container Number', c.number, 'Size', c.size + "'"],
        ['Category', c.category, 'Transit / Local', r.transitLocal],
        ['Discharge Date', fmtDate(parseDate(c.date)), 'As-of Date', fmtDate(asOf)],
        ['Days Elapsed', String(r.elapsed), 'Days Payable', String(r.daysPayable)],
      ],
      columnStyles:{0:{fontStyle:'bold', cellWidth:120},2:{fontStyle:'bold', cellWidth:120}},
    });

    const subtotal = r.tier1Amount + r.tier2Amount;
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 14,
      theme:'grid',
      styles:{ font:'helvetica', fontSize:9, textColor:ink, lineColor:[211,217,220], lineWidth:0.5 },
      headStyles:{ fillColor:navy, textColor:255, fontStyle:'bold' },
      margin:{ left:40, right:40 },
      head:[['Storage Level','Date Range','Days','Rate/Day','Amount']],
      body:[
        ['Free Period', fmtDate(r.freeStart) + '  ->  ' + fmtDate(r.freeEnd), String(r.freeDays), '—', '$0.00'],
        ['Tier 1', r.tier1Days>0 ? fmtDate(r.tier1Start)+'  ->  '+fmtDate(r.tier1EndDate) : 'Not reached', String(r.tier1Days), fmtMoney(r.rate1), fmtMoney(r.tier1Amount)],
        ['Tier 2', r.tier2Days>0 ? 'from '+fmtDate(r.tier2Start)+'  ->  '+fmtDate(r.tier2EndDate) : 'Not reached', String(r.tier2Days), fmtMoney(r.rate2), fmtMoney(r.tier2Amount)],
        [{content:'SUBTOTAL (Storage, Tier 1 + Tier 2)', colSpan:4, styles:{halign:'right', fontStyle:'bold', fillColor:[238,243,246]}}, {content:fmtMoney(subtotal), styles:{fontStyle:'bold', fillColor:[238,243,246]}}],
        [{content:'Re-marshalling (one-time charge)', colSpan:4, styles:{halign:'right'}}, r.daysPayable>0 ? fmtMoney(r.remarshal) : 'N/A'],
        [{content:'GRAND TOTAL — ' + c.number, colSpan:4, styles:{halign:'right', fontStyle:'bold', fillColor:navy, textColor:255}}, {content:fmtMoney(r.total), styles:{fontStyle:'bold', fillColor:navy, textColor:255}}],
      ],
    });
  });

  if(rows.length > 1){
    doc.addPage();
    drawHeader('Summary — All Containers');
    doc.setTextColor(...ink);
    doc.setFont('helvetica','bold');
    doc.setFontSize(13);
    doc.text('Summary — All Containers', 40, 100);

    const body = rows.map(({c, r}) => [c.number, c.size + "'", c.category, String(r.daysPayable), fmtMoney(r.total)]);
    body.push([{content:'GRAND TOTAL — ALL CONTAINERS', colSpan:4, styles:{halign:'right', fontStyle:'bold', fillColor:navy, textColor:255}}, {content:fmtMoney(grand), styles:{fontStyle:'bold', fillColor:navy, textColor:255}}]);

    doc.autoTable({
      startY: 112,
      theme:'grid',
      styles:{ font:'helvetica', fontSize:9, textColor:ink, lineColor:[211,217,220], lineWidth:0.5 },
      headStyles:{ fillColor:navy, textColor:255, fontStyle:'bold' },
      margin:{ left:40, right:40 },
      head:[['Container','Size','Category','Days Payable','Total']],
      body:body,
    });
  }

  /* ---- SELF-PROPELLED UNITS ---- */
  const spRows = spUnits.map(u => ({ u, r: computeSPUnit(u, asOf) }));
  let spGrand = 0;
  const startedAlready = rows.length > 0;
  spRows.forEach(({u, r}, idx) => {
    spGrand += r.total;
    if(startedAlready || idx > 0) doc.addPage();
    drawHeader('Self-Propelled Unit Report');

    doc.setTextColor(...ink);
    doc.setFont('helvetica','bold');
    doc.setFontSize(13);
    doc.text('Self-Propelled Unit — ' + u.reference, 40, 100);

    doc.autoTable({
      startY: 112,
      theme:'grid',
      styles:{ font:'helvetica', fontSize:9, textColor:ink, lineColor:[211,217,220], lineWidth:0.5 },
      headStyles:{ fillColor:navy, textColor:255, fontStyle:'bold' },
      margin:{ left:40, right:40 },
      head:[['Unit Traits','','','']],
      body:[
        ['Cargo Reference', u.reference, 'Local / Transit', u.transitLocal],
        ['Weight Category', { content: r.catLabel, colSpan:3 }],
        ['Discharge Date', fmtDate(parseDate(u.date)), 'As-of Date', fmtDate(asOf)],
        ['Days Elapsed', String(r.elapsed), 'Free Days', String(r.freeDays)],
      ],
      columnStyles:{0:{fontStyle:'bold', cellWidth:120},2:{fontStyle:'bold', cellWidth:120}},
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 14,
      theme:'grid',
      styles:{ font:'helvetica', fontSize:9, textColor:ink, lineColor:[211,217,220], lineWidth:0.5 },
      headStyles:{ fillColor:navy, textColor:255, fontStyle:'bold' },
      margin:{ left:40, right:40 },
      head:[['Charge','Days Payable','Rate/Day','Amount']],
      body:[
        ['Storage', String(r.daysPayable), fmtMoney(r.rate), fmtMoney(r.total)],
        [{content:'GRAND TOTAL — ' + u.reference, colSpan:3, styles:{halign:'right', fontStyle:'bold', fillColor:navy, textColor:255}}, {content:fmtMoney(r.total), styles:{fontStyle:'bold', fillColor:navy, textColor:255}}],
      ],
    });
  });

  if(spRows.length > 1){
    doc.addPage();
    drawHeader('Summary — All Self-Propelled Units');
    doc.setTextColor(...ink);
    doc.setFont('helvetica','bold');
    doc.setFontSize(13);
    doc.text('Summary — All Self-Propelled Units', 40, 100);

    const body = spRows.map(({u, r}) => [u.reference, r.catLabel, u.transitLocal, String(r.daysPayable), fmtMoney(r.total)]);
    body.push([{content:'GRAND TOTAL — ALL SELF-PROPELLED UNITS', colSpan:4, styles:{halign:'right', fontStyle:'bold', fillColor:navy, textColor:255}}, {content:fmtMoney(spGrand), styles:{fontStyle:'bold', fillColor:navy, textColor:255}}]);

    doc.autoTable({
      startY: 112,
      theme:'grid',
      styles:{ font:'helvetica', fontSize:8.5, textColor:ink, lineColor:[211,217,220], lineWidth:0.5 },
      headStyles:{ fillColor:navy, textColor:255, fontStyle:'bold' },
      margin:{ left:40, right:40 },
      head:[['Reference','Weight Category','Local/Transit','Days Payable','Total']],
      body:body,
    });
  }

  /* ---- OTHER CHARGES ---- */
  const ocRows = otherCharges.map(item => ({ item, r: computeOtherCharge(item, asOfDT) }));
  let ocGrand = 0;
  const startedAlready2 = rows.length > 0 || spRows.length > 0;
  ocRows.forEach(({item, r}, idx) => {
    ocGrand += r.total;
    if(startedAlready2 || idx > 0) doc.addPage();
    drawHeader('Other Charges Report');

    doc.setTextColor(...ink);
    doc.setFont('helvetica','bold');
    doc.setFontSize(13);
    doc.text('Other Charges — ' + item.reference, 40, 100);

    doc.autoTable({
      startY: 112,
      theme:'grid',
      styles:{ font:'helvetica', fontSize:9, textColor:ink, lineColor:[211,217,220], lineWidth:0.5 },
      headStyles:{ fillColor:navy, textColor:255, fontStyle:'bold' },
      margin:{ left:40, right:40 },
      head:[['Charge Traits','','','']],
      body:[
        ['Reference', item.reference, 'Category', item.category],
        ['Size / Units / Weight Cat.', { content: r.label, colSpan:3 }],
      ],
      columnStyles:{0:{fontStyle:'bold', cellWidth:150},2:{fontStyle:'bold', cellWidth:90}},
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 14,
      theme:'grid',
      styles:{ font:'helvetica', fontSize:9, textColor:ink, lineColor:[211,217,220], lineWidth:0.5 },
      headStyles:{ fillColor:navy, textColor:255, fontStyle:'bold' },
      margin:{ left:40, right:40 },
      head:[['Charge Type','Amount']],
      body:[
        ['Shore Handling', r.shoreHandling > 0 ? fmtMoney(r.shoreHandling) : 'N/A'],
        ['Wharfage', r.wharfage > 0 ? fmtMoney(r.wharfage) : 'N/A'],
        ['IMCO Surcharge', r.imco > 0 ? fmtMoney(r.imco) : 'N/A'],
        ['Reefer Plug-in', r.reeferAmount > 0 ? fmtMoney(r.reeferAmount) + ' (' + r.reeferHours + ' hrs)' : 'N/A'],
        ['Quayside / Terminal Fee', r.quayside > 0 ? fmtMoney(r.quayside) : 'N/A'],
        [{content:'GRAND TOTAL — ' + item.reference, styles:{halign:'right', fontStyle:'bold', fillColor:navy, textColor:255}}, {content:fmtMoney(r.total), styles:{fontStyle:'bold', fillColor:navy, textColor:255}}],
      ],
    });
  });

  if(ocRows.length > 1){
    doc.addPage();
    drawHeader('Summary — All Other Charges');
    doc.setTextColor(...ink);
    doc.setFont('helvetica','bold');
    doc.setFontSize(13);
    doc.text('Summary — All Other Charges', 40, 100);

    const body = ocRows.map(({item, r}) => [item.reference, item.category, r.label, fmtMoney(r.total)]);
    body.push([{content:'GRAND TOTAL — ALL OTHER CHARGES', colSpan:3, styles:{halign:'right', fontStyle:'bold', fillColor:navy, textColor:255}}, {content:fmtMoney(ocGrand), styles:{fontStyle:'bold', fillColor:navy, textColor:255}}]);

    doc.autoTable({
      startY: 112,
      theme:'grid',
      styles:{ font:'helvetica', fontSize:8.5, textColor:ink, lineColor:[211,217,220], lineWidth:0.5 },
      headStyles:{ fillColor:navy, textColor:255, fontStyle:'bold' },
      margin:{ left:40, right:40 },
      head:[['Reference','Category','Size/Units/Cat','Total']],
      body:body,
    });
  }

  /* ---- COMBINED GRAND TOTAL ---- */
  const totalItems = rows.length + spRows.length + ocRows.length;
  if(totalItems > 1){
    doc.addPage();
    drawHeader('Combined Grand Total');
    doc.setTextColor(...ink);
    doc.setFont('helvetica','bold');
    doc.setFontSize(13);
    doc.text('Combined Grand Total', 40, 100);

    const combinedTotal = grand + spGrand + ocGrand;
    doc.autoTable({
      startY: 112,
      theme:'grid',
      styles:{ font:'helvetica', fontSize:10, textColor:ink, lineColor:[211,217,220], lineWidth:0.5 },
      margin:{ left:40, right:40 },
      body:[
        ['Storage & Remarshalling — Containers', fmtMoney(grand)],
        ['Storage — Self-Propelled Units', fmtMoney(spGrand)],
        ['Other Charges', fmtMoney(ocGrand)],
        [{content:'COMBINED GRAND TOTAL', styles:{fontStyle:'bold', fillColor:navy, textColor:255}}, {content:fmtMoney(combinedTotal), styles:{fontStyle:'bold', fillColor:navy, textColor:255}}],
      ],
    });
  }

  drawFooter();
  doc.save('Storage_Charge_Report.pdf');
}

document.getElementById('pdfBtn').addEventListener('click', generatePDFReport);

/* ================================================================
   TAB SWITCHING
   ================================================================ */
document.getElementById('tabBtn1').addEventListener('click', () => switchTab('tab1'));
document.getElementById('tabBtn2').addEventListener('click', () => switchTab('tab2'));
function switchTab(tab){
  document.getElementById('tab1Panel').classList.toggle('hidden', tab !== 'tab1');
  document.getElementById('tab2Panel').classList.toggle('hidden', tab !== 'tab2');
  document.getElementById('tabBtn1').classList.toggle('active', tab === 'tab1');
  document.getElementById('tabBtn2').classList.toggle('active', tab === 'tab2');
}

/* ================================================================
   SELF-PROPELLED UNITS — STORAGE (Tab 1)
   Accrues per unit, per day. No re-marshalling. Free days entered
   manually per unit (not fixed in the tariff data).
   ================================================================ */
function populateSPCategorySelect(selectEl){
  selectEl.innerHTML = SP_CATEGORIES.map(c => `<option value="${c.key}">${c.label}</option>`).join('');
}

function computeSPUnit(u, asOf){
  const cat = SP_CATEGORIES.find(c => c.key === u.category);
  const discharge = parseDate(u.date);
  const elapsedRaw = daysBetween(discharge, asOf);
  const elapsed = Math.max(elapsedRaw, 0);
  const future = elapsedRaw < 0;
  const freeDays = u.freeDays;
  const daysPayable = Math.max(elapsed - freeDays, 0);
  const rate = u.transitLocal === "Transit" ? cat.storageTransit : cat.storageLocal;
  const total = daysPayable * rate;
  return { elapsed, future, freeDays, daysPayable, rate, total, catLabel: cat.label };
}

function renderSP(){
  const asOf = getAsOf();
  const tbody = document.getElementById('spTbody');
  const emptyState = document.getElementById('spEmptyState');
  tbody.innerHTML = "";
  emptyState.style.display = spUnits.length === 0 ? "block" : "none";

  let subtotal = 0;
  spUnits.forEach(u => {
    const r = computeSPUnit(u, asOf);
    subtotal += r.total;
    const tr = document.createElement('tr');
    tr.className = 'row';
    tr.innerHTML = `
      <td></td>
      <td><span class="container-no">${u.reference || '—'}</span></td>
      <td>${r.catLabel}</td>
      <td><span class="badge ${u.transitLocal === 'Transit' ? 'transit' : 'local'}">${u.transitLocal}</span></td>
      <td class="mono">${fmtDate(parseDate(u.date))}</td>
      <td class="mono">${r.future ? '<span class="warn">future</span>' : r.elapsed + 'd'}</td>
      <td class="mono">${r.freeDays}d</td>
      <td><span class="days-payable ${r.daysPayable>0?'pos':'zero'}">${r.daysPayable}d</span></td>
      <td class="mono">${fmtMoney(r.rate)}</td>
      <td class="total-amt">${fmtMoney(r.total)}</td>
      <td><button class="del-btn" data-spdel="${u.id}" title="Remove">×</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('spGrandTotal').textContent = fmtMoney(subtotal);
  document.getElementById('spCountHint').textContent = spUnits.length + (spUnits.length===1 ? ' unit' : ' units');
  updateTab1GrandTotal();
}

function updateTab1GrandTotal(){
  const asOf = getAsOf();
  const containersTotal = containers.reduce((sum,c) => sum + computeContainer(c, asOf).total, 0);
  const spTotal = spUnits.reduce((sum,u) => sum + computeSPUnit(u, asOf).total, 0);
  document.getElementById('tab1GrandTotal').textContent = fmtMoney(containersTotal + spTotal);
}

document.getElementById('spTbody').addEventListener('click', (e) => {
  const del = e.target.closest('[data-spdel]');
  if(del){
    const id = Number(del.dataset.spdel);
    spUnits = spUnits.filter(u => u.id !== id);
    renderSP();
  }
});

document.getElementById('spAddBtn').addEventListener('click', () => {
  const reference = document.getElementById('spInReference').value.trim();
  const category = document.getElementById('spInCategory').value;
  const transitLocal = document.getElementById('spInTransitLocal').value;
  const date = document.getElementById('spInDate').value;
  const freeDaysRaw = document.getElementById('spInFreeDays').value;
  const warn = document.getElementById('spFormWarn');

  if(!reference || !date){
    warn.textContent = "Cargo reference and discharge date are required.";
    warn.style.display = "block";
    return;
  }
  const freeDays = Number(freeDaysRaw);
  if(freeDaysRaw === "" || isNaN(freeDays) || freeDays < 0){
    warn.textContent = "Free days must be a number of 0 or more.";
    warn.style.display = "block";
    return;
  }
  warn.style.display = "none";

  spUnits.push({ id: spNextId++, reference, category, transitLocal, date, freeDays });
  document.getElementById('spInReference').value = "";
  document.getElementById('spInDate').value = "";
  document.getElementById('spInFreeDays').value = "0";
  document.getElementById('spInReference').focus();
  renderSP();
});

document.getElementById('spExportCsvBtn').addEventListener('click', () => {
  const asOf = getAsOf();
  let rows = [["Reference","Weight Category","Local/Transit","Discharge Date","Days Elapsed","Free Days","Days Payable","Rate/Day","Total Amount"]];
  spUnits.forEach(u => {
    const r = computeSPUnit(u, asOf);
    rows.push([u.reference, r.catLabel, u.transitLocal, u.date, r.elapsed, r.freeDays, r.daysPayable, r.rate.toFixed(2), r.total.toFixed(2)]);
  });
  const csv = rows.map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'self-propelled-storage.csv';
  a.click();
  URL.revokeObjectURL(url);
});

/* ================================================================
   OTHER CHARGES (Tab 2)
   One-time charges (Shore Handling, Wharfage, IMCO Surcharge,
   Quayside/Terminal fee). Reefer Plug-in is the one exception —
   it accrues per hour, billed on any commenced hour.
   ================================================================ */
function populateOCCategorySelect(){
  const sel = document.getElementById('ocInCategory');
  sel.innerHTML = Object.keys(OTHER_CATEGORIES).map(k => `<option value="${k}">${k}</option>`).join('');
}

function getOCAsOf(){
  const v = document.getElementById('asOfDateTime').value;
  return v || nowDateTimeLocal();
}

function updateOCFormFields(){
  const category = document.getElementById('ocInCategory').value;
  const cat = OTHER_CATEGORIES[category];
  const sizeField = document.getElementById('ocSizeField');
  const unitsField = document.getElementById('ocUnitsField');
  const tlField = document.getElementById('ocTransitLocalField');
  const spField = document.getElementById('ocSPCategoryField');
  const qtyField = document.getElementById('ocQuantityField');
  const qtyLabel = document.getElementById('ocQuantityLabel');
  const reeferField = document.getElementById('ocReeferField');
  const reeferStartField = document.getElementById('ocReeferStartField');
  const refLabel = document.getElementById('ocReferenceLabel');
  const refInput = document.getElementById('ocInReference');

  sizeField.classList.toggle('hidden', cat.kind !== 'sized');
  unitsField.classList.toggle('hidden', cat.kind !== 'units');
  tlField.classList.toggle('hidden', cat.kind !== 'quantity');
  spField.classList.toggle('hidden', cat.kind !== 'selfpropelled');
  qtyField.classList.toggle('hidden', !(cat.kind === 'quantity' || cat.kind === 'selfpropelled'));
  if(cat.kind === 'quantity') qtyLabel.textContent = 'Quantity (' + cat.unitLabel + ')';
  if(cat.kind === 'selfpropelled') qtyLabel.textContent = 'Quantity (CBM)';

  const reeferAvailable = cat.kind === 'sized' && !!cat.reefer;
  reeferField.classList.toggle('hidden', !reeferAvailable);
  const reeferChecked = reeferAvailable && document.getElementById('ocInReeferEnabled').checked;
  reeferStartField.classList.toggle('hidden', !reeferChecked);
  if(!reeferAvailable) document.getElementById('ocInReeferEnabled').checked = false;

  if(NON_CONTAINERISED.has(category)){
    refLabel.textContent = 'Cargo reference';
    refInput.placeholder = 'e.g. B/L or cargo ref.';
  } else {
    refLabel.textContent = 'Container number';
    refInput.placeholder = 'e.g. CAAU7085328';
  }
}
document.getElementById('ocInCategory').addEventListener('change', updateOCFormFields);
document.getElementById('ocInReeferEnabled').addEventListener('change', updateOCFormFields);

function computeOtherCharge(item, asOfDateTimeStr){
  const cat = OTHER_CATEGORIES[item.category];
  let shoreHandling = 0, wharfage = 0, imco = 0, reeferAmount = 0, reeferHours = 0, quayside = 0, label = "—";

  if(cat.kind === "sized"){
    shoreHandling = cat.shoreHandling[item.size];
    wharfage = cat.wharfage[item.size];
    imco = cat.imco ? cat.imco[item.size] : 0;
    label = item.size + "'";
    if(cat.reefer && item.reeferEnabled){
      reeferHours = hoursBetween(item.reeferStart, asOfDateTimeStr);
      reeferAmount = reeferHours * cat.reefer[item.size];
    }
  } else if(cat.kind === "units"){
    shoreHandling = cat.shoreHandling[item.units];
    wharfage = cat.wharfage[item.units];
    quayside = cat.quayside[item.units];
    label = item.units + (Number(item.units)===1 ? " unit" : " units");
  } else if(cat.kind === "quantity"){
    const tl = item.transitLocal;
    shoreHandling = cat.shoreHandling[tl] * item.quantity;
    wharfage = cat.wharfage[tl] * item.quantity;
    quayside = cat.quayside[tl] * item.quantity;
    label = item.quantity + " " + cat.unitLabel + " (" + tl + ")";
  } else if(cat.kind === "selfpropelled"){
    const sp = SP_CATEGORIES.find(s => s.key === item.spCategory);
    shoreHandling = sp.shoreHandling;
    wharfage = sp.wharfage;
    quayside = cat.quaysidePerCBM * item.quantity;
    label = sp.label;
  }

  const total = shoreHandling + wharfage + imco + reeferAmount + quayside;
  return { shoreHandling, wharfage, imco, reeferAmount, reeferHours, quayside, total, label };
}

function renderOC(){
  const asOfDT = getOCAsOf();
  const tbody = document.getElementById('ocTbody');
  const emptyState = document.getElementById('ocEmptyState');
  tbody.innerHTML = "";
  emptyState.style.display = otherCharges.length === 0 ? "block" : "none";

  let total = 0;
  otherCharges.forEach(item => {
    const r = computeOtherCharge(item, asOfDT);
    total += r.total;
    const tr = document.createElement('tr');
    tr.className = 'row';
    const reeferCell = r.reeferAmount > 0
      ? `${fmtMoney(r.reeferAmount)}<div class="gauge-caption">${r.reeferHours}h</div>`
      : (OTHER_CATEGORIES[item.category].reefer ? '—' : '<span style="color:var(--ink-soft)">N/A</span>');
    tr.innerHTML = `
      <td></td>
      <td><span class="container-no">${item.reference || '—'}</span></td>
      <td style="font-size:12px;">${item.category}</td>
      <td style="font-size:12px;">${r.label}</td>
      <td class="mono">${fmtMoney(r.shoreHandling)}</td>
      <td class="mono">${fmtMoney(r.wharfage)}</td>
      <td class="mono">${r.imco > 0 ? fmtMoney(r.imco) : '<span style="color:var(--ink-soft)">N/A</span>'}</td>
      <td class="mono">${reeferCell}</td>
      <td class="mono">${r.quayside > 0 ? fmtMoney(r.quayside) : '<span style="color:var(--ink-soft)">N/A</span>'}</td>
      <td class="total-amt">${fmtMoney(r.total)}</td>
      <td><button class="del-btn" data-ocdel="${item.id}" title="Remove">×</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('ocGrandTotal').textContent = fmtMoney(total);
  document.getElementById('ocCountHint').textContent = otherCharges.length + (otherCharges.length===1 ? ' charge' : ' charges');
}

document.getElementById('ocTbody').addEventListener('click', (e) => {
  const del = e.target.closest('[data-ocdel]');
  if(del){
    const id = Number(del.dataset.ocdel);
    otherCharges = otherCharges.filter(item => item.id !== id);
    renderOC();
  }
});

document.getElementById('asOfDateTime').addEventListener('change', renderOC);

document.getElementById('ocAddBtn').addEventListener('click', () => {
  const category = document.getElementById('ocInCategory').value;
  const cat = OTHER_CATEGORIES[category];
  const reference = document.getElementById('ocInReference').value.trim();
  const warn = document.getElementById('ocFormWarn');

  if(!reference){
    warn.textContent = NON_CONTAINERISED.has(category) ? "Cargo reference is required." : "Container number is required.";
    warn.style.display = "block";
    return;
  }

  const item = { id: ocNextId++, category, reference };

  if(cat.kind === 'sized'){
    item.size = Number(document.getElementById('ocInSize').value);
    const reeferEnabled = cat.reefer && document.getElementById('ocInReeferEnabled').checked;
    item.reeferEnabled = !!reeferEnabled;
    if(reeferEnabled){
      const start = document.getElementById('ocInReeferStart').value;
      if(!start){
        warn.textContent = "Reefer plug-in start date/time is required.";
        warn.style.display = "block";
        return;
      }
      item.reeferStart = start;
    }
  } else if(cat.kind === 'units'){
    item.units = Number(document.getElementById('ocInUnits').value);
  } else if(cat.kind === 'quantity'){
    item.transitLocal = document.getElementById('ocInTransitLocal').value;
    const qty = Number(document.getElementById('ocInQuantity').value);
    if(!qty || qty <= 0){
      warn.textContent = "Quantity must be greater than 0.";
      warn.style.display = "block";
      return;
    }
    item.quantity = qty;
  } else if(cat.kind === 'selfpropelled'){
    item.spCategory = document.getElementById('ocInSPCategory').value;
    const qty = Number(document.getElementById('ocInQuantity').value);
    if(!qty || qty <= 0){
      warn.textContent = "CBM quantity must be greater than 0.";
      warn.style.display = "block";
      return;
    }
    item.quantity = qty;
  }

  warn.style.display = "none";
  otherCharges.push(item);
  document.getElementById('ocInReference').value = "";
  document.getElementById('ocInReeferEnabled').checked = false;
  document.getElementById('ocInReeferStart').value = "";
  updateOCFormFields();
  document.getElementById('ocInReference').focus();
  renderOC();
});

document.getElementById('ocExportCsvBtn').addEventListener('click', () => {
  const asOfDT = getOCAsOf();
  let rows = [["Reference","Category","Size/Units/Weight Cat","Shore Handling","Wharfage","IMCO Surcharge","Reefer Hours","Reefer Amount","Quayside/Terminal","Total Amount"]];
  otherCharges.forEach(item => {
    const r = computeOtherCharge(item, asOfDT);
    rows.push([item.reference, item.category, r.label, r.shoreHandling.toFixed(2), r.wharfage.toFixed(2), r.imco.toFixed(2), r.reeferHours, r.reeferAmount.toFixed(2), r.quayside.toFixed(2), r.total.toFixed(2)]);
  });
  const csv = rows.map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'other-charges.csv';
  a.click();
  URL.revokeObjectURL(url);
});

/* ---------------- INIT ---------------- */
document.getElementById('asOfDate').value = todayISO();
document.getElementById('asOfDateTime').value = nowDateTimeLocal();
populateSPCategorySelect(document.getElementById('spInCategory'));
populateSPCategorySelect(document.getElementById('ocInSPCategory'));
populateOCCategorySelect();
updateOCFormFields();
render();
renderSP();
renderOC();

