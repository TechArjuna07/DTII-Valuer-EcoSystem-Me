/**
 * Bank (SBI / IBA) flat valuation report — modelled on the format banks expect:
 *   [proforma invoice] → letterhead + VALUATION REPORT (I General … III Flat) → IV Marketability, V Rate,
 *   VI Composite rate → DETAILS OF VALUATION → methodology, justification and values → declaration → photographs.
 * Annexures (location map, ready-reckoner evidence, market comparables) are appended to the PDF afterwards, and the
 * valuer's digital signature page is added when the senior signs.
 * Context: see report-flat.js (buildFlatContext). All values are HTML-escaped by Handlebars.
 */
const FLAT_SBI_TEMPLATE = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><title>{{ref}}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Calibri, Carlito, "Segoe UI", Arial, sans-serif; font-size: 10.5px; color: #000; margin: 0; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .lh { border: 2px solid #000; margin-bottom: 10px; }
  .lh td { border: 1px solid #000; padding: 3px 6px; vertical-align: middle; }
  .lh .name { font-size: 17px; font-weight: 800; letter-spacing: .5px; text-align: center; }
  .lh .name.red { color: #c00000; }
  .lh .b { font-weight: 700; }
  .lh .center { text-align: center; }
  .lh .addr { font-style: italic; font-weight: 700; }
  h1 { text-align: center; font-size: 13px; margin: 8px 0 0; }
  .sub { text-align: center; font-weight: 700; margin-bottom: 8px; }
  table.grid { width: 100%; border-collapse: collapse; margin-bottom: 8px; page-break-inside: auto; }
  table.grid td, table.grid th { border: 1px solid #000; padding: 3px 5px; vertical-align: top; }
  table.grid tr { page-break-inside: avoid; }
  table.grid th { background: #fff; text-align: left; }
  .no { width: 34px; text-align: right; white-space: nowrap; }
  .lbl { width: 42%; }
  .colon { width: 10px; text-align: center; }
  .sec td { font-weight: 700; font-family: "Times New Roman", serif; font-size: 11.5px; }
  .num { text-align: right; white-space: nowrap; }
  .c { text-align: center; }
  .bold { font-weight: 700; }
  ol.docs { margin: 0; padding-left: 16px; }
  ol.docs li { margin-bottom: 3px; }
  .muted { color: #444; }
  .photos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .photos figure { margin: 0; page-break-inside: avoid; text-align: center; }
  .photos img { width: 100%; height: 255px; object-fit: cover; border: 1px solid #999; }
  .photos figcaption { font-weight: 700; margin-top: 3px; text-transform: capitalize; }
  .values td { border: none; padding: 4px 6px; }
  .qr { width: 150px; height: 150px; }
  .sign-space { height: 70px; }
  .small { font-size: 9px; }
</style></head><body>

{{#*inline "letterhead"}}
<table class="grid lh">
  <tr><td class="name" style="width:52%">{{letterhead.title}}</td><td class="name red">{{letterhead.title}}</td></tr>
  <tr><td class="b">{{letterhead.qualifications}}</td><td class="b center">{{letterhead.designations}}</td></tr>
  {{#if letterhead.subtitle}}<tr><td class="b center" colspan="2" style="font-size:12px">{{letterhead.subtitle}}</td></tr>{{/if}}
  {{#if letterhead.empanelment}}<tr><td class="b" colspan="2">{{letterhead.empanelment}}</td></tr>{{/if}}
  <tr><td class="addr" colspan="2">Address:- {{letterhead.address}}{{#if letterhead.phone}}, Mob. No. {{letterhead.phone}}{{/if}}{{#if letterhead.email}}, Email: {{letterhead.email}}{{/if}}</td></tr>
  {{#if withTax}}<tr><td class="b"><i>GSTIN No:- {{letterhead.gstin}}</i></td><td></td></tr>
  <tr><td class="b">PAN No- {{letterhead.pan}}</td><td class="b">SAC Code= {{letterhead.sac}}</td></tr>{{/if}}
</table>
{{/inline}}

{{#*inline "rows"}}
{{#each this}}
<tr><td class="no">{{no}}</td><td class="lbl">{{label}}</td><td class="colon">:</td><td>{{#if list}}<ol class="docs">{{#each list}}<li>{{this}}</li>{{/each}}</ol>{{else}}{{value}}{{/if}}</td></tr>
{{/each}}
{{/inline}}

{{#if invoice}}
<section class="page">
  {{> letterhead withTax=true letterhead=letterhead}}
  <p style="text-align:right">Date- {{invoice.date}}</p>
  <h1>PERFORMA INVOICE</h1>
  <div class="sub">Invoice No- {{invoice.number}}</div>
  <p class="bold">Name &amp; Address of Branch :- {{invoice.branch}}</p>
  <p class="bold">Name of Customer:- {{invoice.customer}}</p>
  <p class="bold">GSTIN:- Not Provided</p>
  {{#if invoice.officer}}<p class="bold">Officer Name- {{invoice.officer}}</p>{{/if}}
  <table class="grid">
    <tr><th colspan="3" class="c">Details of Property</th><th class="c" style="width:110px">Valuation Charges in Rs. /-</th></tr>
    <tr><td colspan="3">{{invoice.property}}</td><td class="c bold">{{invoice.fee}}</td></tr>
    <tr><td></td><td class="c bold">Rate</td><td class="c bold">Tax in Rs.</td><td class="c bold">Total GST Amount</td></tr>
    <tr><td class="bold">SGST:-</td><td class="c">{{invoice.halfRate}}%</td><td class="c">{{invoice.halfTax}}</td><td class="c" rowspan="2">{{invoice.gstTotal}}</td></tr>
    <tr><td class="bold">CGST -</td><td class="c">{{invoice.halfRate}}%</td><td class="c">{{invoice.halfTax}}</td></tr>
    <tr><td colspan="3" class="num bold">Total Bill Amount (Including GST)- In Rs.</td><td class="c bold">{{invoice.total}}</td></tr>
  </table>
  <p class="bold">In Words :- Rs. {{invoice.totalWords}}</p>
  <table class="grid" style="margin-top:12px">
    <tr><th style="width:52%">ACCOUNT DETAILS</th><th class="c">{{#if invoice.upi}}UPI ID- {{invoice.upi.id}}{{/if}}</th></tr>
    <tr><td>
      {{#if invoice.account}}
      <div class="bold">Account Holder Name:- {{invoice.account.accountHolder}}</div>
      <div class="bold">ACCOUNT NO- {{invoice.account.accountNumber}}</div>
      <div class="bold">IFSC CODE :- {{invoice.account.ifsc}}</div>
      <div class="bold">{{invoice.account.bankBranch}}</div>
      {{else}}<span class="muted">Bank account details not configured</span>{{/if}}
    </td><td class="c">{{#if invoice.upi}}<img class="qr" src="{{invoice.upi.qr}}" alt="UPI QR">{{/if}}</td></tr>
  </table>
</section>
{{/if}}

<section class="page">
  {{> letterhead withTax=false letterhead=letterhead}}
  <h1>VALUATION REPORT</h1>
  <div class="sub">Ref.No- {{ref}}</div>
  <table class="grid">
    <tr><th class="c" style="width:38%">To,</th><th class="c">For, (Applicant/Owner)</th><th class="c" style="width:32%">Property Address</th></tr>
    <tr><td class="bold">{{to}}</td><td class="bold">{{owner}}</td><td class="bold">{{address}}</td></tr>
  </table>
  <table class="grid">
    <tr class="sec"><td class="no">I</td><td colspan="3">GENERAL</td></tr>
    {{> rows general}}
    <tr><td class="no">6</td><td colspan="3" class="bold">Location of property</td></tr>
    {{> rows location}}
    {{> rows site}}
    <tr><td class="no">12</td><td class="lbl">Boundaries of the property - Flat and Plot</td><td class="colon">:</td><td style="padding:0">
      <table style="width:100%;border-collapse:collapse"><tr><td style="border:none;border-right:1px solid #000;border-bottom:1px solid #000" class="bold"></td><td style="border:none;border-right:1px solid #000;border-bottom:1px solid #000" class="c bold">Flat</td><td style="border:none;border-bottom:1px solid #000" class="c bold">Plot</td></tr>
      {{#each boundaries}}<tr><td style="border:none;border-right:1px solid #000;{{#unless @last}}border-bottom:1px solid #000{{/unless}}">{{dir}}</td><td style="border:none;border-right:1px solid #000;{{#unless @last}}border-bottom:1px solid #000{{/unless}}" class="c">{{flat}}</td><td style="border:none;{{#unless @last}}border-bottom:1px solid #000{{/unless}}" class="c">{{plot}}</td></tr>{{/each}}
      </table></td></tr>
    {{> rows extent}}
    <tr class="sec"><td class="no">II</td><td colspan="3">APARTMENT BUILDING</td></tr>
    {{> rows building}}
    <tr class="sec"><td class="no">III</td><td colspan="3">FLAT</td></tr>
    {{> rows flatRows}}
    <tr class="sec"><td class="no">IV</td><td colspan="3">MARKETABILITY</td></tr>
    {{> rows marketability}}
    <tr class="sec"><td class="no">V</td><td colspan="3">RATE</td></tr>
    {{> rows rate}}
    <tr class="sec"><td class="no">VI</td><td colspan="3">COMPOSITE RATE ADOPTED AFTER DEPRECIATION</td></tr>
    {{> rows composite}}
  </table>
</section>

<section class="page">
  <h1 style="text-align:left">DETAILS OF VALUATION</h1>
  <table class="grid">
    <tr><th class="no">Sr. No.</th><th>Description</th><th class="c" style="width:70px">Qty.</th><th class="c" style="width:100px">Rate per unit Rs.</th><th class="c" style="width:110px">Estimated Value Rs.</th></tr>
    <tr><td></td><td>Fair Market value of the flat with present composite rate - {{details.basis}}</td><td class="c bold">{{details.area}}</td><td class="num bold">{{details.compositeRate}}</td><td class="num bold">{{details.gross}}</td></tr>
    <tr><td></td><td>{{details.depLabel}}</td><td></td><td class="num bold">{{details.depPerUnit}}</td><td class="num bold">{{details.depAmount}}</td></tr>
    <tr><td></td><td>Fair Market Value of the Flat</td><td></td><td class="num bold">{{details.netRate}}</td><td class="num bold">{{details.fmvFlat}}</td></tr>
    <tr><td class="no">1</td><td>Fair Market value of the flat</td><td></td><td></td><td class="num bold">{{details.fmvFlat}}</td></tr>
    {{#each details.extras}}<tr><td class="no">{{no}}</td><td>{{label}}</td><td class="c">--</td><td class="c">--</td><td class="num">{{amount}}</td></tr>{{/each}}
    <tr><td></td><td class="bold">Total</td><td></td><td></td><td class="num bold">{{details.total}}</td></tr>
  </table>

  <p class="bold">Valuation Methodology</p>
  <p>{{methodology}}</p>
  <p>{{conclusion}}</p>
  {{#if deviation}}
  <p class="bold">Justification of adopting valuation rate being higher/lower beyond 20% of the Govt. rate</p>
  <p>{{deviation}}</p>
  {{/if}}
  <p>As a result of my appraisal and analysis, it is my considered opinion that the Fair Market value of the above property in the prevailing condition with aforesaid specifications are as under:</p>
  <table class="grid values">
    <tr><td></td><td></td><td class="c bold">Rupees</td><td class="c bold">Rupees in words</td></tr>
    {{#each summaryRows}}<tr><td class="no">{{no}}</td><td class="bold">{{label}}</td><td class="num bold">{{amount}}</td><td class="c bold">{{inWords}}</td></tr>{{/each}}
  </table>
  <p class="bold">Place: {{place}}<br>Date: {{dates.report}}</p>
  {{#if verification}}<p class="small muted">Report verification code {{verification.code}} — {{verification.url}}</p>{{/if}}
  <p style="margin-top:22px">The undersigned has inspected the property detailed in the Valuation Report dated ____________ on ______________. We are satisfied that the fair and reasonable market value of the property is Rs. ____________ (Rs. ______________________ only).</p>
  <p class="bold" style="margin-top:28px">Date:</p>
</section>

<section class="page">
  <h1>DECLARATION FROM VALUERS</h1>
  <p>I hereby declare that-</p>
  <ol type="i">
    <li>The information furnished in my valuation report dated {{dates.report}} is true and correct to the best of my knowledge and belief and I have made an impartial and true valuation of the property.</li>
    <li>I have no direct or indirect interest in the property valued;</li>
    <li>I have / my representative has personally inspected the correct property on {{dates.inspection}} and valued the right property. The work is not sub-contracted to any other valuer and carried out by myself.</li>
    <li>I have not been convicted of any offence and sentenced to a term of imprisonment;</li>
    <li>I have not been found guilty of misconduct in my professional capacity.</li>
    <li>I have read the Handbook on Policy, Standards and Procedure for Real Estate Valuation, 2011 of the IBA and this report is in conformity to the "Standards" enshrined for valuation in the Part-B of the above handbook to the best of my ability.</li>
    <li>I have read the International Valuation Standards (IVS) and the report submitted to the Bank for the respective asset class is in conformity to the "Standards" as enshrined for valuation in the IVS in "General Standards" and "Asset Standards" as applicable.</li>
    <li>I abide by the Model Code of Conduct for empanelment of valuer in the Bank.</li>
    <li>I am registered under Section 34 AB of the Wealth Tax Act, 1957.</li>
    <li>I am the proprietor / authorized official of the firm, who is competent to sign this valuation report.</li>
    <li>Further, I hereby provide the following information.</li>
  </ol>
  <table class="grid">
    <tr><th class="c" style="width:50px">SR. No.</th><th class="c">Particulars</th><th class="c">Valuer comment</th></tr>
    <tr><td class="c">1</td><td>Background information of the asset</td><td>Refer item 5 of the Valuation report</td></tr>
    <tr><td class="c">2</td><td>Purpose of valuation and appointing authority</td><td>Purpose - {{declaration.purpose}}<br>Appointing Authority - {{declaration.authority}}</td></tr>
    <tr><td class="c">3</td><td>Identity of the valuer and any other experts involved in the valuation</td><td>Valuer - M/s. {{declaration.firm}} ({{declaration.valuer}}). Property visited by {{declaration.inspectedBy}} on {{dates.inspection}}</td></tr>
    <tr><td class="c">4</td><td>Disclosure of valuer interest or conflict, if any</td><td>None</td></tr>
    <tr><td class="c">5</td><td>Date of appointment for valuation</td><td>{{dates.appointment}}</td></tr>
  </table>
  <div class="sign-space"></div>
  <p class="bold">Date: {{dates.report}}<span style="float:right">{{declaration.valuer}}<br>(Empanelled Valuer){{#if people.valuerRegistration}}<br>{{people.valuerRegistration}}{{/if}}</span></p>
</section>

{{#if photos.length}}
<section class="page">
  <p class="c bold">Photographs of -<br>{{owner}}<br>{{address}}</p>
  <div class="photos">
    {{#each photos}}<figure><img src="{{src}}" alt=""><figcaption>{{caption}}</figcaption></figure>{{/each}}
  </div>
</section>
{{/if}}
</body></html>`;

export { FLAT_SBI_TEMPLATE };
