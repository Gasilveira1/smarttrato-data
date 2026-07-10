// scrape.js — coleta diária de preços do boi gordo (Indicador Datagro SP + curva de futuros BGI/B3)
// Roda no GitHub Actions (Node 20+). Usa o Jina Reader (r.jina.ai) para ler as páginas sem servidor próprio.
// Salva/atualiza o histórico em boi.json (um registro por dia, datado pelo "Fechamento" da página da B3).

const fs = require('fs');

const B3_LET = ['F','G','H','J','K','M','N','Q','U','V','X','Z']; // índice 0=jan ... 11=dez
const MONTH_PT = { janeiro:1, fevereiro:2, 'março':3, marco:3, abril:4, maio:5, junho:6,
                   julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12 };

const brNum = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.'));

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

// Curva de futuros BGI (B3): linhas "Mês/AnoCompleto | preço" — o ano de 4 dígitos filtra a B3 (ignora tabelas com ano de 2 dígitos)
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

// Data do fechamento exibido na página: "Fechamento: DD/MM/AAAA" -> "AAAA-MM-DD"
function parseFechamento(txt) {
  const m = txt.match(/Fechamento:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

async function jina(url) {
  const r = await fetch('https://r.jina.ai/' + url, { headers: { 'Accept': 'text/plain' } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + url);
  return await r.text();
}

const URL_FUT = 'https://www.noticiasagricolas.com.br/cotacoes/boi-gordo/boi-gordo-b3-prego-regular';
const URL_DAT = 'https://www.noticiasagricolas.com.br/cotacoes/boi-gordo/indicador-do-boi';

(async () => {
  const t1 = await jina(URL_FUT);
  let t2 = '';
  try { t2 = await jina(URL_DAT); } catch (e) {}

  const fut = parseBGI(t1);
  const datagro = parseDatagro(t2) || parseDatagro(t1);
  const fech = parseFechamento(t1) || parseFechamento(t2);

  if (Object.keys(fut).length === 0 && !datagro) {
    console.error('Nada capturado — a fonte pode ter mudado de formato. Abortando sem alterar o histórico.');
    process.exit(1);
  }

  // usa a data do "Fechamento" da página; se faltar, usa a data de hoje (fuso de São Paulo)
  const d = fech || new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const snap = { d, datagro: datagro || 0, fut };

  const file = 'boi.json';
  let hist = [];
  try { hist = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(hist)) hist = []; } catch (e) {}

  const i = hist.findIndex(x => x.d === d);
  if (i >= 0) hist[i] = snap; else hist.push(snap);
  hist.sort((a, b) => (a.d < b.d ? -1 : 1));

  fs.writeFileSync(file, JSON.stringify(hist, null, 1));
  console.log('OK', d, '| Datagro', snap.datagro, '| contratos', Object.keys(fut).length);
})().catch(e => { console.error(e); process.exit(1); });