import express from 'express';

/**
 * Local stand-in for igreval.maharashtra.gov.in/eASR2.0 used by the tests. It reproduces the real site's markup
 * (control ids/names, grids, pager, survey textarea), its WebForms state (state travels in __VIEWSTATE), MS-AJAX
 * partial responses, and its quirks: grid paging only works with the session cookie issued by frmMap.aspx,
 * otherwise the site answers with a pageRedirect to the map.
 */

const PORT = 47811;
const P = 'ctl00$ContentPlaceHolder5$';
const ID = 'ctl00_ContentPlaceHolder5_';
const YEARS = { 13: '2026-2027', 12: '2025-2026' };
const TALUKAS = { 58: 'Khed', 54: 'Haveli' };
const VILLAGES = {
  58: { 295: 'Mau. Chakan (Chakan Nagarparishad)', 5489: 'Adgaon', 999: 'No Rates Village' },
  54: { 7158: 'Kadamvak Vasti' },
};
const PAGE_SIZE = 5;
const factor = (year) => (Number(year) === 12 ? 0.9 : 1);

const urbanRows = (year) =>
  Array.from({ length: 7 }, (_v, i) => ({
    zone: `${i + 1} - पुणे नाशिक महामार्ग झोन ${i + 1}`,
    rates: [13370, 44280, 50930, 55350, 0].map((r) => Math.round((r - i * 100) * factor(year))),
    unit: 'चौ. मीटर',
    survey: i === 6 ? '-' : `${10 + i} , ${493 + i} , ${1173 + i}`,
  }));
