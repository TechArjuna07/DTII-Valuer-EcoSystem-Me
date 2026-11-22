import { detectAreaType, parseDelta, parseFormValues, parseGrid, parseSelect, parseSurveyNumbers, parseVibhagNo, parseYears, splitZone, unitCode } from '../../src/services/igr/easr.parser.js';
import { fakePanel } from '../easr-fake.js';

describe('eASR parser', () => {
  test('MS-AJAX delta records are split by length, even when content contains "|"', () => {
    const html = '<div>a|b|c</div>';
    const text = `1|#||4|${html.length}|updatePanel|ctl00_ContentPlaceHolder5_UpdatePanel1|${html}|3|hiddenField|__VIEWSTATE|x|y|0|asyncPostBackControlIDs|||`;
    const d = parseDelta(text);
    expect(d.panels.ctl00_ContentPlaceHolder5_UpdatePanel1).toBe(html);
    expect(d.hidden.__VIEWSTATE).toBe('x|y');
    const target = '%2feASR2.0%2ffrmMap.aspx';
    expect(parseDelta(`${target.length}|pageRedirect||${target}|`).redirect).toBe('/eASR2.0/frmMap.aspx');
  });

  test('selects: placeholders dropped, selection and years read', () => {
    const html = fakePanel({ year: 13, taluka: 58 });
    expect(parseSelect(html, 'ddlTaluka')).toEqual({ selected: 58, disabled: false, options: [{ code: 54, name: 'Haveli' }, { code: 58, name: 'Khed' }] });
    expect(parseSelect(html, 'ddlVillage').options.map((o) => o.code)).toEqual([295, 999, 5489]);
    expect(parseSelect(html, 'ddlDistrict')).toMatchObject({ selected: 23, disabled: true });
    expect(parseYears(html)).toEqual({ selected: 13, years: [{ code: 12, label: '2025-2026', startYear: 2025 }, { code: 13, label: '2026-2027', startYear: 2026 }] });
  });

  test('form values exclude the disabled district (browsers do not post it)', () => {
    const v = parseFormValues(fakePanel({ year: 13, taluka: 58, village: 295 }));
    expect(v).toMatchObject({ 'ctl00$ContentPlaceHolder5$ddlYear': '13', 'ctl00$ContentPlaceHolder5$ddlTaluka': '58', 'ctl00$ContentPlaceHolder5$ddlVillage': '295', 'ctl00$ContentPlaceHolder5$grpSurveyLocation': 'rdbLocation' });
    expect(v).not.toHaveProperty('ctl00$ContentPlaceHolder5$ddlDistrict');
  });

  test('urban grid: zones, five rate columns, unit, pager and survey numbers', () => {
    const html = fakePanel({ year: 13, taluka: 58, village: 295, page: 1, selected: 0 });
    expect(detectAreaType(html)).toBe('URBAN');
    const g = parseGrid(html, 'URBAN');
    expect(g.gridName).toBe('ctl00$ContentPlaceHolder5$dg_Valuation2_0');
    expect(g.pages).toEqual([1, 2]);
    expect(g.rows).toHaveLength(5);
    expect(g.rows[0]).toMatchObject({ zoneCode: '1', openLand: '13370', residential: '44280', office: '50930', shop: '55350', industrial: '0', unitCode: 'SQ_M', gridRow: 0 });
    expect(parseSurveyNumbers(html)).toEqual(['10', '493', '1173']);
    expect(parseGrid(fakePanel({ year: 13, taluka: 58, village: 295, page: 2 }), 'URBAN')).toMatchObject({ currentPage: 2, rows: [expect.anything(), expect.anything()] });
  });

  test('influence, rural and no-data villages', () => {
    expect(detectAreaType(fakePanel({ year: 13, taluka: 54, village: 7158 }))).toBe('INFLUENCE');
    const inf = parseGrid(fakePanel({ year: 13, taluka: 54, village: 7158, location: 59919 }), 'INFLUENCE');
    expect(inf.rows[0]).toMatchObject({ zoneCode: '11/11.1', rate: '10510', unitCode: 'SQ_M', gridRow: 0 });
    const ruralHtml = fakePanel({ year: 13, taluka: 58, village: 5489 });
    expect(detectAreaType(ruralHtml)).toBe('RURAL');
    expect(parseVibhagNo(ruralHtml)).toBe('1');
    expect(parseGrid(ruralHtml, 'RURAL').rows[0]).toMatchObject({ assessmentType: 'जिरायत शेत जमिन', assessmentRange: '0-1.25', rate: '518000', unitCode: 'HECTARE', gridRow: null });
    expect(detectAreaType(fakePanel({ year: 13, taluka: 58, village: 999 }))).toBe('NONE');
  });

  test('zone labels and units', () => {
    expect(splitZone('6/129 - गणेश रोड व स्टेशन रोड')).toEqual({ code: '6/129', name: 'गणेश रोड व स्टेशन रोड' });
    expect(splitZone('11.1-गावठाण परिघस्त')).toEqual({ code: '11.1', name: 'गावठाण परिघस्त' });
    expect(splitZone('उर्वरित क्षेत्र')).toEqual({ code: null, name: 'उर्वरित क्षेत्र' });
    expect([unitCode('चौ. मीटर'), unitCode('चौरस मीटर'), unitCode('हेक्टर'), unitCode('?')]).toEqual(['SQ_M', 'SQ_M', 'HECTARE', null]);
    expect(parseSurveyNumbers('<textarea name="ctl00$ContentPlaceHolder5$txt_survyNoUrban" readonly="readonly">\n-</textarea>')).toEqual([]);
  });
});
