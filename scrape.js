// scrape.js — coleta diária de preços do boi gordo (CEPEA à vista, Datagro SP e curva de futuros BGI/B3)
// Roda no GitHub Actions (Node 20+). Usa o Jina Reader (r.jina.ai) para ler as páginas sem servidor próprio.
// Salva/atualiza o histórico em boi.json (um registro por dia, fuso de São Paulo).

const fs = require('fs');

const B3_LET = ['F','G','H','J','K','M','N','Q','U','V','X','Z']; // índice 0=jan ... 11=dez
const MONTH_PT = { janeiro:1, fevereiro:2, 'março':3, marco:3, abril:4, maio:5, junho:6,
                   julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12 };

const brNum = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.'));

// CEPEA/ESALQ à vista: marcador "à vista R$" + primeiro preço nos próximos ~400 chars
function parseCepea(txt) {
  const t = txt.replace(/\s+/g, ' ');
  const i = t.search(/à\s*vista\s*R\$/i);
  if (i < 0) return null;
  const m = t.slice(i, i + 400).match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
  return m ? brNum(m[1]) : null;
}

// Datagro: linha da praça São Paulo do fechamento mais recente (1ª ocorrência = topo), 1º preço R$/@
function parseDatagro(txt) {
  const t = txt.replace(/\s+/g, ' ');
  const bound = v => v != null && v > 100 && v < 900;
  const i = t.search(/S[ãa]o\s*Paulo/i);
  if (i >= 0) {
    const m = t.slice(i, i + 120).match(/(\d{3}(?:\.\d{3})*,\d{2})/);
    if (m) { const v = brNum(m[1]); if (bound(v)) return v; }
  }
  const m = t.match(/\bSP\b[^\d]{0,40}?(\d{3}(?:\.\d{3})*,\d{2})/);
  if (m) { const v = brNum(m[1]); if (bound(v)) return v; }
  return null;
}

// Curva de futuros BGI (B3): linhas "Mês/AnoCompleto | preço" — o ano de 4 dígitos filtra a B3 e ignora o CBOT (2 dígitos)
function parseBGI(txt) {
  const t = txt.replace(/\s+/g, ' ');
  const out = {};
  const re = /([A-Za-zçÇãÃéÉ]+)\/(\d{4})\s*\|?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  let m;
  while ((m = re.exec(t))) {
    const mo = MONTH_PT[m[1].toLowerCase()];
    if (!mo) continue;
    const tk = 'BGI' + B3_LET[mo - 1] + m[2].slice(2);
    const v = brNum(m[3]);
    if (v > 50 && v < 2000) out[tk] = v;
  }
  return out;
}

async function jina(url) {
  const r = await fetch('https://r.jina.ai/' + url, { headers: { 'Accept': 'text/plain' } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + url);
  return await r.text();
}

(async () => {
  const t1 = await jina('https://www.noticiasagricolas.com.br/cotacoes/boi-gordo');
  let t2 = '';
  try { t2 = await jina('https://www.noticiasagricolas.com.br/cotacoes/boi-gordo/indicador-do-boi'); } catch (e) {}

  const cepea = parseCepea(t1);
  const fut = parseBGI(t1);
  const datagro = parseDatagro(t2) || parseDatagro(t1);

  if (Object.keys(fut).length === 0 && !cepea && !datagro) {
    console.error('Nada capturado — a fonte pode ter mudado de formato. Abortando sem alterar o histórico.');
    process.exit(1);
  }

  // data de hoje no fuso de São Paulo (YYYY-MM-DD)
  const d = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const snap = { d, datagro: datagro || 0, cepea: cepea || 0, fut };

  const file = 'boi.json';
  let hist = [];
  try { hist = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(hist)) hist = []; } catch (e) {}

  const i = hist.findIndex(x => x.d === d);
  if (i >= 0) hist[i] = snap; else hist.push(snap);
  hist.sort((a, b) => (a.d < b.d ? -1 : 1));

  fs.writeFileSync(file, JSON.stringify(hist, null, 1));
  console.log('OK', d, '| Datagro', snap.datagro, '| CEPEA', snap.cepea, '| contratos', Object.keys(fut).length);
})().catch(e => { console.error(e); process.exit(1); });