const LOCATIONS = { 59915: 'जिरायत  जमिनी', 59919: 'बिनशेती संभाव्यता असलेल्या जमिनी' };
const influenceRows = (loc) => [
  { vibhag: loc === 59915 ? '6/6.1' : '11/11.1', zone: `${loc === 59915 ? '6.1' : '11.1'}-गावठाण परिघस्त क्षेत्रातील जमिनी`, rate: loc === 59915 ? 7610 : 10510, unit: 'चौरस मीटर', survey: loc === 59915 ? '4 , 5' : '43 , 90 , 140' },
  { vibhag: loc === 59915 ? '6/6.2' : '11/11.2', zone: `${loc === 59915 ? '6.2' : '11.2'}-उर्वरीत जमिनी`, rate: loc === 59915 ? 21575000 : 10060, unit: loc === 59915 ? 'हेक्टर' : 'चौरस मीटर', survey: '15' },
];
const RURAL = [
  ['जिरायत शेत जमिन', '0-1.25', 518000],
  ['जिरायत शेत जमिन', '1.26-2.50', 590000],
  ['ऊस शेती', '0-7.50', 2014000],
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const pb = (target, arg = '') => `javascript:__doPostBack(&#39;${target}&#39;,&#39;${arg}&#39;)`;
const select = (name, options, selected, { disabled = false, placeholder } = {}) =>
  `<select name="${P}${name}" onchange="javascript:setTimeout(&#39;__doPostBack(\\&#39;${P}${name}\\&#39;,\\&#39;\\&#39;)&#39;, 0)" id="${ID}${name}"${disabled ? ' disabled="disabled"' : ''} class="form-control marginForddl">\n` +
  (placeholder ? `\t<option${selected == null ? ' selected="selected"' : ''} value="${placeholder}">${placeholder}</option>\n` : '') +
  Object.entries(options)
    .map(([v, t]) => `\t<option${String(selected) === String(v) ? ' selected="selected"' : ''} value="${v}">${esc(t)}</option>`)
    .join('\n') +
  '\n</select>';

function pager(grid, page, pages) {
  if (pages < 2) return '';
  const cells = Array.from({ length: pages }, (_v, i) => (i + 1 === page ? `<td><span>${i + 1}</span></td>` : `<td><a href="${pb(`${P}${grid}`, `Page$${i + 1}`)}" style="color:Black;">${i + 1}</a></td>`));
  return `<tr class="cssPager" align="center"><td colspan="8"><table border="0"><tr>${cells.join('')}</tr></table></td></tr>`;
}

function panel(st) {
  let body = `<table style="padding-top: 7%;"><tbody><tr><td><span id="${ID}lblYear">Year</span></td><td>${select('ddlYear', YEARS, st.year)}</td>
    <td><span id="${ID}lblLanguage">Language</span></td><td>${select('ddlLanguage', { 'en-US': 'English', 'mr-IN': 'Marathi' }, 'en-US').replace(/value="en-US"/, 'value="en-US"')}</td></tr>
    <tr><td colspan="5"><table><tbody>
    <tr><td><span id="${ID}lblDistrict">Selected District</span></td><td>${select('ddlDistrict', { 23: 'Pune' }, 23, { disabled: true })}</td></tr>
    <tr><td><span id="${ID}lblTaluka">Select Taluka</span></td><td>${select('ddlTaluka', TALUKAS, st.taluka, { placeholder: '- - Select Taluka - -' })}</td></tr>
    <tr><td><span id="${ID}lblVillage">Select Village</span></td><td>${select('ddlVillage', st.taluka ? VILLAGES[st.taluka] : {}, st.village, { placeholder: st.taluka ? '- - Select Village - -' : undefined })}</td></tr>
    </tbody></table></td></tr>`;
  const v = Number(st.village);
  if (v === 295) {
    const rows = urbanRows(st.year);
    const pages = Math.ceil(rows.length / PAGE_SIZE);
    const page = st.page ?? 1;
    const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    body += `<tr><td colspan="5"><input id="${ID}rdbSurveyNo" type="radio" name="${P}grpSurveyLocation" value="rdbSurveyNo" /><input id="${ID}rdbLocation" type="radio" name="${P}grpSurveyLocation" value="rdbLocation" checked="checked" />
      <table cellspacing="0" cellpadding="3" align="Left" rules="cols" border="1" id="${ID}dg_Valuation2_0"><tr style="background-color:#7BC6DE;"><th scope="col">Select</th><th scope="col">उपविभाग</th><th scope="col">खुली जमीन</th><th scope="col">निवासी सदनिका</th><th scope="col">ऑफ़ीस</th><th scope="col">दुकाने</th><th scope="col">औद्योगिक</th><th scope="col">एकक (Rs./)</th></tr>
      ${slice.map((r, i) => `<tr align="center"><td><a href="${pb(`${P}dg_Valuation2_0`, `Select$${i}`)}" style="color:Black;">SurveyNo</a></td><td>${esc(r.zone)}</td>${r.rates.map((x) => `<td>${x}</td>`).join('')}<td>${r.unit}</td></tr>`).join('\n')}
      ${pager('dg_Valuation2_0', page, pages)}</table>
      ${st.selected != null ? `<span id="${ID}Lbl_SurveNoUrban">Survey No.</span><textarea name="${P}txt_survyNoUrban" rows="2" cols="20" readonly="readonly" id="${ID}txt_survyNoUrban">\n${slice[st.selected].survey}</textarea>` : ''}</td></tr>`;
  } else if (v === 7158) {
    body += `<tr><td><input id="${ID}rdbSurveyNo" type="radio" name="${P}grpSurveyLocation" value="rdbSurveyNo" /><input id="${ID}rdbLocation" type="radio" name="${P}grpSurveyLocation" value="rdbLocation" checked="checked" />
      <span id="${ID}lbllocationname">Select Location</span>${select('ddlLocationName', LOCATIONS, st.location, { placeholder: '- - लोकेशन निवडा  - -' })}</td></tr>`;
    if (st.location) {
      const rows = influenceRows(Number(st.location));
      body += `<tr><td><table cellspacing="0" cellpadding="3" rules="cols" border="1" id="${ID}grdInfSublocationWiseRate"><tr><th scope="col">Select</th><th scope="col">विभाग नं.</th><th scope="col">उपविभाग</th><th scope="col">दर</th><th scope="col">एकक (Rs. /)</th></tr>
        ${rows.map((r, i) => `<tr><td><a href="${pb(`${P}grdInfSublocationWiseRate`, `Select$${i}`)}">SurveyNo</a></td><td>${r.vibhag}</td><td>${esc(r.zone)}</td><td>${r.rate}</td><td>${r.unit}</td></tr>`).join('')}</table>
        ${st.selected != null ? `<textarea name="${P}txt_survyNoInfluence" readonly="readonly" id="${ID}txt_survyNoInfluence">${rows[st.selected].survey}</textarea>` : ''}</td></tr>`;
    }
  } else if (v === 5489) {
    body += `<tr><td><span id="${ID}lblVibhagNumber">Vibhag Number</span><span id="${ID}lblVibhagNo" style="color:Red;">1</span>
      <table cellspacing="0" cellpadding="3" align="Left" rules="cols" border="1" id="${ID}ruralDataGrid"><tr><th scope="col">Assesment Type</th><th scope="col">Assesment Range</th><th scope="col">Rate Rs/-</th><th scope="col">Unit</th></tr>
      ${RURAL.map(([t, r, x]) => `<tr><td>${t}</td><td>${r}</td><td>${Math.round(x * factor(st.year))}</td><td>हेक्टर</td></tr>`).join('')}</table></td></tr>`;
  } else if (v === 999) {
    body += `<tr><td><span id="${ID}lbl_not_found">माहिती उपलब्ध नाही</span></td></tr>`;
  }
  return `\n${body}\n</tbody></table><span id="${ID}lblMsg"></span>\n`;
}

const encodeState = (st) => Buffer.from(JSON.stringify(st)).toString('base64');
const decodeState = (vs) => {
  try {
    return JSON.parse(Buffer.from(vs, 'base64').toString('utf8'));
  } catch {
    return null;
  }
};
const deltaRecord = (type, id, content) => `${content.length}|${type}|${id}|${content}|`;

function startFakeEasr() {
  const fake = { requests: 0, down: false, log: [] };
  const app = express();
  app.use(express.urlencoded({ extended: false, limit: '5mb' }));
  app.use((req, res, next) => {
    fake.requests += 1;
    fake.log.push(`${req.method} ${req.path} ${req.body?.__EVENTTARGET ? `${req.body.__EVENTTARGET.replace(P, '')} ${req.body.__EVENTARGUMENT}` : ''}`.trim());
    if (fake.down) return res.status(503).send('Service Unavailable');
    next();
  });
  app.get('/eASR2.0/frmMap.aspx', (_req, res) => {
    res.setHeader('Set-Cookie', 'MyCustomSessionId=fake123; path=/eASR2.0; HttpOnly');
    res.send('<html><body><a href="eASRCommon.aspx?hDistName=Pune">Pune</a></body></html>');
  });
  app.get('/eASR2.0/eASRCommon.aspx', (req, res) => {
    if (req.query.hDistName !== 'Pune') return res.send('<html><body>No such district</body></html>');
    const st = { year: 13 };
    res.send(`<html><body><form name="aspnetForm" method="post" action="./eASRCommon.aspx?hDistName=Pune" id="aspnetForm">
      <input type="hidden" name="__EVENTTARGET" id="__EVENTTARGET" value="" /><input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="${encodeState(st)}" />
      <input type="hidden" name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="A5460043" /><input type="hidden" name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="ev" />
      <div id="${ID}UpdatePanel1">${panel(st)}</div></form></body></html>`);
  });
  app.post('/eASR2.0/eASRCommon.aspx', (req, res) => {
    const b = req.body;
    const prev = decodeState(b.__VIEWSTATE);
    if (!prev || b.__ASYNCPOST !== 'true') return res.status(500).send('bad postback');
    const target = String(b.__EVENTTARGET || '').replace(P, '');
    const arg = String(b.__EVENTARGUMENT || '');
    const st = { ...prev, selected: null };
    const hasSession = /MyCustomSessionId=fake123/.test(req.headers.cookie ?? '');
    if (target === 'ddlYear') Object.assign(st, { year: Number(b[`${P}ddlYear`]), taluka: null, village: null, location: null, page: 1 });
    else if (target === 'ddlTaluka') Object.assign(st, { year: Number(b[`${P}ddlYear`] ?? st.year), taluka: Number(b[`${P}ddlTaluka`]), village: null, location: null, page: 1 });
    else if (target === 'ddlVillage') Object.assign(st, { village: Number(b[`${P}ddlVillage`]), location: null, page: 1 });
    else if (target === 'ddlLocationName') Object.assign(st, { location: Number(b[`${P}ddlLocationName`]), page: 1 });
    else if (/^(dg_Valuation2_0|grdInfSublocationWiseRate)$/.test(target) && arg.startsWith('Page$')) {
      if (!hasSession) return res.send(deltaRecord('pageRedirect', '', '%2feASR2.0%2ffrmMap.aspx'));
      st.page = Number(arg.slice(5));
    } else if (/^(dg_Valuation2_0|grdInfSublocationWiseRate)$/.test(target) && arg.startsWith('Select$')) st.selected = Number(arg.slice(7));
    else return res.send(deltaRecord('error', '500', 'Unknown event target'));
    if (st.village && !VILLAGES[st.taluka]?.[st.village]) return res.send(deltaRecord('error', '500', 'Invalid postback or callback argument'));
    res.send(
      '1|#||4|' +
        deltaRecord('updatePanel', `${ID}UpdatePanel1`, panel(st)) +
        deltaRecord('hiddenField', '__EVENTTARGET', '') +
        deltaRecord('hiddenField', '__VIEWSTATE', encodeState(st)) +
        deltaRecord('hiddenField', '__VIEWSTATEGENERATOR', 'A5460043') +
        deltaRecord('hiddenField', '__EVENTVALIDATION', 'ev') +
        deltaRecord('asyncPostBackTimeout', '', '90') +
        deltaRecord('pageTitle', '', 'eASR Rates'),
    );
  });
  return new Promise((resolve) => {
    const server = app.listen(PORT, '127.0.0.1', () => resolve({ fake, close: () => new Promise((r) => server.close(r)), reset: () => Object.assign(fake, { requests: 0, down: false, log: [] }) }));
  });
}

export { startFakeEasr, panel as fakePanel, urbanRows };
